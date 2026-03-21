import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {}

  generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async verifyEmail(email: string, code: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.isVerified) {
      throw new BadRequestException('User already verified');
    }

    if (user.verificationCode !== code) {
      throw new BadRequestException('Invalid verification code');
    }

    if (!user.verificationCodeExpiry) {
      throw new BadRequestException('Invalid verification code');
    }

    if (user.verificationCodeExpiry < new Date()) {
      throw new BadRequestException('Code expired');
    }

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpiry = undefined;

    await user.save();

    return {
      message: 'Email verified successfully',
    };
  }

  async signup(email: string, password: string, username: string) {
    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      throw new BadRequestException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const verificationCode = this.generateVerificationCode();

    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 10);

    await this.usersService.create({
      email,
      username,
      password: hashedPassword,
      verificationCode,
      verificationCodeExpiry: expiry,
      isVerified: false,
    });

    return {
      message: 'User registered. Verify your email.',
    };
  }
  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.password) {
      throw new BadRequestException('Invalid credentials');
    }
    if (!user.isVerified) {
      throw new BadRequestException('Please verify your email first');
    }
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new BadRequestException('Invalid credentials');
    }

    const payload = {
      sub: user._id,
      email: user.email,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
