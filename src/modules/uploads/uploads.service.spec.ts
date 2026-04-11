import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassThrough } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import { UploadsService } from './uploads.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
    },
  },
}));

describe('UploadsService', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'CLOUDINARY_CLOUD_NAME') {
        return 'cloud';
      }
      if (key === 'CLOUDINARY_API_KEY') {
        return 'key';
      }
      if (key === 'CLOUDINARY_API_SECRET') {
        return 'secret';
      }
      return undefined;
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject when no files are uploaded', async () => {
    const service = new UploadsService(configService);

    await expect(service.uploadAuctionImages([])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should reject non image uploads', async () => {
    const service = new UploadsService(configService);

    await expect(
      service.uploadAuctionImages([
        { buffer: Buffer.from('x'), mimetype: 'text/plain' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should upload image files and return urls', async () => {
    const uploadStream = new PassThrough();
    (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
      (_options, callback) => {
        process.nextTick(() => callback(null, { secure_url: 'https://cdn.test/a.jpg' }));
        return uploadStream;
      },
    );

    const service = new UploadsService(configService);
    const result = await service.uploadAuctionImages([
      { buffer: Buffer.from('image-bytes'), mimetype: 'image/png' },
    ]);

    expect(result).toEqual({ urls: ['https://cdn.test/a.jpg'] });
  });
});
