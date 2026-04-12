import {
  INestApplication,
  VersioningType,
  BadRequestException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { Connection, Model } from 'mongoose';
import { AppModule } from '../../src/app.module';
import {
  User,
  UserDocument,
} from '../../src/modules/users/schemas/user.schema';
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { AuctionProcessor } from '../../src/modules/auctions/auction.processor';
import { BidsGateway } from '../../src/modules/bids/bids.gateway';

jest.setTimeout(30000);

describe('Integration: uploads flow', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let userModel: Model<UserDocument>;

  const userEmail = 'integration.uploads.user@ubuy.local';
  const userPassword = 'IntegrationUploadsPass123!';
  const userUsername = 'integration_uploads_user';

  let userId = '';
  let userToken = '';

  const auctionQueueMock: any = {
    add: jest.fn() as jest.Mock,
    getJob: jest.fn() as jest.Mock,
    close: jest.fn() as jest.Mock,
  };

  auctionQueueMock.add.mockResolvedValue({ id: 'mock-end-auction-job' });
  auctionQueueMock.getJob.mockResolvedValue(null);
  auctionQueueMock.close.mockResolvedValue(undefined);

  const bidsGatewayMock = {
    server: {
      to: jest.fn().mockImplementation(() => ({
        emit: jest.fn(),
      })),
    },
  };

  const uploadsServiceMock: any = {
    uploadAuctionImages: jest.fn(),
  };

  const loginAndGetToken = async (email: string, password: string) => {
    const loginResponse = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password });

    expect(loginResponse.status).toBe(201);
    return loginResponse.body.access_token as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('auctionQueue'))
      .useValue(auctionQueueMock)
      .overrideProvider(BidsGateway)
      .useValue(bidsGatewayMock)
      .overrideProvider(AuctionProcessor)
      .useValue({})
      .overrideProvider(UploadsService)
      .useValue(uploadsServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();

    mongoConnection = app.get<Connection>(getConnectionToken());
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));

    // Clean up existing test user
    await userModel.deleteOne({ email: userEmail });

    const userHashedPassword = await bcrypt.hash(userPassword, 10);

    const createdUser = await userModel.create({
      email: userEmail,
      username: userUsername,
      password: userHashedPassword,
      provider: 'local',
      isVerified: true,
    });

    userId = String(createdUser._id);
    userToken = await loginAndGetToken(userEmail, userPassword);
  });

  afterAll(async () => {
    await userModel.deleteOne({ email: userEmail });

    if (app) {
      await app.close();
    }

    if (mongoConnection?.readyState === 1) {
      await mongoConnection.close();
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Anonymous upload rejection', () => {
    it('should reject upload request without authentication token', async () => {
      // Act: Upload without token
      const response = await request(app.getHttpServer())
        .post('/v1/uploads/images')
        .attach('files', Buffer.from('fake image data'), 'test.jpg');

      // Assert: 401 or 403 error
      expect([401, 403]).toContain(response.status);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(
            /unauthorized|forbidden|you must be logged|requires authentication/i,
          ),
        }),
      );
    });
  });

  describe('File validation and service errors', () => {
    it('should propagate service error for empty file list', async () => {
      // Arrange: Mock service to throw BadRequestException
      uploadsServiceMock.uploadAuctionImages.mockRejectedValueOnce(
        new BadRequestException('No files uploaded'),
      );

      // Act: Upload with no files
      const response = await request(app.getHttpServer())
        .post('/v1/uploads/images')
        .set('Authorization', `Bearer ${userToken}`);

      // Assert: 400 error propagated from service
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(/no files|uploaded/i),
        }),
      );
    });

    it('should propagate service error for non-image files', async () => {
      // Arrange: Mock service to reject non-image
      uploadsServiceMock.uploadAuctionImages.mockRejectedValueOnce(
        new BadRequestException('Only image uploads are allowed'),
      );

      // Act: Upload non-image file
      const response = await request(app.getHttpServer())
        .post('/v1/uploads/images')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', Buffer.from('document content'), 'document.pdf');

      // Assert: 400 error indicating only images allowed
      expect(response.status).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(/only image|image uploads/i),
        }),
      );
    });
  });

  describe('Successful file upload', () => {
    it('should upload single image successfully', async () => {
      // Arrange: Mock successful upload
      const mockImageUrl = 'https://cloudinary.com/mock/image1.jpg';
      uploadsServiceMock.uploadAuctionImages.mockResolvedValueOnce({
        urls: [mockImageUrl],
      });

      // Act: Upload valid image file
      const response = await request(app.getHttpServer())
        .post('/v1/uploads/images')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', Buffer.from('fake image data'), 'image.jpg');

      // Assert: Success response with URL
      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          urls: expect.arrayContaining([
            expect.stringMatching(/cloudinary|https/),
          ]),
        }),
      );

      // Assert: Service was called with buffer
      expect(uploadsServiceMock.uploadAuctionImages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            buffer: expect.any(Buffer),
            mimetype: 'image/jpeg',
          }),
        ]),
      );
    });

    it('should upload multiple images successfully', async () => {
      // Arrange: Mock successful multi-file upload
      const mockUrls = [
        'https://cloudinary.com/mock/image1.jpg',
        'https://cloudinary.com/mock/image2.jpg',
        'https://cloudinary.com/mock/image3.jpg',
      ];
      uploadsServiceMock.uploadAuctionImages.mockResolvedValueOnce({
        urls: mockUrls,
      });

      // Act: Upload multiple valid image files
      const response = await request(app.getHttpServer())
        .post('/v1/uploads/images')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', Buffer.from('fake image data 1'), 'image1.jpg')
        .attach('files', Buffer.from('fake image data 2'), 'image2.jpg')
        .attach('files', Buffer.from('fake image data 3'), 'image3.jpg');

      // Assert: Success response with all URLs
      expect(response.status).toBe(201);
      expect(response.body.urls).toHaveLength(3);
      expect(response.body.urls).toEqual(expect.arrayContaining(mockUrls));

      // Assert: Service called with all files
      expect(uploadsServiceMock.uploadAuctionImages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            buffer: expect.any(Buffer),
            mimetype: 'image/jpeg',
          }),
          expect.objectContaining({
            buffer: expect.any(Buffer),
            mimetype: 'image/jpeg',
          }),
          expect.objectContaining({
            buffer: expect.any(Buffer),
            mimetype: 'image/jpeg',
          }),
        ]),
      );
    });
  });

  describe('Upload limits', () => {
    it('should respect max 5 files limit', async () => {
      // Act: Try to upload 6 files (exceeds limit)
      const response = await request(app.getHttpServer())
        .post('/v1/uploads/images')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', Buffer.from('image 1'), 'image1.jpg')
        .attach('files', Buffer.from('image 2'), 'image2.jpg')
        .attach('files', Buffer.from('image 3'), 'image3.jpg')
        .attach('files', Buffer.from('image 4'), 'image4.jpg')
        .attach('files', Buffer.from('image 5'), 'image5.jpg')
        .attach('files', Buffer.from('image 6'), 'image6.jpg');

      // Assert: Request fails due to file count limit
      // Note: Supertest + NestJS FilesInterceptor typically rejects with 413 or 400
      expect([400, 413]).toContain(response.status);
    });

    it('should respect 10MB file size limit', async () => {
      // Arrange: Create buffer larger than 10MB
      const oversizeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB

      // Act: Try to upload oversized file
      const response = await request(app.getHttpServer())
        .post('/v1/uploads/images')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('files', oversizeBuffer, 'bigimage.jpg');

      // Assert: Request fails due to file size limit
      // FilesInterceptor typically rejects with 413 Payload Too Large
      expect([400, 413]).toContain(response.status);
    });
  });
});
