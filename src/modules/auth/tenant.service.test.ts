import { randomUUID } from "node:crypto";
import {
  TenantService,
  InvalidTenantNameError,
  InvalidSignupCodeError,
  InvalidNotificationPhoneError,
  InvalidPayfastMerchantIdError,
  InvalidContactEmailError,
  InvalidContactPhoneError,
} from "./tenant.service";
import { InMemoryTenantStore } from "./in-memory-tenant.store";
import { AuthService, EmailNotVerifiedError } from "./auth.service";
import { InMemoryAuthUserStore } from "./in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "./in-memory-revoked-token.store";
import { totp, base32Decode } from "./totp";
import { generateMfaEncryptionKey } from "./mfa-secret-crypto";
import { EmailService } from "../integrations/email/email.service";

/** Records every call instead of actually sending/logging anything — lets
 * tests assert exactly what registerTenant()/resendVerificationEmail()
 * actually did, unlike ConsoleEmailService (a real fallback, not a test
 * double) which only prints. */
class FakeEmailService implements EmailService {
  sent: { toEmail: string; verificationUrl: string }[] = [];
  async sendVerificationEmail(toEmail: string, verificationUrl: string): Promise<void> {
    this.sent.push({ toEmail, verificationUrl });
  }
}

function makeTenantService(emailService: EmailService = new FakeEmailService()): { tenantService: TenantService; authService: AuthService } {
  const authService = new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey());
  return { tenantService: new TenantService(new InMemoryTenantStore(), authService, emailService), authService };
}

test("registerTenant creates a real tenant and its first owner account, unverified, which can then log in after verifying email and enrolling MFA", async () => {
  const fakeEmail = new FakeEmailService();
  const { tenantService, authService } = makeTenantService(fakeEmail);

  const email = `owner-${randomUUID()}@example.com`;
  const result = await tenantService.registerTenant("Brand New Business", email, "a-real-password");
  expect(result.owner.role).toBe("owner");
  expect(result.owner.tenantId).toBe(result.tenantId);

  // A self-serve owner starts unverified — see AuthUserRecord.emailVerified's
  // own comment on why this is a deliberate reversal of the old (invited
  // teammates only) default.
  expect(result.owner.emailVerified).toBe(false);

  // registerTenant() really did call the EmailService, with a real link a
  // browser could open — not a fabricated/omitted side effect.
  expect(fakeEmail.sent).toHaveLength(1);
  expect(fakeEmail.sent[0].toEmail).toBe(email);
  expect(fakeEmail.sent[0].verificationUrl).toContain("/verify-email?token=");

  // Real bug this project already found once for MFA (see this test's own
  // git history) generalizes here: a plain login() right after
  // registerTenant() must NOT succeed — an unverified owner is blocked
  // before even reaching the MFA branch.
  await expect(authService.login(result.tenantId, email, "a-real-password")).rejects.toThrow(EmailNotVerifiedError);

  // Extract the token the exact way a real click would produce it — from
  // the URL registerTenant() actually emailed, not a freshly-issued one —
  // proving the query-string shape TenantService builds is one
  // verifyEmailAddress() actually accepts.
  const token = new URL(fakeEmail.sent[0].verificationUrl).searchParams.get("token")!;
  await authService.verifyEmailAddress(token);

  // Same real behavior as before: AuthService.login() correctly requires an
  // owner to have enrolled MFA before signing in — verifying email doesn't
  // bypass that separate, still-required step.
  const enrollment = await authService.startMfaEnrollment(result.tenantId, result.owner.id);
  const code = totp(base32Decode(enrollment.secret));
  await authService.confirmMfaEnrollment(result.tenantId, result.owner.id, code);

  const tokens = await authService.login(result.tenantId, email, "a-real-password", totp(base32Decode(enrollment.secret)));
  expect(authService.verifyAccessToken(tokens.accessToken).role).toBe("owner");
});

test("registerTenant still succeeds even when the EmailService throws — a transient send failure doesn't strand a signup", async () => {
  const throwingEmail: EmailService = {
    sendVerificationEmail: async () => {
      throw new Error("SES is down");
    },
  };
  const { tenantService } = makeTenantService(throwingEmail);
  const result = await tenantService.registerTenant("Biz", `owner-${randomUUID()}@example.com`, "a-real-password");
  expect(result.owner.role).toBe("owner");
});

test("registerTenant rejects an empty tenantName", async () => {
  const { tenantService } = makeTenantService();
  await expect(tenantService.registerTenant("  ", "owner@example.com", "a-real-password")).rejects.toThrow(InvalidTenantNameError);
});

test("registerTenant still enforces AuthService's own password strength rule", async () => {
  const { tenantService } = makeTenantService();
  await expect(tenantService.registerTenant("Biz", "owner@example.com", "short")).rejects.toThrow();
});

describe("TenantService.resendVerificationEmail", () => {
  test("sends a fresh link for a real, not-yet-verified account", async () => {
    const fakeEmail = new FakeEmailService();
    const { tenantService } = makeTenantService(fakeEmail);
    const email = `owner-${randomUUID()}@example.com`;
    const { tenantId } = await tenantService.registerTenant("Biz", email, "a-real-password");
    fakeEmail.sent = []; // clear the signup's own send — this test cares about resend specifically

    await tenantService.resendVerificationEmail(tenantId, email);
    expect(fakeEmail.sent).toHaveLength(1);
    expect(fakeEmail.sent[0].toEmail).toBe(email);
  });

  test("silently does nothing for an email that doesn't exist — never reveals which accounts are real", async () => {
    const fakeEmail = new FakeEmailService();
    const { tenantService } = makeTenantService(fakeEmail);
    await expect(tenantService.resendVerificationEmail(randomUUID(), "nobody@example.com")).resolves.toBeUndefined();
    expect(fakeEmail.sent).toHaveLength(0);
  });

  test("silently does nothing for an account that's already verified", async () => {
    const fakeEmail = new FakeEmailService();
    const { tenantService, authService } = makeTenantService(fakeEmail);
    const email = `owner-${randomUUID()}@example.com`;
    const { tenantId, owner } = await tenantService.registerTenant("Biz", email, "a-real-password");
    await authService.verifyEmailAddress(authService.issueEmailVerificationToken(tenantId, owner.id));
    fakeEmail.sent = [];

    await tenantService.resendVerificationEmail(tenantId, email);
    expect(fakeEmail.sent).toHaveLength(0);
  });
});

describe("TenantService.setNotificationPhone", () => {
  test("saves a valid E.164 phone number", async () => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await expect(tenantService.setNotificationPhone(tenantId, "+26612345678")).resolves.toBeUndefined();
  });

  test.each(["", "not-a-phone", "12345", "+0123456"])("rejects an invalid phone number %p", async (bad) => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await expect(tenantService.setNotificationPhone(tenantId, bad)).rejects.toThrow(InvalidNotificationPhoneError);
  });
});

describe("TenantService.setPayfastMerchantId", () => {
  test("saves a valid numeric PayFast merchant id", async () => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await expect(tenantService.setPayfastMerchantId(tenantId, "10000100")).resolves.toBeUndefined();
  });

  test.each(["", "not-numeric", "10000100abc"])("rejects an invalid PayFast merchant id %p", async (bad) => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await expect(tenantService.setPayfastMerchantId(tenantId, bad)).rejects.toThrow(InvalidPayfastMerchantIdError);
  });
});

describe("TenantService.setBusinessProfile", () => {
  test("saves every field on a first call", async () => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");

    await tenantService.setBusinessProfile(tenantId, {
      description: "We repair small engines and garden equipment.",
      industry: "Repair services",
      location: "Maseru, Lesotho",
      contactEmail: "hello@biz.example.com",
      contactPhone: "+26612345678",
      businessGoal: "Grow repeat customers by 20% this year",
    });

    const record = await tenantService.getById(tenantId);
    expect(record?.description).toBe("We repair small engines and garden equipment.");
    expect(record?.industry).toBe("Repair services");
    expect(record?.location).toBe("Maseru, Lesotho");
    expect(record?.contactEmail).toBe("hello@biz.example.com");
    expect(record?.contactPhone).toBe("+26612345678");
    expect(record?.businessGoal).toBe("Grow repeat customers by 20% this year");
  });

  test("a call naming only one field leaves the others untouched — real partial-update behavior, not a full overwrite", async () => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");

    await tenantService.setBusinessProfile(tenantId, { industry: "Retail" });
    await tenantService.setBusinessProfile(tenantId, { location: "Maputsoe" });

    const record = await tenantService.getById(tenantId);
    expect(record?.industry).toBe("Retail");
    expect(record?.location).toBe("Maputsoe");
  });

  test("a field present but blank after trimming clears it, rather than erroring — unlike tenantName at registration", async () => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");

    await tenantService.setBusinessProfile(tenantId, { industry: "Retail" });
    expect((await tenantService.getById(tenantId))?.industry).toBe("Retail");

    await tenantService.setBusinessProfile(tenantId, { industry: "   " });
    expect((await tenantService.getById(tenantId))?.industry).toBeUndefined();
  });

  test("trims whitespace off free-text fields", async () => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await tenantService.setBusinessProfile(tenantId, { description: "  a real description  " });
    expect((await tenantService.getById(tenantId))?.description).toBe("a real description");
  });

  test.each(["not-an-email", "missing-at-sign.com", "@no-local-part.com"])("rejects an invalid contactEmail %p", async (bad) => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await expect(tenantService.setBusinessProfile(tenantId, { contactEmail: bad })).rejects.toThrow(InvalidContactEmailError);
  });

  test.each(["not-a-phone", "12345", "+0123456"])("rejects an invalid contactPhone %p", async (bad) => {
    const { tenantService } = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await expect(tenantService.setBusinessProfile(tenantId, { contactPhone: bad })).rejects.toThrow(InvalidContactPhoneError);
  });
});

describe("TenantService.getById", () => {
  test("returns null for a nonexistent tenant, then the real record after registration and after setting PayFast/notification fields", async () => {
    const { tenantService } = makeTenantService();
    expect(await tenantService.getById(randomUUID())).toBeNull();

    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    expect((await tenantService.getById(tenantId))?.payfastMerchantId).toBeUndefined();

    await tenantService.setPayfastMerchantId(tenantId, "10000100");
    expect((await tenantService.getById(tenantId))?.payfastMerchantId).toBe("10000100");
  });
});

describe("TenantService.verifySignupCode", () => {
  const originalEnv = process.env.TENANT_SIGNUP_CODE;
  afterEach(() => {
    process.env.TENANT_SIGNUP_CODE = originalEnv;
  });

  // REVERSED 2026-09-11 — see tenant.service.ts's own "DELIBERATE POLICY
  // CHANGE" comment: this used to assert the opposite (throws
  // TenantSignupNotEnabledError, "fails closed"). The tenant explicitly
  // asked for genuine self-serve signup; an unset TENANT_SIGNUP_CODE is now
  // the OPEN default, not the disabled one.
  test("passes silently when TENANT_SIGNUP_CODE is unset — self-serve signup is open by default", () => {
    delete process.env.TENANT_SIGNUP_CODE;
    expect(() => TenantService.verifySignupCode("anything")).not.toThrow();
    expect(() => TenantService.verifySignupCode(undefined)).not.toThrow();
  });

  test("throws InvalidSignupCodeError when a code IS configured and the provided one doesn't match — an opt-in way back to invite-only", () => {
    process.env.TENANT_SIGNUP_CODE = "the-real-code";
    expect(() => TenantService.verifySignupCode("wrong-code")).toThrow(InvalidSignupCodeError);
  });

  test("passes silently when the provided code matches a configured one", () => {
    process.env.TENANT_SIGNUP_CODE = "the-real-code";
    expect(() => TenantService.verifySignupCode("the-real-code")).not.toThrow();
  });
});
