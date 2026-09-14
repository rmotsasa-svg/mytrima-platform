import { ConsoleEmailService, SesSmtpEmailService, createEmailService } from "./email.service";

describe("ConsoleEmailService", () => {
  test("logs the verification link instead of throwing — signup stays testable with zero configuration", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const service = new ConsoleEmailService();
    await expect(service.sendVerificationEmail("owner@example.com", "https://app.mytrima.co.za/verify-email?token=abc")).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("owner@example.com"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("https://app.mytrima.co.za/verify-email?token=abc"));
    logSpy.mockRestore();
  });
});

describe("ConsoleEmailService.sendRatingRequestEmail", () => {
  test("logs the tenant name, recipient, and request link instead of throwing", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const service = new ConsoleEmailService();
    await expect(
      service.sendRatingRequestEmail("customer@example.com", "https://app.mytrima.co.za/feedback/t1/c1", "Maseru Spa & Wellness")
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("customer@example.com"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("https://app.mytrima.co.za/feedback/t1/c1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Maseru Spa & Wellness"));
    logSpy.mockRestore();
  });
});

describe("ConsoleEmailService.sendShiftBankingSlipEmail", () => {
  test("logs the tenant name, recipient, and the real slip text instead of throwing", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const service = new ConsoleEmailService();
    const slipText = "Maseru Spa & Wellness — Shift banking slip\nCounted cash: 150.00";
    await expect(service.sendShiftBankingSlipEmail("owner@example.com", slipText, "Maseru Spa & Wellness")).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("owner@example.com"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Counted cash: 150.00"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Maseru Spa & Wellness"));
    logSpy.mockRestore();
  });
});

describe("SesSmtpEmailService", () => {
  test("sendMail is called with the real recipient, a from address, and a verification link in both text and html bodies", async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: "test-message-id" });
    const fakeTransporter = { sendMail } as unknown as import("nodemailer").Transporter;
    const service = new SesSmtpEmailService(fakeTransporter, "Mytrima <noreply@mytrima.co.za>");

    await service.sendVerificationEmail("owner@example.com", "https://app.mytrima.co.za/verify-email?token=abc");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];
    expect(call.from).toBe("Mytrima <noreply@mytrima.co.za>");
    expect(call.to).toBe("owner@example.com");
    expect(call.text).toContain("https://app.mytrima.co.za/verify-email?token=abc");
    expect(call.html).toContain("https://app.mytrima.co.za/verify-email?token=abc");
  });

  test("sendRatingRequestEmail sends the real tenant name and request link, in both text and html bodies", async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: "test-message-id" });
    const fakeTransporter = { sendMail } as unknown as import("nodemailer").Transporter;
    const service = new SesSmtpEmailService(fakeTransporter, "Mytrima <noreply@mytrima.co.za>");

    await service.sendRatingRequestEmail("customer@example.com", "https://app.mytrima.co.za/feedback/t1/c1", "Maseru Spa & Wellness");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];
    expect(call.to).toBe("customer@example.com");
    expect(call.subject).toContain("Maseru Spa & Wellness");
    expect(call.text).toContain("https://app.mytrima.co.za/feedback/t1/c1");
    expect(call.text).toContain("Maseru Spa & Wellness");
    expect(call.html).toContain("https://app.mytrima.co.za/feedback/t1/c1");
  });

  test("sendShiftBankingSlipEmail sends the real slip text verbatim, in both text and html bodies", async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: "test-message-id" });
    const fakeTransporter = { sendMail } as unknown as import("nodemailer").Transporter;
    const service = new SesSmtpEmailService(fakeTransporter, "Mytrima <noreply@mytrima.co.za>");
    const slipText = "Maseru Spa & Wellness — Shift banking slip\nCounted cash: 150.00\nVariance: +0.00";

    await service.sendShiftBankingSlipEmail("owner@example.com", slipText, "Maseru Spa & Wellness");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];
    expect(call.to).toBe("owner@example.com");
    expect(call.subject).toContain("Maseru Spa & Wellness");
    expect(call.text).toBe(slipText);
    expect(call.html).toContain("Counted cash: 150.00");
  });
});

describe("createEmailService", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("falls back to ConsoleEmailService when SES env vars are unset", () => {
    delete process.env.SES_SMTP_HOST;
    delete process.env.SES_SMTP_USERNAME;
    delete process.env.SES_SMTP_PASSWORD;
    expect(createEmailService()).toBeInstanceOf(ConsoleEmailService);
  });

  test("returns SesSmtpEmailService when all three SES env vars are set", () => {
    process.env.SES_SMTP_HOST = "email-smtp.eu-west-1.amazonaws.com";
    process.env.SES_SMTP_USERNAME = "test-smtp-user";
    process.env.SES_SMTP_PASSWORD = "test-smtp-pass";
    expect(createEmailService()).toBeInstanceOf(SesSmtpEmailService);
  });

  test("still falls back when only some of the three SES env vars are set", () => {
    process.env.SES_SMTP_HOST = "email-smtp.eu-west-1.amazonaws.com";
    delete process.env.SES_SMTP_USERNAME;
    delete process.env.SES_SMTP_PASSWORD;
    expect(createEmailService()).toBeInstanceOf(ConsoleEmailService);
  });
});
