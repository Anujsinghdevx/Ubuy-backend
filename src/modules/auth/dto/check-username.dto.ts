import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckUsernameDto {
  @ApiProperty({ example: 'johndoe', description: 'Username to check for availability' })
  @IsString()
  @MinLength(3)
  username!: string;
}
