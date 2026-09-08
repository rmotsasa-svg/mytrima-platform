import { Inject, Injectable } from "@nestjs/common";
import { CONSENT_STORE } from "./consent.tokens";

/**
 * Master Plan Section 10: "Consent as a first-class data model — every
 * category of personal data collected records its own lawful basis and
 * timestamp, not a single blanket consent flag."
 *
 * This is deliberately simple domain logic with no external dependency, so
 * it is genuinely buildable and testable now. What it does NOT do — and
 * should not be extended to do without legal sign-off — is decide what
 * counts as a valid lawful basis for a given data category in Lesotho or
 * South African law. That determination belongs to retained counsel
 * (Master Plan Section 16); this module only enforces that *some* basis and
 * timestamp is recorded before data of a given category is used, and makes
 * revocation and DSAR export/delete mechanically possible.
 */

export type LawfulBasis = "consent" | "contract" | "legitimate_interest" | "legal_obligation";

export interface ConsentRecord {
  id: string;
  tenantId: string;
  customerId: string;
  dataCategory: string; // e.g. "survey_response", "whatsapp_marketing", "review_publication"
  lawfulBasis: LawfulBasis;
  grantedAt: Date;
  revokedAt?: Date;
}

export class ConsentNotFoundError extends Error {
  constructor(customerId: string, dataCategory: string) {
    super(`No active consent record for customer ${customerId}, category "${dataCategory}"`);
    this.name = "ConsentNotFoundError";
  }
}

export interface ConsentStore {
  save(record: ConsentRecord): Promise<void>;
  findActive(tenantId: string, customerId: string, dataCategory: string): Promise<ConsentRecord | null>;
  findAllForCustomer(tenantId: string, customerId: string): Promise<ConsentRecord[]>;
  /**
   * Takes tenantId, not just an id — found while building the Postgres-
   * backed store: an id-only signature has no tenant to scope
   * app.current_tenant_id to, so a real RLS-enforced UPDATE would either
   * have to run outside tenant context (defeating RLS entirely) or —
   * what actually happens if you try — silently affect zero rows, since
   * the row is invisible without a matching tenant context. Revoking
   * something that isn't yours (wrong tenantId) is expected to no-op, the
   * same as it does today in-memory.
   */
  revoke(tenantId: string, id: string, revokedAt: Date): Promise<void>;
}

@Injectable()
export class ConsentService {
  constructor(@Inject(CONSENT_STORE) private readonly store: ConsentStore) {}

  async grant(tenantId: string, customerId: string, dataCategory: string, lawfulBasis: LawfulBasis, id: string): Promise<ConsentRecord> {
    const record: ConsentRecord = { id, tenantId, customerId, dataCategory, lawfulBasis, grantedAt: new Date() };
    await this.store.save(record);
    return record;
  }

  /**
   * Throws rather than returning a boolean: callers that forget to check
   * a boolean return value silently proceed as if consent existed. A thrown
   * ConsentNotFoundError forces the caller to handle the absence explicitly
   * — appropriate for a check that gates whether personal data may be used.
   */
  async assertHasConsent(tenantId: string, customerId: string, dataCategory: string): Promise<ConsentRecord> {
    const record = await this.store.findActive(tenantId, customerId, dataCategory);
    if (!record) throw new ConsentNotFoundError(customerId, dataCategory);
    return record;
  }

  async revoke(tenantId: string, id: string): Promise<void> {
    await this.store.revoke(tenantId, id, new Date());
  }

  /** Supports the DSAR export requirement (Master Plan Section 10). */
  async exportForDsar(tenantId: string, customerId: string): Promise<ConsentRecord[]> {
    return this.store.findAllForCustomer(tenantId, customerId);
  }
}
