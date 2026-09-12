import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl } from "class-validator";
import { PayFastService } from "../integrations/payments/payfast.service";
import { PayfastItnLogService } from "./payfast-itn-log.service";
import { TenantService } from "../auth/tenant.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { authorize } from "../auth/rbac";
import { VerifiedAccessToken } from "../auth/auth.service";
import { PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE, PAYFAST_SANDBOX } from "./payments.tokens";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";

export class TenantPayfastNotConfiguredError extends Error {
  constructor(tenantId: string) {
    super(`Tenant "${tenantId}" has no PayFast merchant id configured — set one via POST /payments/:tenantId/merchant-id before checkout can work`);
    this.name = "TenantPayfastNotConfiguredError";
  }
}

class SetMerchantIdBody {
  @IsString()
  @IsNotEmpty()
  payfastMerchantId!: string;
}

/**
 * REAL BUG found live-testing this endpoint (2026-09-12): this was a plain
 * `interface`, not a `class` — main.ts's global ValidationPipe only
 * validates real classes (every other genuinely-reachable-with-arbitrary
 * -input body in this app already gets this treatment; this one predates
 * that discipline and was missed). A JSON number for `amount` (its
 * declared TypeScript type is `string`, per PayFast's own API) sailed
 * straight past with zero validation and reached PayFastService's
 * signature-building code raw, which threw an unmapped, unhelpful 500
 * TypeError instead of a clean 400. Converted to a real validated class.
 */
class CreateCheckoutBody {
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @IsString()
  @IsNotEmpty()
  itemName!: string;

  @IsString()
  @IsNotEmpty()
  mPaymentId!: string;

  @IsUrl({ require_tld: false }) // require_tld: false — real local dev return/cancel URLs are http://localhost:*
  returnUrl!: string;

  @IsUrl({ require_tld: false })
  cancelUrl!: string;

  /** At least one of these two — how much of `amount` this Tenant actually
   * receives via PayFast's real-time Split Payment, the rest staying with
   * Mytrima's own account as the platform's fee. Neither figure is invented
   * here — see payments.tokens.ts's own comment on why no default
   * percentage is hardcoded. */
  @IsOptional()
  @IsNumber()
  tenantSplitAmount?: number;

  @IsOptional()
  @IsNumber()
  tenantSplitPercentage?: number;
}

/**
 * The real merchant-of-record payment flow (Master Plan Section 17,
 * confirmed 2026-09-10) — see payfast.service.ts's own top comment for the
 * full mechanics. Checkout is staff-initiated (an authenticated tenant
 * staff member generates a real payment form for a specific transaction),
 * not a public unauthenticated endpoint — a defensible default for this
 * pilot's scope, same "right-size before scale" judgment as elsewhere in
 * this project; a customer-facing self-serve checkout page is a real UI
 * decision for later. `notify_url` is built from `PAYMENTS_NOTIFY_URL`
 * (or derived from `PORT`), same env-var-first pattern as
 * `SocialPublishingController`'s own `redirectUri()`.
 */
@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly itnLogService: PayfastItnLogService,
    @Inject(PAYFAST_MERCHANT_ID) private readonly payfastMerchantId: string,
    @Inject(PAYFAST_MERCHANT_KEY) private readonly payfastMerchantKey: string,
    @Inject(PAYFAST_PASSPHRASE) private readonly payfastPassphrase: string,
    @Inject(PAYFAST_SANDBOX) private readonly payfastSandbox: boolean
  ) {}

  private notifyUrl(): string {
    return process.env.PAYMENTS_NOTIFY_URL ?? `http://localhost:${process.env.PORT ?? 3000}/payments/itn`;
  }

  @UseGuards(AccessTokenGuard)
  @Post(":tenantId/checkout")
  async createCheckout(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateCheckoutBody) {
    authorize(actor, tenantId, "tenant:manage_settings");
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant?.payfastMerchantId) throw new TenantPayfastNotConfiguredError(tenantId);

    const payfast = new PayFastService({
      merchantId: this.payfastMerchantId,
      merchantKey: this.payfastMerchantKey,
      passphrase: this.payfastPassphrase || undefined,
      sandbox: this.payfastSandbox,
    });

    return payfast.buildPaymentRequest({
      amount: body.amount,
      itemName: body.itemName,
      mPaymentId: body.mPaymentId,
      returnUrl: body.returnUrl,
      cancelUrl: body.cancelUrl,
      notifyUrl: this.notifyUrl(),
      splitPayment: { merchantId: tenant.payfastMerchantId, amount: body.tenantSplitAmount, percentage: body.tenantSplitPercentage },
    });
  }

  @UseGuards(AccessTokenGuard)
  @Post(":tenantId/merchant-id")
  async setMerchantId(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: SetMerchantIdBody) {
    authorize(actor, tenantId, "tenant:manage_settings");
    await this.tenantService.setPayfastMerchantId(tenantId, body.payfastMerchantId);
    return { success: true };
  }

  /**
   * The one legitimate unauthenticated write in this module — PayFast
   * itself calls this, server-to-server, with no access token to present
   * (same category of exception AuthController's own POST /auth/tenants
   * documents for tenant #1's bootstrap). Trust is established entirely by
   * the two checks below, not by who's allowed to call the URL.
   *
   * `tenant_id` doesn't exist as a native PayFast ITN field, so it's
   * resolved from `m_payment_id`, which the Tenant's own caller is
   * expected to prefix (e.g. "<tenantId>:<orderId>") when building
   * `mPaymentId` for createCheckout() — documented here rather than
   * silently assumed, since PayFast's own docs don't cover this and it's
   * this project's own convention, not a vendor-documented one.
   *
   * Rate-limited (real gap found by deep review, fixed 2026-09-10):
   * unauthenticated by design, so anyone who finds this URL could hammer
   * it — 30 per minute per client IP is generous enough for PayFast's own
   * documented retry behavior while bounding abuse.
   */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 30, windowMs: 60 * 1000 })
  @Post("itn")
  async receiveItn(@Req() req: Request) {
    const fields = req.body as Record<string, string>;
    const tenantId = (fields.m_payment_id ?? "").split(":")[0];

    const payfast = new PayFastService({
      merchantId: this.payfastMerchantId,
      merchantKey: this.payfastMerchantKey,
      passphrase: this.payfastPassphrase || undefined,
      sandbox: this.payfastSandbox,
    });

    const signatureValid = payfast.verifyItnSignature(fields);
    const serverConfirmed = signatureValid ? await payfast.confirmWithPayFastServer(fields) : false;

    await this.itnLogService.record({
      id: randomUUID(),
      tenantId,
      mPaymentId: fields.m_payment_id ?? "",
      pfPaymentId: fields.pf_payment_id ?? "",
      paymentStatus: fields.payment_status ?? "",
      amountGross: fields.amount_gross,
      signatureValid,
      serverConfirmed,
      rawPayload: fields,
    });

    return { received: true };
  }

  @UseGuards(AccessTokenGuard)
  @Get(":tenantId/itn-log")
  async getItnLog(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "tenant:manage_settings");
    return this.itnLogService.listForTenant(tenantId);
  }
}
