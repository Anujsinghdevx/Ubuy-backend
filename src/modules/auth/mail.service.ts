import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  buildPasswordResetEmailTemplate,
  buildVerificationEmailTemplate,
} from './templates/auth-mail.templates';

@Injectable()
export class MailService {
  private mailTransporter?: Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {}

  private getTransporter() {
    if (this.mailTransporter) {
      return this.mailTransporter;
    }

    const smtpHost =
      this.configService.get<string>('SMTP_HOST') ?? 'smtp.gmail.com';
    const smtpPort = Number(this.configService.get<string>('SMTP_PORT') ?? 587);
    const smtpSecure =
      String(this.configService.get<string>('SMTP_SECURE') ?? 'false') === 'true';
    const smtpEmail = this.configService.get<string>('SMTP_EMAIL');
    const smtpPassword = this.configService.get<string>('SMTP_PASSWORD');

    if (!smtpEmail || !smtpPassword) {
      throw new InternalServerErrorException(
        'SMTP_EMAIL/SMTP_PASSWORD are not configured',
      );
    }

    this.mailTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpEmail,
        pass: smtpPassword,
      },
    });

    return this.mailTransporter;
  }

  private getFromAddress() {
    const smtpEmail = this.configService.get<string>('SMTP_EMAIL');
    const fromName = this.configService.get<string>('SMTP_FROM_NAME') ?? 'U-Buy Support';

    if (!smtpEmail) {
      throw new InternalServerErrorException('SMTP_EMAIL is not configured');
    }

    return `"${fromName}" <${smtpEmail}>`;
  }

  async sendVerificationEmail(email: string, verifyCode: string) {
    const transporter = this.getTransporter();
    const template = buildVerificationEmailTemplate(verifyCode);

    try {
      const result = await transporter.sendMail({
        from: this.getFromAddress(),
        to: email,
        subject: template.subject,
        html: template.html,
      });

      this.logger.log(
        `Verification email delivery accepted for ${email}. Message ID: ${result.messageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Unable to send verification email');
    }
  }

  async sendPasswordResetEmail(email: string, resetCode: string) {
    const transporter = this.getTransporter();
    const template = buildPasswordResetEmailTemplate(resetCode);

    try {
      const result = await transporter.sendMail({
        from: this.getFromAddress(),
        to: email,
        subject: template.subject,
        html: template.html,
      });

      this.logger.log(
        `Password reset email delivery accepted for ${email}. Message ID: ${result.messageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new InternalServerErrorException('Unable to send password reset email');
    }
  }
}
