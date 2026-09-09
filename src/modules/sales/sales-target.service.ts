import { Inject, Injectable } from "@nestjs/common";
import { SALES_TARGET_STORE } from "./sales.tokens";

/** Master Plan Addendum v1.3, Section E: a tenant- or staff-level sales goal
 * for a period. NULL userId = tenant-level; a specific one = per-staff —
 * one table/service handles both granularities. */

export interface SalesTarget {
  id: string;
  tenantId: string;
  userId?: string;
  periodStart: Date;
  periodEnd: Date;
  targetAmount: number;
  createdAt: Date;
}

export class InvalidSalesTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSalesTargetError";
  }
}

export interface SalesTargetStore {
  save(target: SalesTarget): Promise<void>;
  findAllForTenant(tenantId: string): Promise<SalesTarget[]>;
}

@Injectable()
export class SalesTargetService {
  constructor(@Inject(SALES_TARGET_STORE) private readonly store: SalesTargetStore) {}

  async setTarget(tenantId: string, id: string, periodStart: Date, periodEnd: Date, targetAmount: number, userId?: string): Promise<SalesTarget> {
    if (periodEnd < periodStart) throw new InvalidSalesTargetError("periodEnd must not be before periodStart");
    if (!Number.isFinite(targetAmount) || targetAmount < 0) throw new InvalidSalesTargetError("targetAmount must be a non-negative number");
    const target: SalesTarget = { id, tenantId, userId, periodStart, periodEnd, targetAmount, createdAt: new Date() };
    await this.store.save(target);
    return target;
  }

  async listForTenant(tenantId: string): Promise<SalesTarget[]> {
    return this.store.findAllForTenant(tenantId);
  }
}
