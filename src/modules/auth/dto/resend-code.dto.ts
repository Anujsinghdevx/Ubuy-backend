import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ResendCodePurpose {
  EMAIL_VERIFICATION = 'email-verification',
  PASSWORD_RESET = 'password-reset',
}

export class ResendCodeDto {
  @ApiProperty({ example: 'john@example.com', description: 'Email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'email-verification',
    description: 'Purpose for resending code',
    enum: ResendCodePurpose,
    required: false,
  })
  @IsOptional()
  @IsEnum(ResendCodePurpose)
  purpose?: ResendCodePurpose;
}
