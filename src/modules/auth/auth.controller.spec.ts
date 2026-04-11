import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    checkUsernameUnique: jest.fn(),
    signup: jest.fn(),
    login: jest.fn(),
    googleAuth: jest.fn(),
    verifyEmail: jest.fn(),
    forgotPassword: jest.fn(),
    resendCode: jest.fn(),
    verifyPasswordResetCode: jest.fn(),
    resetPassword: jest.fn(),
    getPublicProfile: jest.fn(),
    getProfileById: jest.fn(),
    updateProfile: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should proxy signup payload fields to auth service', async () => {
    authService.signup.mockResolvedValue({ message: 'ok' });

    await expect(
      controller.signup({
        email: 'user@ubuy.dev',
        password: 'Secret123!',
        username: 'user1',
      } as never),
    ).resolves.toEqual({ message: 'ok' });

    expect(authService.signup).toHaveBeenCalledWith(
      'user@ubuy.dev',
      'Secret123!',
      'user1',
    );
  });

  it('should throw when updating profile without authenticated user', async () => {
    await expect(
      controller.updateProfile(undefined, {
        username: 'newname',
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject legacy profile fetch for another user', async () => {
    await expect(
      controller.getProfileLegacyCompatibility(
        { userId: 'user-1', email: 'user@ubuy.dev' },
        { userId: 'other-user' } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('should return profile wrapper for authenticated user', async () => {
    authService.getProfileById.mockResolvedValue({ userId: 'user-1' });

    const result = await controller.getProfile({
      userId: 'user-1',
      email: 'user@ubuy.dev',
    });

    expect(result).toEqual({
      message: 'User fetched successfully',
      user: { userId: 'user-1' },
    });
    expect(authService.getProfileById).toHaveBeenCalledWith('user-1');
  });

  it('should proxy username unique query to auth service', async () => {
    authService.checkUsernameUnique.mockResolvedValue({ isAvailable: true });

    await expect(
      controller.checkUsernameUnique({ username: 'sample' } as never),
    ).resolves.toEqual({ isAvailable: true });
  });
});
