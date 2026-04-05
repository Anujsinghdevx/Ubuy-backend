import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignupDto {
  @ApiProperty({ example: 'john@example.com', description: 'User email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'johndoe', description: 'Unique username' })
  @IsString()
  @MinLength(3)
  username!: string;

  @ApiProperty({ example: 'SecurePass123!', description: 'Account password (min 6 chars)' })
  @IsString()
  @MinLength(6)
  password!: string;
}
