import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { MailService } from './mail.service';
import {
  buildPasswordResetEmailTemplate,
  buildVerificationEmailTemplate,
} from './templates/auth-mail.templates';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

jest.mock('./templates/auth-mail.templates', () => ({
  buildVerificationEmailTemplate: jest.fn(),
  buildPasswordResetEmailTemplate: jest.fn(),
}));

describe('MailService', () => {
  const createTransport = nodemailer.createTransport as jest.Mock;
  const sendMail = jest.fn();

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'SMTP_HOST') {
        return 'smtp.example.com';
      }
      if (key === 'SMTP_PORT') {
        return '587';
      }
      if (key === 'SMTP_SECURE') {
        return 'false';
      }
      if (key === 'SMTP_EMAIL') {
        return 'support@ubuy.dev';
      }
      if (key === 'SMTP_PASSWORD') {
        return 'password';
      }
      if (key === 'SMTP_FROM_NAME') {
        return 'U-Buy Support';
      }
      return undefined;
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    createTransport.mockReturnValue({ sendMail } as never);
    (buildVerificationEmailTemplate as jest.Mock).mockReturnValue({
      subject: 'Verify',
      html: '<p>verify</p>',
    });
    (buildPasswordResetEmailTemplate as jest.Mock).mockReturnValue({
      subject: 'Reset',
      html: '<p>reset</p>',
    });
  });

  it('should send verification email using configured SMTP settings', async () => {
    sendMail.mockResolvedValue({ messageId: 'msg-1' });
    const service = new MailService(configService);

    await expect(service.sendVerificationEmail('user@ubuy.dev', '123456')).resolves.toBeUndefined();

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: {
          user: 'support@ubuy.dev',
          pass: 'password',
        },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@ubuy.dev',
        subject: 'Verify',
      }),
    );
  });

  it('should send password reset email using template helper', async () => {
    sendMail.mockResolvedValue({ messageId: 'msg-2' });
    const service = new MailService(configService);

    await expect(service.sendPasswordResetEmail('user@ubuy.dev', '999999')).resolves.toBeUndefined();

    expect(buildPasswordResetEmailTemplate).toHaveBeenCalledWith('999999');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@ubuy.dev',
        subject: 'Reset',
      }),
    );
  });

  it('should wrap transporter errors in InternalServerErrorException', async () => {
    sendMail.mockRejectedValue(new Error('smtp failure'));
    const service = new MailService(configService);

    await expect(service.sendVerificationEmail('user@ubuy.dev', '123456')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
