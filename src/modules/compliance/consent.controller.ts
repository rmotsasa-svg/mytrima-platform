import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ConsentService, LawfulBasis } from "./consent.service";

interface GrantConsentBody {
  tenantId: string;
  customerId: string;
  dataCategory: string;
  lawfulBasis: LawfulBasis;
}

interface RevokeConsentBody {
  tenantId: string;
}

@Controller("consent")
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Post("grant")
  grant(@Body() body: GrantConsentBody) {
    return this.consentService.grant(body.tenantId, body.customerId, body.dataCategory, body.lawfulBasis, randomUUID());
  }

  @Post(":id/revoke")
  async revoke(@Param("id") id: string, @Body() body: RevokeConsentBody) {
    await this.consentService.revoke(body.tenantId, id);
    return { revoked: true };
  }

  /** Supports the DSAR export requirement (Master Plan Section 10/11). */
  @Get(":tenantId/:customerId/export")
  exportForDsar(@Param("tenantId") tenantId: string, @Param("customerId") customerId: string) {
    return this.consentService.exportForDsar(tenantId, customerId);
  }
}
