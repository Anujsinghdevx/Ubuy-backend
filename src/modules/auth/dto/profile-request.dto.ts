import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProfileRequestDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Authenticated user id',
  })
  @IsString()
  userId!: string;
}
