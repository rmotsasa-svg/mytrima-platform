import crypto from "node:crypto";

/**
 * Master Plan Section 17's merchant-of-record decision (confirmed
 * 2026-09-10, business decision — see README): Mytrima collects payments
 * on Tenants' behalf, not each Tenant holding their own merchant account.
 * A single Mytrima PayFast merchant account processes every customer
 * payment; PayFast's own "Split Payments" feature instantly routes each
 * Tenant's share to that Tenant's own PayFast merchant account at the
 * moment of payment — checked directly against PayFast's current developer
 * docs (developers.payfast.co.za/docs, 2026-09-10), not memory. PayFast was
 * chosen over Yoco/Ozow specifically because it publishes a documented
 * split-payment primitive built for exactly this platform-commerce shape;
 * neither of the other two named vendors does.
 *
 * REAL FINDING from reading the docs, not assumed: PayFast's integration
 * model is NOT a JSON create-session API like MoPay's — there is no
 * server-to-server "create payment" call. It's a redirect flow: construct
 * a set of form fields (merchant credentials, transaction details, an MD5
 * signature) and have the customer's own browser POST them directly to
 * PayFast's hosted payment page. `buildPaymentRequest()` below returns
 * exactly those fields plus the action URL a caller renders as an
 * auto-submitting HTML form — there is nothing to `await` in that step,
 * unlike MoPay's `createPaymentSession()`.
 *
 * Each Tenant needs their own PayFast merchant account to receive a split
 * — `splitPayment.merchantId` below is that Tenant's PayFast merchant ID,
 * not Mytrima's own. Onboarding a Tenant onto PayFast (or collecting their
 * existing merchant ID) is a real product/support flow this file does not
 * build — same "not our decision to invent" discipline as everywhere else
 * in this project.
 */

export interface PayFastConfig {
  merchantId: string;
  merchantKey: string;
  /** Required for subscriptions; optional but strongly recommended for a
   * once-off payment's signature — see buildSignature()'s own comment on
   * why an unset passphrase is a real, documented, weaker mode, not a bug. */
  passphrase?: string;
  sandbox: boolean;
}

export interface SplitPaymentInput {
  /** The Tenant's own PayFast merchant ID — not Mytrima's. */
  merchantId: string;
  /** In cents (ZAR). Required if `percentage` isn't given. */
  amount?: number;
  /** 0–100. Required if `amount` isn't given. */
  percentage?: number;
  /** In cents (ZAR) — floors the split amount. */
  min?: number;
  /** In cents (ZAR) — caps the split amount. */
  max?: number;
}

export interface CreatePaymentRequestInput {
  /** Decimal string matching PayFast's own documented format, e.g. "100.00". */
  amount: string;
  itemName: string;
  /** Unique payment id on Mytrima's own system — echoed back in the ITN. */
  mPaymentId: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  itemDescription?: string;
  nameFirst?: string;
  nameLast?: string;
  emailAddress?: string;
  splitPayment?: SplitPaymentInput;
}

export interface PaymentFormRequest {
  /** Where the caller's rendered HTML form should POST to. */
  actionUrl: string;
  /** Every hidden input the form needs, `signature` included, in the exact
   * order PayFast's own docs list them (order matters for the signature
   * PayFast itself recomputes on arrival — see buildSignature()). */
  fields: Array<{ name: string; value: string }>;
}

export class PayFastConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayFastConfigError";
  }
}

const LIVE_PROCESS_URL = "https://www.payfast.co.za/eng/process";
const SANDBOX_PROCESS_URL = "https://sandbox.payfast.co.za/eng/process";
const LIVE_VALIDATE_URL = "https://www.payfast.co.za/eng/query/validate";
const SANDBOX_VALIDATE_URL = "https://sandbox.payfast.co.za/eng/query/validate";

// PayFast's signature algorithm needs PHP's own urlencode() semantics
// exactly: uppercase %XX hex, space encoded as "+", and only [A-Za-z0-9_.-]
// left unescaped. JS's built-in encodeURIComponent is NOT a drop-in match —
// it leaves !~*'() unescaped (PHP's urlencode does not) and encodes space
// as %20, not "+". Getting this wrong produces a signature PayFast's own
// server never accepts, which is exactly the class of bug the docs' own
// "Common causes of a failed integration / signature mismatch" page exists
// to explain — implemented as a precise byte-level match here instead.
export function phpUrlEncode(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  let out = "";
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.-]/.test(ch)) {
      out += ch;
    } else if (ch === " ") {
      out += "+";
    } else {
      out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

// The exact field order PayFast's docs present the attributes in — the
// signature is an MD5 of the non-blank fields concatenated in THIS order,
// not alphabetical (the docs explicitly warn: "Do not use the API
// signature format, which uses alphabetical ordering!"). `setup` (the
// split-payment JSON) is deliberately absent — the docs state it is "Not
// included in the signature."
const SIGNATURE_FIELD_ORDER = [
  "merchant_id",
  "merchant_key",
  "return_url",
  "cancel_url",
  "notify_url",
  "name_first",
  "name_last",
  "email_address",
  "m_payment_id",
  "amount",
  "item_name",
  "item_description",
] as const;

/** Builds the MD5 signature over `fields` (in SIGNATURE_FIELD_ORDER,
 * skipping blanks) plus the passphrase, exactly as PayFast's own PHP
 * example does — this is the OUTBOUND-request signature only (the fields
 * WE choose to send, in the fixed documented attribute order). Do NOT
 * reuse this for verifying an inbound ITN — see
 * buildSignatureFromRawFields()'s own comment on why ITN payloads need a
 * genuinely different approach (a real bug this project's own live
 * sandbox testing caught: an ITN's field set — `pf_payment_id`,
 * `payment_status`, `amount_gross`, etc. — doesn't match this list at
 * all, so signature verification silently always failed until fixed). */
export function buildSignature(fields: Partial<Record<(typeof SIGNATURE_FIELD_ORDER)[number], string>>, passphrase?: string): string {
  const parts: string[] = [];
  for (const key of SIGNATURE_FIELD_ORDER) {
    const value = fields[key];
    if (value !== undefined && value !== "") {
      parts.push(`${key}=${phpUrlEncode(value)}`);
    }
  }
  let paramString = parts.join("&");
  if (passphrase) {
    paramString += `&passphrase=${phpUrlEncode(passphrase)}`;
  }
  return crypto.createHash("md5").update(paramString).digest("hex");
}

/**
 * REAL BUG, found 2026-09-10 by actually POSTing a self-signed ITN through
 * this project's own /payments/itn endpoint, not assumed correct: an
 * inbound ITN's signature must be verified by re-serializing WHATEVER
 * fields PayFast actually sent, in the order they arrived — exactly what
 * PayFast's own PHP validation example does (`foreach($pfData as $key =>
 * $val)`, PHP arrays preserving insertion order same as a JS object's
 * string keys) — NOT the fixed, small SIGNATURE_FIELD_ORDER list above,
 * which only covers the outbound checkout request's own field set and
 * doesn't even contain several real ITN field names (`pf_payment_id`,
 * `payment_status`, `amount_gross` vs. the outbound request's `amount`).
 * Using buildSignature() for ITN verification made signatureValid always
 * false, silently — caught only by actually sending a self-signed ITN and
 * checking the logged result, not by any unit test mocking the shape away.
 */
export function buildSignatureFromRawFields(fields: Record<string, string>, passphrase?: string): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "signature") continue;
    if (value !== undefined && value !== "") {
      parts.push(`${key}=${phpUrlEncode(value)}`);
    }
  }
  let paramString = parts.join("&");
  if (passphrase) {
    paramString += `&passphrase=${phpUrlEncode(passphrase)}`;
  }
  return crypto.createHash("md5").update(paramString).digest("hex");
}

/**
 * Real client for PayFast's documented Custom Integration + Split Payments
 * flow. Takes merchant credentials via constructor, same pattern as every
 * other integration client in this codebase (MoPayService's apiKey,
 * MetaGraphSocialService's pageAccessToken) — trivially testable with fake
 * credentials, no env read buried inside methods.
 */
export class PayFastService {
  constructor(private readonly config: PayFastConfig) {}

  private get processUrl(): string {
    return this.config.sandbox ? SANDBOX_PROCESS_URL : LIVE_PROCESS_URL;
  }

  private get validateUrl(): string {
    return this.config.sandbox ? SANDBOX_VALIDATE_URL : LIVE_VALIDATE_URL;
  }

  /** No network call — this is the whole point of PayFast's redirect
   * model (see this file's own top comment). The caller renders `fields`
   * as hidden inputs in a form that POSTs to `actionUrl`. */
  buildPaymentRequest(input: CreatePaymentRequestInput): PaymentFormRequest {
    if (input.splitPayment && !input.splitPayment.amount && input.splitPayment.percentage === undefined) {
      throw new PayFastConfigError("splitPayment needs at least one of amount or percentage");
    }

    const signatureFields: Partial<Record<(typeof SIGNATURE_FIELD_ORDER)[number], string>> = {
      merchant_id: this.config.merchantId,
      merchant_key: this.config.merchantKey,
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      notify_url: input.notifyUrl,
      name_first: input.nameFirst,
      name_last: input.nameLast,
      email_address: input.emailAddress,
      m_payment_id: input.mPaymentId,
      amount: input.amount,
      item_name: input.itemName,
      item_description: input.itemDescription,
    };
    const signature = buildSignature(signatureFields, this.config.passphrase);

    // Rendered in the same field order for readability — PayFast itself
    // doesn't require any particular order for the actual form post, only
    // the signature calculation above is order-sensitive.
    const fields: Array<{ name: string; value: string }> = [];
    for (const key of SIGNATURE_FIELD_ORDER) {
      const value = signatureFields[key];
      if (value !== undefined && value !== "") fields.push({ name: key, value });
    }
    fields.push({ name: "signature", value: signature });

    // `setup` is deliberately appended after the signature is computed —
    // see SIGNATURE_FIELD_ORDER's own comment on why it's excluded from
    // the hash itself.
    if (input.splitPayment) {
      const { merchantId, amount, percentage, min, max } = input.splitPayment;
      const splitPayment: Record<string, number> = { merchant_id: Number(merchantId) };
      if (percentage !== undefined) splitPayment.percentage = percentage;
      if (amount !== undefined) splitPayment.amount = amount;
      if (min !== undefined) splitPayment.min = min;
      if (max !== undefined) splitPayment.max = max;
      fields.push({ name: "setup", value: JSON.stringify({ split_payment: splitPayment }) });
    }

    return { actionUrl: this.processUrl, fields };
  }

  /** Verifies an inbound ITN's own `signature` field by recomputing it the
   * identical way buildSignature() does — the first of PayFast's own
   * documented four security checks. Returns false rather than throwing on
   * a mismatch; a caller decides what "an ITN failed verification" means
   * for its own flow (log and drop, alert, etc.), same as
   * MetaApiError-style callers get to decide their own handling. */
  verifyItnSignature(fields: Record<string, string>): boolean {
    const expected = buildSignatureFromRawFields(fields, this.config.passphrase);
    return fields.signature === expected;
  }

  /**
   * PayFast's own documented third check: a real server-to-server POST
   * back to PayFast confirming the ITN's data genuinely matches what
   * PayFast itself has on record for that transaction — the docs are
   * explicit that a valid signature alone is not sufficient, since it only
   * proves the payload wasn't altered in transit, not that PayFast is the
   * one who actually sent it.
   */
  async confirmWithPayFastServer(fields: Record<string, string>): Promise<boolean> {
    const body = Object.entries(fields)
      .filter(([key]) => key !== "signature")
      .map(([key, value]) => `${key}=${phpUrlEncode(value)}`)
      .join("&");
    const res = await fetch(this.validateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    return text.trim() === "VALID";
  }
}
