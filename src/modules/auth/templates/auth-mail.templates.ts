export interface AuthMailTemplate {
  subject: string;
  html: string;
}

export function buildVerificationEmailTemplate(code: string): AuthMailTemplate {
  return {
    subject: 'Welcome to U-Buy - Verify Your Account',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px;">
        <h2 style="color: #0070f3;">Welcome to U-Buy!</h2>
        <p>Hi there,</p>
        <p>Thanks for signing up with <strong>U-Buy</strong>! We're excited to have you join our auction community. To get started, please verify your email address by using the code below:</p>
        <div style="background-color: #f0f0f0; padding: 20px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px;">
          ${code}
        </div>
        <p>This verification code will expire in 10 minutes.</p>
        <p>Need help? Just reply to this email or reach out to our support team anytime.</p>
        <p>Happy bidding!<br/>- The U-Buy Team</p>
      </div>
    `,
  };
}

export function buildPasswordResetEmailTemplate(
  code: string,
): AuthMailTemplate {
  return {
    subject: 'U-Buy Password Reset Code',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px;">
        <h2 style="color: #0070f3;">Reset Your U-Buy Password</h2>
        <p>We received a request to reset your password. Use the code below to continue:</p>
        <div style="background-color: #f0f0f0; padding: 20px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px;">
          ${code}
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
        <p>- The U-Buy Team</p>
      </div>
    `,
  };
}
