import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '@/modules/users/users.service';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class AuthService {
  private googleClient?: OAuth2Client;

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private configService: ConfigService,
  ) {}

  private issueAccessToken(userId: string, email: string) {
    return {
      access_token: this.jwtService.sign({
        sub: userId,
        email,
      }),
    };
  }

  private toAuthUserPayload(user: {
    _id: unknown;
    email: string;
    username?: string;
    name?: string;
    image?: string;
    provider: 'local' | 'google';
    isVerified: boolean;
  }) {
    return {
      userId: String(user._id),
      email: user.email,
      username: user.username,
      name: user.name,
      image: user.image,
      provider: user.provider,
      isVerified: user.isVerified,
    };
  }

  private getGoogleClient() {
    if (!this.googleClient) {
      this.googleClient = new OAuth2Client();
    }

    return this.googleClient;
  }

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

    return this.issueAccessToken(String(user._id), user.email);
  }

  async googleAuth(idToken: string) {
    const googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');

    if (!googleClientId) {
      throw new InternalServerErrorException('GOOGLE_CLIENT_ID is not configured');
    }

    const client = this.getGoogleClient();
    let ticket;

    try {
      ticket = await client.verifyIdToken({
        idToken,
        audience: googleClientId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google token verification failed';
      throw new BadRequestException(`Invalid Google idToken: ${message}`);
    }

    const payload = ticket.getPayload();

    if (!payload) {
      throw new BadRequestException('Invalid Google token payload');
    }

    const googleId = payload.sub;
    const email = payload.email;
    const emailVerified = payload.email_verified;

    if (!googleId || !email) {
      throw new BadRequestException('Invalid Google token payload');
    }

    if (!emailVerified) {
      throw new BadRequestException('Google account email is not verified');
    }

    const user = await this.usersService.findByEmail(email);

    if (!user) {
      const createdUser = await this.usersService.create({
        email,
        name: payload.name,
        image: payload.picture,
        googleId,
        provider: 'google',
        isVerified: true,
      });

      return {
        ...this.issueAccessToken(String(createdUser._id), createdUser.email),
        isNewUser: true,
        user: this.toAuthUserPayload(createdUser),
      };
    }

    user.googleId = googleId;
    user.provider = 'google';
    user.isVerified = true;

    if (!user.name && payload.name) {
      user.name = payload.name;
    }

    if (!user.image && payload.picture) {
      user.image = payload.picture;
    }

    if (!user.verificationCodeExpiry || user.verificationCodeExpiry < new Date()) {
      user.verificationCode = undefined;
      user.verificationCodeExpiry = undefined;
    }

    await user.save();

    return {
      ...this.issueAccessToken(String(user._id), user.email),
      isNewUser: false,
      user: this.toAuthUserPayload(user),
    };
  }
}
