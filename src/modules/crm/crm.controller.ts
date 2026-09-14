import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CrmService, LeadStage, CrmActivityType } from "./crm.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

interface CreateLeadBody {
  name: string;
  contactPhone?: string;
  contactEmail?: string;
  source: string;
  estimatedValue?: number;
  ownerUserId?: string;
}

interface MoveStageBody {
  stage: LeadStage;
}

interface LogActivityBody {
  type: CrmActivityType;
  body: string;
}

@UseGuards(AccessTokenGuard)
@Controller("leads")
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Post(":tenantId")
  create(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateLeadBody) {
    authorize(actor, tenantId, "crm:manage");
    return this.crmService.createLead(tenantId, randomUUID(), body);
  }

  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "crm:view");
    return this.crmService.listForTenant(tenantId);
  }

  @Get(":tenantId/:leadId")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("leadId") leadId: string) {
    authorize(actor, tenantId, "crm:view");
    const lead = await this.crmService.findById(tenantId, leadId);
    if (!lead) throw new NotFoundException(`No lead found with id "${leadId}"`);
    return lead;
  }

  /** A real Customer may be matched or created as a side effect of moving
   * to "won" — see CrmService.moveStage()'s own comment. */
  @Patch(":tenantId/:leadId/stage")
  moveStage(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("leadId") leadId: string, @Body() body: MoveStageBody) {
    authorize(actor, tenantId, "crm:manage");
    return this.crmService.moveStage(tenantId, leadId, body.stage);
  }

  @Post(":tenantId/:leadId/activities")
  logActivity(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("leadId") leadId: string,
    @Body() body: LogActivityBody
  ) {
    authorize(actor, tenantId, "crm:manage");
    return this.crmService.logActivity(tenantId, leadId, randomUUID(), { ...body, createdByUserId: actor.userId });
  }

  @Get(":tenantId/:leadId/activities")
  listActivities(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("leadId") leadId: string) {
    authorize(actor, tenantId, "crm:view");
    return this.crmService.listActivitiesForLead(tenantId, leadId);
  }
}
