import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '@/modules/users/users.service';
import { MailService } from './mail.service';
import { Auction } from '@/modules/auctions/schemas/auction.schema';
import { Bid } from '@/modules/bids/schemas/bid.schema';
import { SecurityAuditService } from '@/common/security/security-audit.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? jest.Mock<R, A>
    : T[K];
};

describe('AuthService', () => {
  let service: AuthService;
  const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

  let jwtService: Mocked<Pick<JwtService, 'sign'>>;
  let usersService: Mocked<
    Pick<
      UsersService,
      'findByEmail' | 'create' | 'findByUsername' | 'findById' | 'updateById'
    >
  >;
  let mailService: Mocked<
    Pick<MailService, 'sendVerificationEmail' | 'sendPasswordResetEmail'>
  >;
  let securityAuditService: Mocked<Pick<SecurityAuditService, 'logEvent'>>;

  beforeEach(async () => {
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
    };

    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      findByUsername: jest.fn(),
      findById: jest.fn(),
      updateById: jest.fn(),
    };

    mailService = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
    };

    securityAuditService = {
      logEvent: jest.fn(),
    };

    const auctionModelMock: Partial<Model<Auction>> = {
      countDocuments: jest.fn(),
      updateMany: jest.fn(),
    };

    const bidModelMock: Partial<Model<Bid>> = {
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MailService, useValue: mailService },
        { provide: SecurityAuditService, useValue: securityAuditService },
        { provide: getModelToken(Auction.name), useValue: auctionModelMock },
        { provide: getModelToken(Bid.name), useValue: bidModelMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw when signup is called with existing email', async () => {
    usersService.findByEmail.mockResolvedValue({
      _id: 'existing-user',
    } as never);

    await expect(
      service.signup('exists@ubuy.dev', 'Test123!', 'exists'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('should create user and send verification email on signup success', async () => {
    usersService.findByEmail.mockResolvedValue(null as never);
    usersService.create.mockResolvedValue({ _id: 'u1' } as never);

    mockedBcrypt.hash.mockResolvedValue('hashed-password' as never);
    const codeSpy = jest
      .spyOn(service, 'generateVerificationCode')
      .mockReturnValue('123456');

    await expect(
      service.signup('new@ubuy.dev', 'Test123!', 'new_user'),
    ).resolves.toEqual({
      message: 'User registered. Verify your email.',
    });

    expect(mockedBcrypt.hash).toHaveBeenCalledWith('Test123!', 10);
    expect(codeSpy).toHaveBeenCalled();
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@ubuy.dev',
        username: 'new_user',
        password: 'hashed-password',
        verificationCode: '123456',
        isVerified: false,
      }),
    );
    expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
      'new@ubuy.dev',
      '123456',
    );
    expect(securityAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'auth',
        action: 'signup',
        outcome: 'success',
      }),
    );
  });

  it('should throw internal server error when verification email sending fails', async () => {
    usersService.findByEmail.mockResolvedValue(null as never);
    usersService.create.mockResolvedValue({ _id: 'u1' } as never);
    mockedBcrypt.hash.mockResolvedValue('hashed-password' as never);
    jest.spyOn(service, 'generateVerificationCode').mockReturnValue('999999');
    mailService.sendVerificationEmail.mockRejectedValue(
      new Error('smtp unavailable') as never,
    );

    await expect(
      service.signup('mailfail@ubuy.dev', 'Test123!', 'mail_fail'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('should reject verifyEmail when code is expired', async () => {
    usersService.findByEmail.mockResolvedValue({
      _id: 'u2',
      email: 'verify@ubuy.dev',
      isVerified: false,
      verificationCode: '654321',
      verificationCodeExpiry: new Date(Date.now() - 60_000),
      save: jest.fn(),
    } as never);

    await expect(
      service.verifyEmail('verify@ubuy.dev', '654321'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should verify email and clear verification fields when code is valid', async () => {
    const save = jest.fn().mockResolvedValue(undefined as never);
    const user = {
      _id: 'u3',
      email: 'verified@ubuy.dev',
      isVerified: false,
      verificationCode: '111222',
      verificationCodeExpiry: new Date(Date.now() + 60_000),
      save,
    };

    usersService.findByEmail.mockResolvedValue(user as never);

    await expect(
      service.verifyEmail('verified@ubuy.dev', '111222'),
    ).resolves.toEqual({
      message: 'Email verified successfully',
    });

    expect(user.isVerified).toBe(true);
    expect(user.verificationCode).toBeUndefined();
    expect(user.verificationCodeExpiry).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('should issue access token on successful login', async () => {
    usersService.findByEmail.mockResolvedValue({
      _id: 'u4',
      email: 'login@ubuy.dev',
      password: 'hashed-password',
      isVerified: true,
    } as never);

    mockedBcrypt.compare.mockResolvedValue(true as never);

    await expect(service.login('login@ubuy.dev', 'Pass123!')).resolves.toEqual({
      access_token: 'signed-token',
    });
    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: 'u4',
      email: 'login@ubuy.dev',
    });
    expect(securityAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'auth',
        action: 'login',
        outcome: 'success',
      }),
    );
  });

  it('should lock the account after repeated failed login attempts', async () => {
    const save = jest.fn().mockResolvedValue(undefined as never);
    const user = {
      _id: 'u5',
      email: 'lock@ubuy.dev',
      password: 'hashed-password',
      isVerified: true,
      failedLoginAttempts: 4,
      lockedUntil: undefined,
      save,
    };

    usersService.findByEmail.mockResolvedValue(user as never);
    mockedBcrypt.compare.mockResolvedValue(false as never);

    await expect(
      service.login('lock@ubuy.dev', 'WrongPass1!'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledTimes(1);
    expect(securityAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'auth',
        action: 'login',
        outcome: 'blocked',
        reason: 'too_many_failed_attempts',
      }),
    );
  });

  it('should block login while account is temporarily locked', async () => {
    usersService.findByEmail.mockResolvedValue({
      _id: 'u6',
      email: 'blocked@ubuy.dev',
      password: 'hashed-password',
      isVerified: true,
      lockedUntil: new Date(Date.now() + 60_000),
      save: jest.fn(),
    } as never);

    await expect(
      service.login('blocked@ubuy.dev', 'Pass123!'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockedBcrypt.compare).not.toHaveBeenCalled();
    expect(securityAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'auth',
        action: 'login',
        outcome: 'blocked',
        reason: 'account_temporarily_locked',
      }),
    );
  });

  it('should audit failed login attempts', async () => {
    usersService.findByEmail.mockResolvedValue(null as never);

    await expect(
      service.login('missing@ubuy.dev', 'Pass123!'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(securityAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'auth',
        action: 'login',
        outcome: 'failure',
        reason: 'user_not_found',
      }),
    );
  });
});
