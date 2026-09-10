import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { PG_POOL } from "../../common/database.module";
import { GrowthAuditService } from "../growth-audit/growth-audit.service";
import { NpsService } from "../growth-audit/nps.service";
import { OnboardingService } from "../onboarding/onboarding.service";

export interface TenantPilotSummary {
  tenantId: string;
  tenantName: string;
  growthAuditCount: number;
  latestGrowthAuditScore: number | null;
  latestGrowthAuditBand: string | null;
  npsScore: number | null;
  npsResponseCount: number;
  onboardingPercentComplete: number;
}

export interface PilotSummary {
  tenantCount: number;
  tenants: TenantPilotSummary[];
  generatedAt: Date;
}

/**
 * Real cross-tenant reporting for the platform operator — see
 * admin-api-key.guard.ts's own comment for why this needs its own gate
 * rather than the tenant-scoped RBAC system. `tenant` itself carries no RLS
 * (it's the root registry every tenant_id column references —
 * postgres.ts's own comment), so listing every tenant id/name directly
 * is the same established pattern kpi-benchmark-check.service.ts's own
 * checkAllTenants() already uses; everything per-tenant after that reuses
 * the real, already-tested GrowthAuditService/NpsService/OnboardingService
 * methods, exactly as any tenant-scoped caller would.
 *
 * Same DATABASE_URL-gated fallback as every other cross-tenant capability
 * in this project: without a real Postgres pool there is no way to
 * enumerate "every tenant" (no in-memory tenant registry exists), so this
 * returns an empty summary rather than guessing — a real, disclosed
 * limitation, not silently wrong data.
 */
@Injectable()
export class PilotSummaryService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool | null,
    private readonly growthAuditService: GrowthAuditService,
    private readonly npsService: NpsService,
    private readonly onboardingService: OnboardingService
  ) {}

  async getSummary(): Promise<PilotSummary> {
    if (!this.pool) return { tenantCount: 0, tenants: [], generatedAt: new Date() };

    const result = await this.pool.query<{ id: string; name: string }>("select id, name from tenant order by created_at asc");

    const tenants: TenantPilotSummary[] = await Promise.all(
      result.rows.map(async (row) => {
        const [auditResponses, nps, onboarding] = await Promise.all([
          this.growthAuditService.listForTenant(row.id),
          this.npsService.aggregateForTenant(row.id),
          this.onboardingService.getStatus(row.id),
        ]);
        const latestAudit = auditResponses[auditResponses.length - 1];

        return {
          tenantId: row.id,
          tenantName: row.name,
          growthAuditCount: auditResponses.length,
          latestGrowthAuditScore: latestAudit?.result.overallScore ?? null,
          latestGrowthAuditBand: latestAudit?.result.band ?? null,
          npsScore: nps.count > 0 ? nps.nps : null,
          npsResponseCount: nps.count,
          onboardingPercentComplete: onboarding.percentComplete,
        };
      })
    );

    return { tenantCount: tenants.length, tenants, generatedAt: new Date() };
  }
}
