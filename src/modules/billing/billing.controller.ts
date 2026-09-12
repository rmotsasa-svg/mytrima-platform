import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsIn, IsNotEmpty, IsString, IsUrl } from "class-validator";
import { BillingService, PACKAGES } from "./billing.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

const PACKAGE_NAMES = PACKAGES.map((p) => p.name);

/** A real `class`, matching the ValidationPipe convention every other
 * genuinely-reachable-with-arbitrary-input body in this app now uses. */
class StartCheckoutBody {
  @IsString()
  @IsIn(PACKAGE_NAMES)
  package!: string;

  @IsUrl({ require_tld: false }) // require_tld: false — real local dev redirect URLs are http://localhost:*
  redirectUrl!: string;
}

class VerifyPaymentBody {
  @IsString()
  @IsNotEmpty()
  paymentId!: string;
}

/**
 * Gated by the same `tenant:manage_settings` permission
 * PaymentsController already uses for its own PayFast merchant-id/checkout
 * endpoints — this is the equivalent tenant-level settings concern for
 * Mytrima's own billing, not a new permission split nothing has asked
 * for (rbac.ts's own comment). Every route here is staff-initiated, never
 * a public/unauthenticated write — unlike PaymentsController's own ITN
 * endpoint, MoPay has no server-to-server webhook this app needs to
 * accept (see mopay.service.ts's own comment on why redirect params
 * aren't trusted either — verifyPayment() below re-fetches from MoPay
 * itself instead).
 */
@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @UseGuards(AccessTokenGuard)
  @Get(":tenantId")
  async getBilling(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "tenant:manage_settings");
    const [subscription, payments] = await Promise.all([
      this.billingService.getCurrentSubscription(tenantId),
      this.billingService.listPayments(tenantId),
    ]);
    return { subscription, payments, packages: PACKAGES };
  }

  @UseGuards(AccessTokenGuard)
  @Post(":tenantId/checkout")
  async startCheckout(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: StartCheckoutBody) {
    authorize(actor, tenantId, "tenant:manage_settings");
    return this.billingService.startCheckout(tenantId, body.package, body.redirectUrl);
  }

  @UseGuards(AccessTokenGuard)
  @Post(":tenantId/verify")
  async verifyPayment(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: VerifyPaymentBody) {
    authorize(actor, tenantId, "tenant:manage_settings");
    return this.billingService.verifyPayment(tenantId, body.paymentId);
  }
}
