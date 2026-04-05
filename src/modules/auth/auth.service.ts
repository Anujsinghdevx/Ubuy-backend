import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '@/modules/users/users.service';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MailService } from './mail.service';
import { InjectModel } from '@nestjs/mongoose';
import { Auction, AuctionDocument } from '@/modules/auctions/schemas/auction.schema';
import { Bid, BidDocument } from '@/modules/bids/schemas/bid.schema';
import { Model, Types } from 'mongoose';

@Injectable()
export class AuthService {
  private googleClient?: OAuth2Client;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private configService: ConfigService,
    private mailService: MailService,
    @InjectModel(Auction.name)
    private auctionModel: Model<AuctionDocument>,
    @InjectModel(Bid.name)
    private bidModel: Model<BidDocument>,
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

  private generateCodeExpiry(minutes = 10) {
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + minutes);
    return expiry;
  }

  async checkUsernameUnique(username: string) {
    const existingUser = await this.usersService.findByUsername(username);

    return {
      username,
      isAvailable: !existingUser,
      message: existingUser
        ? 'Username is already taken'
        : 'Username is available',
    };
  }

  async getPublicProfile(identifier: string) {
    const user = Types.ObjectId.isValid(identifier)
      ? await this.usersService.findById(identifier)
      : await this.usersService.findByUsername(identifier);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const userId = String(user._id);
    const auctionIds = (user.biddedAuctions ?? []).filter((id) =>
      Types.ObjectId.isValid(id),
    );

    if (auctionIds.length > 0) {
      await this.auctionModel.updateMany(
        {
          _id: { $in: auctionIds },
          endTime: { $lte: new Date() },
          status: 'ACTIVE',
        },
        {
          $set: {
            status: 'ENDED',
          },
        },
      );
    }

    const totalBids = await this.bidModel.countDocuments(
      auctionIds.length > 0
        ? { userId, auctionId: { $in: auctionIds } }
        : { userId },
    );

    const auctionsCreated = await this.auctionModel.countDocuments({
      createdBy: userId,
    });

    const auctionsWon =
      auctionIds.length > 0
        ? await this.auctionModel.countDocuments({
            _id: { $in: auctionIds },
            winner: userId,
          })
        : 0;

    const createdAtFormatted = user.createdAt
      ? new Date(user.createdAt).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'N/A';

    const profileName = user.name?.trim() || user.username || 'Unnamed User';

    return {
      id: userId,
      username: profileName,
      profileImage: user.image ?? null,
      createdAt: createdAtFormatted,
      stats: {
        totalBids,
        auctionsCreated,
        auctionsWon,
      },
    };
  }

  async getProfileById(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      userId: String(user._id),
      email: user.email,
      username: user.username,
      name: user.name,
      image: user.image,
      provider: user.provider,
      isVerified: user.isVerified,
      biddedAuctions: user.biddedAuctions ?? [],
    };
  }

  async updateProfile(userId: string, body: UpdateProfileDto) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (body.username && body.username !== user.username) {
      const existingUser = await this.usersService.findByUsername(body.username);

      if (existingUser && String(existingUser._id) !== userId) {
        throw new BadRequestException('Username is already taken');
      }
    }

    const updatedUser = await this.usersService.updateById(userId, {
      username: body.username ?? user.username,
      name: body.name ?? user.name,
      image: body.image ?? user.image,
    });

    if (!updatedUser) {
      throw new BadRequestException('Unable to update profile');
    }

    return {
      message: 'Profile updated successfully',
      user: {
        userId: String(updatedUser._id),
        email: updatedUser.email,
        username: updatedUser.username,
        name: updatedUser.name,
        image: updatedUser.image,
      },
    };
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

    const expiry = this.generateCodeExpiry();

    await this.usersService.create({
      email,
      username,
      password: hashedPassword,
      verificationCode,
      verificationCodeExpiry: expiry,
      isVerified: false,
    });

    this.logger.log(`Attempting to send verification email to ${email}`);

    try {
      await this.mailService.sendVerificationEmail(email, verificationCode);
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException(
        'User created but verification email could not be sent. Please try resend-code.',
      );
    }

    return {
      message: 'User registered. Verify your email.',
    };
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      return {
        message: 'If an account exists, a reset code has been sent.',
      };
    }

    if (user.provider === 'google' && !user.password) {
      throw new BadRequestException(
        'This account uses Google sign-in. Use Google to login.',
      );
    }

    user.passwordResetCode = this.generateVerificationCode();
    user.passwordResetCodeExpiry = this.generateCodeExpiry();
    await user.save();

    try {
      await this.mailService.sendPasswordResetEmail(email, user.passwordResetCode);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Unable to send password reset code');
    }

    return {
      message: 'If an account exists, a reset code has been sent.',
    };
  }

  async resendCode(
    email: string,
    purpose: 'email-verification' | 'password-reset' = 'email-verification',
  ) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (purpose === 'email-verification') {
      if (user.isVerified) {
        throw new BadRequestException('User already verified');
      }

      user.verificationCode = this.generateVerificationCode();
      user.verificationCodeExpiry = this.generateCodeExpiry();
      await user.save();

      try {
        await this.mailService.sendVerificationEmail(email, user.verificationCode);
      } catch (error) {
        this.logger.error(
          `Failed to resend verification email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        throw new InternalServerErrorException('Unable to resend verification code');
      }

      return {
        message: 'Verification code resent successfully',
      };
    }

    if (user.provider === 'google' && !user.password) {
      throw new BadRequestException(
        'This account uses Google sign-in. Use Google to login.',
      );
    }

    user.passwordResetCode = this.generateVerificationCode();
    user.passwordResetCodeExpiry = this.generateCodeExpiry();
    await user.save();

    try {
      await this.mailService.sendPasswordResetEmail(email, user.passwordResetCode);
    } catch (error) {
      this.logger.error(
        `Failed to resend password reset email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Unable to resend password reset code');
    }

    return {
      message: 'Password reset code resent successfully',
    };
  }

  async verifyPasswordResetCode(email: string, code: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.passwordResetCode !== code) {
      throw new BadRequestException('Invalid reset code');
    }

    if (!user.passwordResetCodeExpiry || user.passwordResetCodeExpiry < new Date()) {
      throw new BadRequestException('Reset code expired');
    }

    return {
      message: 'Reset code verified successfully',
      isValid: true,
    };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.passwordResetCode !== code) {
      throw new BadRequestException('Invalid reset code');
    }

    if (!user.passwordResetCodeExpiry || user.passwordResetCodeExpiry < new Date()) {
      throw new BadRequestException('Reset code expired');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.provider = 'local';
    user.passwordResetCode = undefined;
    user.passwordResetCodeExpiry = undefined;
    await user.save();

    return {
      message: 'Password reset successfully',
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
      this.logger.error(
        'Google auth attempted but GOOGLE_CLIENT_ID is not configured',
      );
      throw new BadRequestException(
        'Google auth is not configured on server. Please contact support.',
      );
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

    try {
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Google auth error';
      this.logger.error(`Google auth persistence failed: ${message}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Google sign-in failed. Please try again in a moment.',
      );
    }
  }
}
