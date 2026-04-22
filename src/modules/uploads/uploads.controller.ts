import {
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { UploadsService } from './uploads.service';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype?: string;
};

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @ApiOperation({ summary: 'Upload auction images' })
  @ApiResponse({
    status: 200,
    description: 'Images uploaded successfully',
    example: {
      files: [
        'https://cloudinary.com/.../image1.jpg',
        'https://cloudinary.com/.../image2.jpg',
      ],
    },
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Up to 5 image files (max 10MB each)',
        },
      },
      required: ['files'],
    },
  })
  @Post('images')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: {
        files: 5,
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadImages(@UploadedFiles() files: UploadedImageFile[]) {
    return this.uploadsService.uploadAuctionImages(files);
  }
}
