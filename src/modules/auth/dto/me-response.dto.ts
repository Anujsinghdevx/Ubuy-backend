import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MeUserDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', description: 'User id' })
  userId!: string;

  @ApiProperty({ example: 'john@example.com', description: 'User email' })
  email!: string;

  @ApiPropertyOptional({ example: 'johndoe', description: 'Username' })
  username?: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Display name' })
  name?: string;

  @ApiPropertyOptional({ example: 'https://cloudinary.com/.../profile.jpg', description: 'Profile image URL' })
  image?: string;

  @ApiProperty({ example: 'local', description: 'Auth provider', enum: ['local', 'google'] })
  provider!: 'local' | 'google';

  @ApiProperty({ example: true, description: 'Whether email is verified' })
  isVerified!: boolean;

  @ApiProperty({
    example: ['507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013'],
    description: 'Auction ids where this user has placed bids',
    type: [String],
  })
  biddedAuctions!: string[];
}

export class MeResponseDto {
  @ApiProperty({ example: 'User fetched successfully', description: 'Status message' })
  message!: string;

  @ApiProperty({ type: MeUserDto, description: 'Authenticated user profile' })
  user!: MeUserDto;
}
