import { Test, TestingModule } from '@nestjs/testing';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

describe('UploadsController', () => {
  let controller: UploadsController;
  const uploadsService = {
    uploadAuctionImages: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [{ provide: UploadsService, useValue: uploadsService }],
    }).compile();

    controller = module.get<UploadsController>(UploadsController);
  });

  it('should proxy uploaded files to uploads service', async () => {
    uploadsService.uploadAuctionImages.mockResolvedValue({ urls: ['a'] });

    await expect(
      controller.uploadImages([
        { buffer: Buffer.from('x'), mimetype: 'image/png' },
      ] as never),
    ).resolves.toEqual({ urls: ['a'] });

    expect(uploadsService.uploadAuctionImages).toHaveBeenCalledWith([
      { buffer: Buffer.from('x'), mimetype: 'image/png' },
    ]);
  });
});
