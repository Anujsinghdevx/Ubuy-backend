import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Query,
  Patch,
  Param,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '@/common/decorators/current-user.decorator';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { CheckUsernameDto } from './dto/check-username.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResendCodeDto } from './dto/resend-code.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PublicProfileDto } from './dto/public-profile.dto';
import { ProfileRequestDto } from './dto/profile-request.dto';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Check if username is available (query)' })
  @ApiResponse({ status: 200, description: 'Username availability check result', example: { isAvailable: true } })
  @Get('check-username-unique')
  async checkUsernameUnique(@Query() query: CheckUsernameDto) {
    return this.authService.checkUsernameUnique(query.username);
  }

  @ApiOperation({ summary: 'Check if username is available (body)' })
  @ApiResponse({ status: 200, description: 'Username availability check result', example: { isAvailable: false } })
  @Post('check-username-unique')
  async checkUsernameUniquePost(@Body() body: CheckUsernameDto) {
    return this.authService.checkUsernameUnique(body.username);
  }

  @ApiOperation({ summary: 'Create a new account' })
  @ApiResponse({ status: 201, description: 'User created, email verification pending', example: { message: 'Signup successful. Please verify your email.', email: 'john@example.com' } })
  @ApiResponse({ status: 400, description: 'Username or email already exists' })
  @Post('signup')
  async signup(@Body() body: SignupDto) {
    const { email, password, username } = body;
    return this.authService.signup(email, password, username);
  }

  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful', example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', user: { userId: '507f1f77bcf86cd799439011', email: 'john@example.com', username: 'johndoe' } } })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @Post('login')
  async login(@Body() body: LoginDto) {
    const { email, password } = body;
    return this.authService.login(email, password);
  }

  @ApiOperation({ summary: 'Authenticate with Google id token' })
  @ApiResponse({ status: 200, description: 'Google auth successful', example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', user: { userId: '507f1f77bcf86cd799439011', email: 'john@google.com', username: 'john_doe_google' } } })
  @Post('google')
  async googleAuth(@Body() body: GoogleAuthDto) {
    return this.authService.googleAuth(body.idToken);
  }

  @ApiOperation({ summary: 'Verify email with code' })
  @ApiResponse({ status: 200, description: 'Email verified successfully', example: { message: 'Email verified successfully' } })
  @ApiResponse({ status: 400, description: 'Invalid or expired verification code' })
  @Post('verify-email')
  async verifyEmail(@Body() body: VerifyEmailDto) {
    const { email, code } = body;
    return this.authService.verifyEmail(email, code);
  }

  @ApiOperation({ summary: 'Request password reset code' })
  @ApiResponse({ status: 200, description: 'Reset code sent to email', example: { message: 'Password reset code sent to your email' } })
  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email);
  }

  @ApiOperation({ summary: 'Resend verification or reset code' })
  @ApiResponse({ status: 200, description: 'Code resent successfully', example: { message: 'Code resent to your email' } })
  @Post('resend-code')
  async resendCode(@Body() body: ResendCodeDto) {
    return this.authService.resendCode(body.email, body.purpose);
  }

  @ApiOperation({ summary: 'Validate password reset code' })
  @ApiResponse({ status: 200, description: 'Reset code is valid', example: { message: 'Reset code is valid', email: 'john@example.com' } })
  @Post('reset-code')
  async verifyResetCode(@Body() body: VerifyResetCodeDto) {
    return this.authService.verifyPasswordResetCode(body.email, body.code);
  }

  @ApiOperation({ summary: 'Alias for reset-code validation' })
  @ApiResponse({ status: 200, description: 'Code verified', example: { message: 'Code verified successfully' } })
  @Post('verify-code')
  async verifyCode(@Body() body: VerifyResetCodeDto) {
    return this.authService.verifyPasswordResetCode(body.email, body.code);
  }

  @ApiOperation({ summary: 'Reset password using code' })
  @ApiResponse({ status: 200, description: 'Password reset successful', example: { message: 'Password reset successfully' } })
  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.email, body.code, body.newPassword);
  }

  @ApiOperation({ summary: 'Get public profile by username or userId' })
  @ApiResponse({ status: 200, description: 'Public profile retrieved', example: { id: '507f1f77bcf86cd799439011', username: 'John Doe', profileImage: 'https://cloudinary.com/.../profile.jpg', createdAt: '4 April 2026', stats: { totalBids: 12, auctionsCreated: 4, auctionsWon: 2 } } })
  @Get('public-profile/:username')
  async getPublicProfile(@Param() params: PublicProfileDto) {
    return this.authService.getPublicProfile(params.username);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated profile (legacy compatibility payload)' })
  @ApiResponse({ status: 200, description: 'Profile retrieved', example: { userId: '507f1f77bcf86cd799439011', email: 'john@example.com', username: 'johndoe', provider: 'local', isVerified: true } })
  @ApiResponse({ status: 403, description: 'userId must match authenticated user' })
  @UseGuards(JwtAuthGuard)
  @Post('profile')
  async getProfileLegacyCompatibility(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: ProfileRequestDto,
  ) {
    if (!user?.userId) {
      throw new UnauthorizedException('Unauthorized');
    }

    if (body.userId !== user.userId) {
      throw new ForbiddenException('Cannot fetch profile for another user');
    }

    return this.authService.getProfileById(body.userId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated', example: { username: 'johndoe2', name: 'John Doe', image: 'https://cloudinary.com/.../newprofile.jpg', updated: true } })
  @Patch('update-profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: UpdateProfileDto,
  ) {
    if (!user?.userId) {
      throw new UnauthorizedException('Unauthorized');
    }

    return this.authService.updateProfile(user.userId, body);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile', example: { message: 'User fetched successfully', user: { userId: '507f1f77bcf86cd799439011', email: 'john@example.com', username: 'johndoe', name: 'John Doe' } } })
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentUser() user: AuthenticatedUser | undefined) {
    return {
      message: 'User fetched successfully',
      user,
    };
  }
}
