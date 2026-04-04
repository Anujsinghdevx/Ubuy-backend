import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ...', description: 'Google OAuth 2.0 ID token' })
  @IsString()
  idToken: string;
}
