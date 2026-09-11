import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ConsentService, LawfulBasis } from "./consent.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

interface GrantConsentBody {
  customerId: string;
  dataCategory: string;
  lawfulBasis: LawfulBasis;
}

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged, reusing `consent:manage` (already defined in rbac.ts, already
 * granted to owner/staff, never actually enforced by this controller until
 * now). `tenantId` now comes from the actor's own verified token everywhere
 * here — a real fix, not just a guard addition: POPIA consent/DSAR records
 * are exactly the kind of data a bare body/param tenantId must never be
 * trusted for. */
@UseGuards(AccessTokenGuard)
@Controller("consent")
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Post("grant")
  grant(@CurrentUser() actor: VerifiedAccessToken, @Body() body: GrantConsentBody) {
    authorize(actor, actor.tenantId, "consent:manage");
    return this.consentService.grant(actor.tenantId, body.customerId, body.dataCategory, body.lawfulBasis, randomUUID());
  }

  @Post(":id/revoke")
  async revoke(@CurrentUser() actor: VerifiedAccessToken, @Param("id") id: string) {
    authorize(actor, actor.tenantId, "consent:manage");
    await this.consentService.revoke(actor.tenantId, id);
    return { revoked: true };
  }

  /** Supports the DSAR export requirement (Master Plan Section 10/11). */
  @Get(":tenantId/:customerId/export")
  exportForDsar(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("customerId") customerId: string) {
    authorize(actor, tenantId, "consent:manage");
    return this.consentService.exportForDsar(tenantId, customerId);
  }
}
