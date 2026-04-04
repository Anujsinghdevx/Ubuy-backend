import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProfileRequestDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Authenticated user id',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    example: 'User',
    description: 'Backward-compatibility field from old API',
    enum: ['User', 'AuthUser'],
  })
  @IsString()
  @IsIn(['User', 'AuthUser'])
  userModel: 'User' | 'AuthUser';
}
