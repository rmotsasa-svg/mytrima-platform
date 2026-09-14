import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { LEAD_STORE, CRM_ACTIVITY_STORE } from "./crm.tokens";
import { CustomerService, Customer } from "../customers/customer.service";

/**
 * Phase 5 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md) — the single
 * biggest net-new build in the whole plan. Confirmed during the plan's own
 * analysis phase: this codebase had NO lead/opportunity/pipeline concept
 * anywhere before this module. "Deals" (../deals) is a discount/promotion
 * catalog, unrelated despite the name; Customers (../customers) is
 * post-sale record-keeping with no pre-sale stage concept. This is that
 * missing pre-sale layer.
 */

export type LeadStage = "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost";

export interface Lead {
  id: string;
  tenantId: string;
  name: string;
  contactPhone?: string;
  contactEmail?: string;
  source: string;
  stage: LeadStage;
  estimatedValue?: number;
  ownerUserId?: string;
  createdAt: Date;
  /** Refreshed by logActivity() and moveStage() alike — both are real
   * interactions with the lead. This is the one field
   * CrmStaleLeadCheckService actually reads. */
  lastActivityAt: Date;
  /** Set exactly once, the moment this lead's stage becomes "won" — the
   * real Customer record it was matched to or created for. Never set for
   * any other stage, and never unset once a lead has genuinely won (moving
   * a won lead back to an earlier stage doesn't un-link the customer that
   * already exists because of it — see moveStage()'s own comment). */
  wonCustomerId?: string;
}

export type CrmActivityType = "note" | "call" | "whatsapp" | "meeting";

export interface CrmActivity {
  id: string;
  tenantId: string;
  leadId: string;
  type: CrmActivityType;
  body: string;
  createdAt: Date;
  createdByUserId: string;
}

export class InvalidLeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLeadError";
  }
}

export class LeadNotFoundError extends Error {
  constructor(id: string) {
    super(`No lead found with id "${id}"`);
    this.name = "LeadNotFoundError";
  }
}

export interface LeadStore {
  save(lead: Lead): Promise<void>;
  findAllForTenant(tenantId: string): Promise<Lead[]>;
  findById(tenantId: string, id: string): Promise<Lead | null>;
}

/**
 * A real, append-only activity log — deliberately its OWN store (a
 * separate table, own id, own insert-only save), not an array field
 * embedded on Lead the way Deal.catalogItemIds is on Deal. An activity
 * timeline that grows over months of real calls/notes must never be
 * silently truncated or overwritten by a later, unrelated Lead update —
 * the "delete-and-reinsert on save" pattern pg-deal.store.ts uses for its
 * own small, fully-replaced child arrays would be actively wrong here
 * (it would erase history). Same real separation NpsResponseStore/
 * RatingStore already use for their own append-only records against a
 * parent entity.
 */
export interface CrmActivityStore {
  save(activity: CrmActivity): Promise<void>;
  findAllForLead(tenantId: string, leadId: string): Promise<CrmActivity[]>;
}

export interface CreateLeadInput {
  name: string;
  contactPhone?: string;
  contactEmail?: string;
  source: string;
  estimatedValue?: number;
  ownerUserId?: string;
}

export interface LogActivityInput {
  type: CrmActivityType;
  body: string;
  createdByUserId: string;
}

function validateLead(name: string, source: string, estimatedValue: number | undefined): void {
  if (!name.trim()) throw new InvalidLeadError("name is required");
  if (!source.trim()) throw new InvalidLeadError("source is required");
  if (estimatedValue !== undefined && (!Number.isFinite(estimatedValue) || estimatedValue < 0)) {
    throw new InvalidLeadError("estimatedValue must be a non-negative number");
  }
}

@Injectable()
export class CrmService {
  constructor(
    @Inject(LEAD_STORE) private readonly leadStore: LeadStore,
    @Inject(CRM_ACTIVITY_STORE) private readonly activityStore: CrmActivityStore,
    private readonly customerService: CustomerService
  ) {}

  async createLead(tenantId: string, id: string, input: CreateLeadInput): Promise<Lead> {
    validateLead(input.name, input.source, input.estimatedValue);
    const now = new Date();
    const lead: Lead = {
      id,
      tenantId,
      name: input.name.trim(),
      contactPhone: input.contactPhone?.trim() || undefined,
      contactEmail: input.contactEmail?.trim() || undefined,
      source: input.source.trim(),
      stage: "new",
      estimatedValue: input.estimatedValue,
      ownerUserId: input.ownerUserId,
      createdAt: now,
      lastActivityAt: now,
    };
    await this.leadStore.save(lead);
    return lead;
  }

  async listForTenant(tenantId: string): Promise<Lead[]> {
    return this.leadStore.findAllForTenant(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Lead | null> {
    return this.leadStore.findById(tenantId, id);
  }

  /**
   * A real interaction — refreshes lastActivityAt, the exact field
   * CrmStaleLeadCheckService reads. This is the one place activities are
   * ever created; there's no separate "edit lead" path that could
   * accidentally bump the clock without a real activity actually
   * happening.
   */
  async logActivity(tenantId: string, leadId: string, id: string, input: LogActivityInput): Promise<CrmActivity> {
    const lead = await this.leadStore.findById(tenantId, leadId);
    if (!lead) throw new LeadNotFoundError(leadId);
    if (!input.body.trim()) throw new InvalidLeadError("activity body is required");

    const activity: CrmActivity = {
      id,
      tenantId,
      leadId,
      type: input.type,
      body: input.body.trim(),
      createdAt: new Date(),
      createdByUserId: input.createdByUserId,
    };
    await this.activityStore.save(activity);
    await this.leadStore.save({ ...lead, lastActivityAt: activity.createdAt });
    return activity;
  }

  async listActivitiesForLead(tenantId: string, leadId: string): Promise<CrmActivity[]> {
    return this.activityStore.findAllForLead(tenantId, leadId);
  }

  /**
   * Moving to "won" is the one stage transition with a real side effect:
   * matching or creating a real Customer record, so a sale can actually be
   * recorded against this lead's contact once it converts. Deliberately
   * simple exact-match-by-phone-or-email over the tenant's full customer
   * list, not a database-side lookup — same "pilot-scale, not
   * indexed-search infrastructure" reasoning CustomerService.search()'s own
   * comment already gives for this codebase; reused rather than adding a
   * new CustomerStore method for the same tradeoff. A lead moved away from
   * "won" later (a real correction) does NOT un-link or delete the
   * customer that transition already created — a customer that exists in
   * the real world doesn't stop existing because a CRM stage was
   * miscategorized.
   */
  async moveStage(tenantId: string, id: string, stage: LeadStage): Promise<Lead> {
    const existing = await this.leadStore.findById(tenantId, id);
    if (!existing) throw new LeadNotFoundError(id);

    let wonCustomerId = existing.wonCustomerId;
    if (stage === "won" && !wonCustomerId) {
      wonCustomerId = (await this.matchOrCreateCustomer(tenantId, existing)).id;
    }

    const updated: Lead = { ...existing, stage, wonCustomerId, lastActivityAt: new Date() };
    await this.leadStore.save(updated);
    return updated;
  }

  private async matchOrCreateCustomer(tenantId: string, lead: Lead): Promise<Customer> {
    const all = await this.customerService.listForTenant(tenantId);
    const matched = all.find(
      (c) => (lead.contactPhone && c.phone === lead.contactPhone) || (lead.contactEmail && c.email === lead.contactEmail)
    );
    if (matched) return matched;
    return this.customerService.create(tenantId, randomUUID(), lead.name, lead.contactPhone, lead.contactEmail);
  }
}
