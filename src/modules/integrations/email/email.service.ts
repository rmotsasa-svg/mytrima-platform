import nodemailer, { Transporter } from "nodemailer";

/**
 * Backs email verification for the newly-opened self-serve tenant signup
 * (see tenant.service.ts's own top comment on why signup is no longer
 * code-gated by default, and 0026_app_user_email_verified.sql for the
 * column this actually gates).
 *
 * Deliberately narrow — one method per real use, not a general "send any
 * email" capability — same "don't build a permission/capability split
 * nothing has asked for" discipline as rbac.ts's own comment. `sendVerificationEmail`
 * was the only real use for a while; `sendRatingRequestEmail` is the second
 * one, added 2026-09-14 for CustomerController.requestFeedback();
 * `sendShiftBankingSlipEmail` is the third, added the same day for
 * SalesController.sendShiftBankingSlip() — each gets its own method with
 * its own real copy, not a generic sendEmail() guessed ahead of need.
 */
export interface EmailService {
  sendVerificationEmail(toEmail: string, verificationUrl: string): Promise<void>;
  /** `tenantName` and `requestUrl` are the only two real, non-fabricated
   * pieces of copy this can build the email from — see
   * CustomerController.requestFeedback()'s own comment on where
   * `requestUrl` (a real, working link to FeedbackPage.tsx) comes from. */
  sendRatingRequestEmail(toEmail: string, requestUrl: string, tenantName: string): Promise<void>;
  /** `slipText` is the ENTIRE real, non-fabricated content — see
   * ShiftBankingService.buildSlipText()'s own comment; this method only
   * wraps it in a real email, never invents its own summary. */
  sendShiftBankingSlipEmail(toEmail: string, slipText: string, tenantName: string): Promise<void>;
}

/**
 * The zero-configuration fallback — same role as
 * NotYetVerifiedWhatsAppService, but logs instead of throwing. A thrown
 * PendingVerificationError is right for a paid third-party API this
 * platform hasn't confirmed a vendor relationship for yet (WhatsApp/Meta/
 * PayFast); email verification is different — self-serve signup itself
 * still needs to be fully testable with zero configuration (the same "the
 * app boots and works with nothing set" property every other optional
 * integration here has), and a real person can still complete the flow by
 * reading the link out of the server log during local development.
 */
export class ConsoleEmailService implements EmailService {
  async sendVerificationEmail(toEmail: string, verificationUrl: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[EmailService] SES not configured (SES_SMTP_HOST/SES_SMTP_USERNAME/SES_SMTP_PASSWORD unset) — ` +
        `would send a verification email to ${toEmail}:\n  ${verificationUrl}`
    );
  }

  async sendRatingRequestEmail(toEmail: string, requestUrl: string, tenantName: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[EmailService] SES not configured (SES_SMTP_HOST/SES_SMTP_USERNAME/SES_SMTP_PASSWORD unset) — ` +
        `would send a rating/NPS request from "${tenantName}" to ${toEmail}:\n  ${requestUrl}`
    );
  }

  async sendShiftBankingSlipEmail(toEmail: string, slipText: string, tenantName: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[EmailService] SES not configured (SES_SMTP_HOST/SES_SMTP_USERNAME/SES_SMTP_PASSWORD unset) — ` +
        `would send a shift banking slip from "${tenantName}" to ${toEmail}:\n${slipText}`
    );
  }
}

/**
 * Real client, sending through AWS SES's SMTP interface — chosen over the
 * SES HTTP API specifically so this reuses the AWS account this project's
 * own Terraform already provisions RDS/ElastiCache under (see
 * infra/terraform/), rather than hand-rolling SigV4-signed HTTP requests or
 * adding the much heavier AWS SDK for one call. SES SMTP credentials are
 * derived from IAM credentials in the AWS console/CLI, not your AWS
 * account's own login — see README.md's "Self-serve signup" section for
 * the exact setup steps (domain verification, generating SMTP credentials).
 */
export class SesSmtpEmailService implements EmailService {
  constructor(
    private readonly transporter: Transporter,
    private readonly fromAddress: string
  ) {}

  async sendVerificationEmail(toEmail: string, verificationUrl: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject: "Verify your Mytrima account",
      text:
        `Welcome to Mytrima!\n\n` +
        `Confirm your email address to activate your account:\n${verificationUrl}\n\n` +
        `This link expires in 24 hours. If you didn't sign up for Mytrima, you can ignore this email.`,
      html:
        `<p>Welcome to Mytrima!</p>` +
        `<p>Confirm your email address to activate your account:</p>` +
        `<p><a href="${verificationUrl}">${verificationUrl}</a></p>` +
        `<p>This link expires in 24 hours. If you didn't sign up for Mytrima, you can ignore this email.</p>`,
    });
  }

  async sendRatingRequestEmail(toEmail: string, requestUrl: string, tenantName: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject: `How did we do? ${tenantName} would love your feedback`,
      text:
        `Hi,\n\n${tenantName} would appreciate a quick moment of your time to rate your recent experience:\n${requestUrl}\n\n` +
        `It only takes a minute, and helps them serve you and other customers better.`,
      html:
        `<p>Hi,</p>` +
        `<p>${tenantName} would appreciate a quick moment of your time to rate your recent experience:</p>` +
        `<p><a href="${requestUrl}">${requestUrl}</a></p>` +
        `<p>It only takes a minute, and helps them serve you and other customers better.</p>`,
    });
  }

  async sendShiftBankingSlipEmail(toEmail: string, slipText: string, tenantName: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject: `${tenantName} — shift banking slip`,
      text: slipText,
      html: `<pre style="font-family: monospace; white-space: pre-wrap;">${slipText.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
    });
  }
}

/** Same env-var-presence fallback pattern as
 * notification-worker.service.ts's own createWhatsAppService() — falls
 * back to the honest console-logging stub when SES isn't configured,
 * rather than requiring it just to boot. Called from auth.module.ts's
 * EMAIL_SERVICE provider. */
export function createEmailService(): EmailService {
  const host = process.env.SES_SMTP_HOST;
  const username = process.env.SES_SMTP_USERNAME;
  const password = process.env.SES_SMTP_PASSWORD;
  if (!host || !username || !password) {
    return new ConsoleEmailService();
  }
  const transporter = nodemailer.createTransport({
    host,
    port: 587,
    secure: false, // STARTTLS on 587, not implicit TLS — SES SMTP's own documented setup
    requireTLS: true,
    auth: { user: username, pass: password },
  });
  const fromAddress = process.env.EMAIL_FROM_ADDRESS ?? "Mytrima <noreply@mytrima.co.za>";
  return new SesSmtpEmailService(transporter, fromAddress);
}
