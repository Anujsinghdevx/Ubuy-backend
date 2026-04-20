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
import { SecurityAuditService } from '@/common/security/security-audit.service';
import { InjectModel } from '@nestjs/mongoose';
import {
  Auction,
  AuctionDocument,
} from '@/modules/auctions/schemas/auction.schema';
import { Bid, BidDocument } from '@/modules/bids/schemas/bid.schema';
import { Model, Types } from 'mongoose';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private googleClient?: OAuth2Client;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private configService: ConfigService,
    private mailService: MailService,
    private securityAuditService: SecurityAuditService,
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

  private auditAuthEvent(
    action: string,
    outcome: 'success' | 'failure' | 'attempted' | 'blocked',
    details: {
      email?: string;
      userId?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    this.securityAuditService.logEvent({
      domain: 'auth',
      action,
      outcome,
      target:
        details.email || details.userId
          ? {
              email: details.email,
              userId: details.userId,
            }
          : undefined,
      reason: details.reason,
      metadata: details.metadata,
    });
  }

  generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateCodeExpiry(minutes = 10) {
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + minutes);
    return expiry;
  }

  private toUsernameBase(value: string) {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized || 'user';
  }

  private async generateUniqueUsername(seed: string) {
    const base = this.toUsernameBase(seed).slice(0, 22);
    const maxAttempts = 15;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const suffix =
        attempt === 0 ? '' : `_${Math.floor(1000 + Math.random() * 9000)}`;
      const candidate = `${base}${suffix}`.slice(0, 30);
      const existing = await this.usersService.findByUsername(candidate);

      if (!existing) {
        return candidate;
      }
    }

    return `user_${Date.now().toString().slice(-8)}`;
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
      this.auditAuthEvent('update_profile', 'failure', {
        userId,
        reason: 'user_not_found',
      });
      throw new BadRequestException('User not found');
    }

    if (body.username && body.username !== user.username) {
      const existingUser = await this.usersService.findByUsername(
        body.username,
      );

      if (existingUser && String(existingUser._id) !== userId) {
        this.auditAuthEvent('update_profile', 'failure', {
          userId,
          reason: 'username_taken',
          metadata: { username: body.username },
        });
        throw new BadRequestException('Username is already taken');
      }
    }

    const updatedUser = await this.usersService.updateById(userId, {
      username: body.username ?? user.username,
      name: body.name ?? user.name,
      image: body.image ?? user.image,
    });

    if (!updatedUser) {
      this.auditAuthEvent('update_profile', 'failure', {
        userId,
        reason: 'update_failed',
      });
      throw new BadRequestException('Unable to update profile');
    }

    this.auditAuthEvent('update_profile', 'success', {
      userId,
      email: updatedUser.email,
      metadata: {
        username: updatedUser.username,
        hasImage: Boolean(updatedUser.image),
      },
    });

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
      this.auditAuthEvent('verify_email', 'failure', {
        email,
        reason: 'user_not_found',
      });
      throw new BadRequestException('User not found');
    }

    if (user.isVerified) {
      this.auditAuthEvent('verify_email', 'failure', {
        email,
        userId: String(user._id),
        reason: 'already_verified',
      });
      throw new BadRequestException('User already verified');
    }

    if (user.verificationCode !== code) {
      this.auditAuthEvent('verify_email', 'failure', {
        email,
        userId: String(user._id),
        reason: 'invalid_code',
      });
      throw new BadRequestException('Invalid verification code');
    }

    if (!user.verificationCodeExpiry) {
      this.auditAuthEvent('verify_email', 'failure', {
        email,
        userId: String(user._id),
        reason: 'missing_expiry',
      });
      throw new BadRequestException('Invalid verification code');
    }

    if (user.verificationCodeExpiry < new Date()) {
      this.auditAuthEvent('verify_email', 'failure', {
        email,
        userId: String(user._id),
        reason: 'code_expired',
      });
      throw new BadRequestException('Code expired');
    }

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpiry = undefined;

    await user.save();

    this.auditAuthEvent('verify_email', 'success', {
      email,
      userId: String(user._id),
    });

    return {
      message: 'Email verified successfully',
    };
  }

  async signup(email: string, password: string, username: string) {
    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      this.auditAuthEvent('signup', 'failure', {
        email,
        reason: 'user_already_exists',
        metadata: { username },
      });
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
      this.auditAuthEvent('signup', 'success', {
        email,
        metadata: { username, verified: false },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      this.auditAuthEvent('signup', 'failure', {
        email,
        reason: 'verification_email_failed',
        metadata: { username },
      });
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
      this.auditAuthEvent('forgot_password', 'attempted', {
        email,
        reason: 'account_not_found',
      });
      return {
        message: 'If an account exists, a reset code has been sent.',
      };
    }

    if (user.provider === 'google' && !user.password) {
      this.auditAuthEvent('forgot_password', 'blocked', {
        email,
        userId: String(user._id),
        reason: 'google_account_without_password',
      });
      throw new BadRequestException(
        'This account uses Google sign-in. Use Google to login.',
      );
    }

    user.passwordResetCode = this.generateVerificationCode();
    user.passwordResetCodeExpiry = this.generateCodeExpiry();
    await user.save();

    try {
      await this.mailService.sendPasswordResetEmail(
        email,
        user.passwordResetCode,
      );
      this.auditAuthEvent('forgot_password', 'success', {
        email,
        userId: String(user._id),
      });
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      this.auditAuthEvent('forgot_password', 'failure', {
        email,
        userId: String(user._id),
        reason: 'password_reset_email_failed',
      });
      throw new InternalServerErrorException(
        'Unable to send password reset code',
      );
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
      this.auditAuthEvent('resend_code', 'failure', {
        email,
        reason: 'user_not_found',
        metadata: { purpose },
      });
      throw new BadRequestException('User not found');
    }

    if (purpose === 'email-verification') {
      if (user.isVerified) {
        this.auditAuthEvent('resend_code', 'failure', {
          email,
          userId: String(user._id),
          reason: 'already_verified',
          metadata: { purpose },
        });
        throw new BadRequestException('User already verified');
      }

      user.verificationCode = this.generateVerificationCode();
      user.verificationCodeExpiry = this.generateCodeExpiry();
      await user.save();

      try {
        await this.mailService.sendVerificationEmail(
          email,
          user.verificationCode,
        );
        this.auditAuthEvent('resend_code', 'success', {
          email,
          userId: String(user._id),
          metadata: { purpose },
        });
      } catch (error) {
        this.logger.error(
          `Failed to resend verification email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        this.auditAuthEvent('resend_code', 'failure', {
          email,
          userId: String(user._id),
          reason: 'verification_email_failed',
          metadata: { purpose },
        });
        throw new InternalServerErrorException(
          'Unable to resend verification code',
        );
      }

      return {
        message: 'Verification code resent successfully',
      };
    }

    if (user.provider === 'google' && !user.password) {
      this.auditAuthEvent('resend_code', 'blocked', {
        email,
        userId: String(user._id),
        reason: 'google_account_without_password',
        metadata: { purpose },
      });
      throw new BadRequestException(
        'This account uses Google sign-in. Use Google to login.',
      );
    }

    user.passwordResetCode = this.generateVerificationCode();
    user.passwordResetCodeExpiry = this.generateCodeExpiry();
    await user.save();

    try {
      await this.mailService.sendPasswordResetEmail(
        email,
        user.passwordResetCode,
      );
      this.auditAuthEvent('resend_code', 'success', {
        email,
        userId: String(user._id),
        metadata: { purpose },
      });
    } catch (error) {
      this.logger.error(
        `Failed to resend password reset email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      this.auditAuthEvent('resend_code', 'failure', {
        email,
        userId: String(user._id),
        reason: 'password_reset_email_failed',
        metadata: { purpose },
      });
      throw new InternalServerErrorException(
        'Unable to resend password reset code',
      );
    }

    return {
      message: 'Password reset code resent successfully',
    };
  }

  async verifyPasswordResetCode(email: string, code: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      this.auditAuthEvent('verify_password_reset_code', 'failure', {
        email,
        reason: 'user_not_found',
      });
      throw new BadRequestException('User not found');
    }

    if (user.passwordResetCode !== code) {
      this.auditAuthEvent('verify_password_reset_code', 'failure', {
        email,
        userId: String(user._id),
        reason: 'invalid_code',
      });
      throw new BadRequestException('Invalid reset code');
    }

    if (
      !user.passwordResetCodeExpiry ||
      user.passwordResetCodeExpiry < new Date()
    ) {
      this.auditAuthEvent('verify_password_reset_code', 'failure', {
        email,
        userId: String(user._id),
        reason: 'code_expired',
      });
      throw new BadRequestException('Reset code expired');
    }

    this.auditAuthEvent('verify_password_reset_code', 'success', {
      email,
      userId: String(user._id),
    });

    return {
      message: 'Reset code verified successfully',
      isValid: true,
    };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      this.auditAuthEvent('reset_password', 'failure', {
        email,
        reason: 'user_not_found',
      });
      throw new BadRequestException('User not found');
    }

    if (user.passwordResetCode !== code) {
      this.auditAuthEvent('reset_password', 'failure', {
        email,
        userId: String(user._id),
        reason: 'invalid_code',
      });
      throw new BadRequestException('Invalid reset code');
    }

    if (
      !user.passwordResetCodeExpiry ||
      user.passwordResetCodeExpiry < new Date()
    ) {
      this.auditAuthEvent('reset_password', 'failure', {
        email,
        userId: String(user._id),
        reason: 'code_expired',
      });
      throw new BadRequestException('Reset code expired');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.provider = 'local';
    user.passwordResetCode = undefined;
    user.passwordResetCodeExpiry = undefined;
    await user.save();

    this.auditAuthEvent('reset_password', 'success', {
      email,
      userId: String(user._id),
    });

    return {
      message: 'Password reset successfully',
    };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      this.auditAuthEvent('login', 'failure', {
        email,
        reason: 'user_not_found',
      });
      throw new BadRequestException('User not found');
    }

    if (!user.password) {
      this.auditAuthEvent('login', 'failure', {
        email,
        userId: String(user._id),
        reason: 'missing_password',
      });
      throw new BadRequestException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.auditAuthEvent('login', 'blocked', {
        email,
        userId: String(user._id),
        reason: 'account_temporarily_locked',
        metadata: {
          lockedUntil: user.lockedUntil.toISOString(),
        },
      });

      throw new BadRequestException(
        'Account is temporarily locked. Please try again later.',
      );
    }

    if (!user.isVerified) {
      this.auditAuthEvent('login', 'blocked', {
        email,
        userId: String(user._id),
        reason: 'email_not_verified',
      });
      throw new BadRequestException('Please verify your email first');
    }
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      const failedAttempts = (user.failedLoginAttempts ?? 0) + 1;
      user.failedLoginAttempts = failedAttempts;

      if (failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        user.failedLoginAttempts = 0;
        user.lockedUntil = new Date(Date.now() + LOGIN_LOCK_WINDOW_MS);

        this.auditAuthEvent('login', 'blocked', {
          email,
          userId: String(user._id),
          reason: 'too_many_failed_attempts',
          metadata: {
            lockWindowMs: LOGIN_LOCK_WINDOW_MS,
            lockedUntil: user.lockedUntil.toISOString(),
          },
        });
      } else {
        this.auditAuthEvent('login', 'failure', {
          email,
          userId: String(user._id),
          reason: 'invalid_credentials',
          metadata: {
            failedLoginAttempts: failedAttempts,
            remainingBeforeLock: MAX_FAILED_LOGIN_ATTEMPTS - failedAttempts,
          },
        });
      }

      await user.save();
      throw new BadRequestException('Invalid credentials');
    }

    if (user.failedLoginAttempts || user.lockedUntil) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
      await user.save();
    }

    this.auditAuthEvent('login', 'success', {
      email,
      userId: String(user._id),
    });

    return this.issueAccessToken(String(user._id), user.email);
  }

  async googleAuth(idToken: string) {
    const googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');

    if (!googleClientId) {
      this.logger.error(
        'Google auth attempted but GOOGLE_CLIENT_ID is not configured',
      );
      this.auditAuthEvent('google_auth', 'blocked', {
        reason: 'google_client_not_configured',
      });
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
        error instanceof Error
          ? error.message
          : 'Google token verification failed';
      this.auditAuthEvent('google_auth', 'failure', {
        reason: 'token_verification_failed',
        metadata: { message },
      });
      throw new BadRequestException(`Invalid Google idToken: ${message}`);
    }

    const payload = ticket.getPayload();

    if (!payload) {
      this.auditAuthEvent('google_auth', 'failure', {
        reason: 'missing_payload',
      });
      throw new BadRequestException('Invalid Google token payload');
    }

    const googleId = payload.sub;
    const email = payload.email;
    const emailVerified = payload.email_verified;

    if (!googleId || !email) {
      this.auditAuthEvent('google_auth', 'failure', {
        reason: 'missing_identity_claims',
      });
      throw new BadRequestException('Invalid Google token payload');
    }

    if (!emailVerified) {
      this.auditAuthEvent('google_auth', 'blocked', {
        email,
        reason: 'email_not_verified',
      });
      throw new BadRequestException('Google account email is not verified');
    }

    try {
      const user = await this.usersService.findByEmail(email);

      if (!user) {
        const usernameSeed = email.split('@')[0] || payload.name || 'user';
        const generatedUsername =
          await this.generateUniqueUsername(usernameSeed);

        const createdUser = await this.usersService.create({
          email,
          username: generatedUsername,
          name: payload.name,
          image: payload.picture,
          googleId,
          provider: 'google',
          isVerified: true,
        });

        this.auditAuthEvent('google_auth', 'success', {
          email,
          userId: String(createdUser._id),
          metadata: { isNewUser: true },
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

      if (!user.username) {
        const usernameSeed = email.split('@')[0] || payload.name || 'user';
        user.username = await this.generateUniqueUsername(usernameSeed);
      }

      if (
        !user.verificationCodeExpiry ||
        user.verificationCodeExpiry < new Date()
      ) {
        user.verificationCode = undefined;
        user.verificationCodeExpiry = undefined;
      }

      await user.save();

      this.auditAuthEvent('google_auth', 'success', {
        email,
        userId: String(user._id),
        metadata: { isNewUser: false },
      });

      return {
        ...this.issueAccessToken(String(user._id), user.email),
        isNewUser: false,
        user: this.toAuthUserPayload(user),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Google auth error';
      this.logger.error(`Google auth persistence failed: ${message}`);
      this.auditAuthEvent('google_auth', 'failure', {
        reason: 'persistence_failed',
        metadata: { message },
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Google sign-in failed. Please try again in a moment.',
      );
    }
  }
}
