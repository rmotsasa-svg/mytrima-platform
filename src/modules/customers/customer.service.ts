import { Inject, Injectable } from "@nestjs/common";
import { CUSTOMER_STORE } from "./customer.tokens";
import { RatingService, Rating } from "../reputation/rating.service";
import { ConsentService, ConsentRecord } from "../compliance/consent.service";

/**
 * Master Plan Section 7 (Data Model) names `customer` as the table every
 * conversation, review, and payment attaches to — `db/migrations/0001` has
 * created it, with RLS, since this scaffold's first migration. What never
 * existed until now is any way to create one: found as a real, concrete gap
 * while proving the Postgres-backed RatingStore's restart persistence —
 * `rating.customer_id` has a real foreign-key constraint against this table,
 * and in-memory mode never enforced it, so the missing endpoint was invisible
 * until Postgres was real.
 *
 * Expanded from create+list to a real minimal CRM: get one, edit, search,
 * and a "customer activity" view aggregating the ratings and consent records
 * this same customerId already appears in elsewhere in the platform — real
 * data that already exists, not a new table invented for this. Two things
 * the Master Plan's own CRM description ("centralized customer records from
 * connected channels") implies but this deliberately does NOT build:
 *   - Conversation history: Master Plan Section 5 assigns actual message
 *     logging to a separate Messaging Service (the WhatsApp adapter), not
 *     this module's own table — and there is no conversation data anywhere
 *     in this system yet, since WhatsApp integration itself is still
 *     "Assumed," not built (see src/modules/integrations/whatsapp/).
 *     Aggregating something that doesn't exist would mean inventing it.
 *   - Merge/deduplication of two customer records: no product spec exists
 *     for this anywhere in the Master Plan, and it is a genuinely
 *     high-risk data operation to guess at — what happens to two
 *     customers' existing ratings/consent history on merge is exactly the
 *     kind of decision that needs a real product/legal answer (POPIA
 *     accountability likely cares which customer record a consent grant
 *     legally belongs to), not an assumption baked into code no one asked
 *     for. Flagged here as deliberately deferred, same as the PayFast/
 *     Yoco/Ozow stub above.
 */

/** Added at the tenant's own explicit request (2026-09-15) — real,
 * bounded set rather than free text, so this stays usable for a real
 * demographic breakdown later instead of accumulating inconsistent
 * spellings. "prefer_not_to_say" is a real, honest option, not an
 * omission — a customer asked and declining is different information
 * from never having been asked at all (the field simply being unset). */
export type CustomerGender = "female" | "male" | "other" | "prefer_not_to_say";

const VALID_GENDERS: readonly CustomerGender[] = ["female", "male", "other", "prefer_not_to_say"];

export interface Customer {
  id: string;
  tenantId: string;
  displayName?: string;
  phone?: string;
  email?: string;
  gender?: CustomerGender;
  /** Free text, same discipline as TenantRecord.location — a town/area
   * name, not a structured address; no geocoding or validation beyond a
   * trim, since nothing downstream needs more than a human-readable label
   * yet. */
  location?: string;
  createdAt: Date;
}

export interface CustomerActivity {
  customer: Customer;
  ratings: Rating[];
  consentRecords: ConsentRecord[];
}

export class InvalidCustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCustomerError";
  }
}

export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`No customer found with id "${id}"`);
    this.name = "CustomerNotFoundError";
  }
}

export interface CustomerStore {
  save(customer: Customer): Promise<void>;
  findAllForTenant(tenantId: string): Promise<Customer[]>;
  /** Same tenantId-scoping reasoning as every other store's findById in this
   * codebase (RatingStore, AuthUserStore, ...): an id-only lookup has no
   * tenant to scope a real RLS-enforced query to. */
  findById(tenantId: string, id: string): Promise<Customer | null>;
}

function requireAtLeastOneIdentifyingField(displayName?: string, phone?: string, email?: string): void {
  if (!displayName?.trim() && !phone?.trim() && !email?.trim()) {
    throw new InvalidCustomerError("A customer needs at least one of displayName, phone, or email");
  }
}

function validateGender(gender: string): asserts gender is CustomerGender {
  if (!(VALID_GENDERS as readonly string[]).includes(gender)) {
    throw new InvalidCustomerError(`gender must be one of ${VALID_GENDERS.join(", ")} — got "${gender}"`);
  }
}

@Injectable()
export class CustomerService {
  constructor(
    @Inject(CUSTOMER_STORE) private readonly store: CustomerStore,
    private readonly ratingService: RatingService,
    private readonly consentService: ConsentService
  ) {}

  /**
   * All three identifying fields are optional at the database level (a
   * customer might be known only by phone, only by email, or only by a name
   * jotted down on a paper form) — but a customer with none of them is not
   * useful to anything downstream (nothing to display, nothing to correlate
   * a WhatsApp/mobile-money event against later), so at least one is required
   * here even though the schema itself doesn't enforce it.
   */
  async create(
    tenantId: string,
    id: string,
    displayName?: string,
    phone?: string,
    email?: string,
    gender?: string,
    location?: string
  ): Promise<Customer> {
    requireAtLeastOneIdentifyingField(displayName, phone, email);
    if (gender?.trim()) validateGender(gender.trim());
    const customer: Customer = {
      id,
      tenantId,
      displayName: displayName?.trim() || undefined,
      phone: phone?.trim() || undefined,
      email: email?.trim() || undefined,
      gender: (gender?.trim() as CustomerGender) || undefined,
      location: location?.trim() || undefined,
      createdAt: new Date(),
    };
    await this.store.save(customer);
    return customer;
  }

  async listForTenant(tenantId: string): Promise<Customer[]> {
    return this.store.findAllForTenant(tenantId);
  }

  /**
   * Deliberately simple substring filter over the tenant's full customer
   * list rather than a database-side search query — Master Plan Section 2's
   * own stated principle ("right-size before scale... the pilot serves
   * 5–10 tenants") is exactly the case for not building indexed search
   * infrastructure a pilot-scale customer list doesn't need yet.
   */
  async search(tenantId: string, query: string): Promise<Customer[]> {
    const all = await this.store.findAllForTenant(tenantId);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) => c.displayName?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
    );
  }

  async findById(tenantId: string, id: string): Promise<Customer | null> {
    return this.store.findById(tenantId, id);
  }

  /**
   * True PATCH semantics — found and fixed only by actually curl-testing
   * this live: the first working version unconditionally overwrote all
   * three fields on every call, so a PATCH sending only `displayName` (the
   * realistic case: "just rename this customer") silently wiped out an
   * existing `phone`/`email` the caller never meant to touch, because
   * `undefined` was treated identically to "clear this field." Fixed by
   * distinguishing the two: a field left out of the call (`undefined`)
   * keeps its existing value; a field explicitly sent as an empty/
   * whitespace string is treated as an intentional clear. The "at least one
   * identifying field" rule is checked against the *resulting* record, not
   * the raw arguments — so clearing the customer's only identifying field
   * is still rejected, even though clearing an already-undefined field
   * (nothing to lose) is not.
   */
  async update(
    tenantId: string,
    id: string,
    displayName?: string,
    phone?: string,
    email?: string,
    gender?: string,
    location?: string
  ): Promise<Customer> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new CustomerNotFoundError(id);

    // Same explicit-empty-clears/omitted-keeps distinction as the three
    // fields above — see this method's own top comment for why. An
    // explicit empty string clears gender back to "not recorded" the same
    // way it clears displayName/phone/email; a real value is validated
    // against the same bounded set create() uses.
    const trimmedGender = gender !== undefined ? gender.trim() : undefined;
    if (trimmedGender) validateGender(trimmedGender);

    const updated: Customer = {
      ...existing,
      displayName: displayName !== undefined ? displayName.trim() || undefined : existing.displayName,
      phone: phone !== undefined ? phone.trim() || undefined : existing.phone,
      email: email !== undefined ? email.trim() || undefined : existing.email,
      gender: gender !== undefined ? (trimmedGender as CustomerGender) || undefined : existing.gender,
      location: location !== undefined ? location.trim() || undefined : existing.location,
    };
    requireAtLeastOneIdentifyingField(updated.displayName, updated.phone, updated.email);
    await this.store.save(updated);
    return updated;
  }

  /**
   * The "customer 360" view — real data this same customerId already
   * appears in elsewhere (ratings, consent records), assembled in one place.
   * See this file's top comment for what's deliberately NOT included here
   * (conversation history, merge) and why.
   */
  async getActivity(tenantId: string, id: string): Promise<CustomerActivity> {
    const customer = await this.store.findById(tenantId, id);
    if (!customer) throw new CustomerNotFoundError(id);
    const [allRatings, consentRecords] = await Promise.all([
      this.ratingService.findAllForTenant(tenantId),
      this.consentService.exportForDsar(tenantId, id),
    ]);
    return { customer, ratings: allRatings.filter((r) => r.customerId === id), consentRecords };
  }
}
