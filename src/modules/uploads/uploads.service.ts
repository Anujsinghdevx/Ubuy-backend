import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype?: string;
};

@Injectable()
export class UploadsService {
  constructor(private readonly configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary credentials are not fully configured');
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
  }

  async uploadAuctionImages(files: UploadedImageFile[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const uploadPromises = files.map((file) => {
      if (!file.mimetype?.startsWith('image/')) {
        throw new BadRequestException('Only image uploads are allowed');
      }

      return new Promise<string>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'auction_images',
            transformation: [
              { width: 'auto', crop: 'scale' },
              { quality: 'auto' },
              { fetch_format: 'auto' },
            ],
          },
          (error, result) => {
            if (error) {
              reject(error);
              return;
            }

            if (!result?.secure_url) {
              reject(new Error('No secure URL returned by Cloudinary'));
              return;
            }

            resolve(result.secure_url);
          },
        );

        Readable.from(file.buffer).pipe(uploadStream);
      });
    });

    const urls = await Promise.all(uploadPromises);

    return { urls };
  }
}
