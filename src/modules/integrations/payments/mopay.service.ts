/**
 * Master Plan Section 8 status: UPGRADED from "Needs verification" to
 * Verified (API confirmed) — corrected explicitly, same pattern as the
 * Hellopeter status correction in Master Plan v1.2. MoPay's integration API
 * is public, documented at mopay.co.ls/docs, and sandbox access is
 * self-serve: create a free account, get an API key instantly, no approval
 * needed (confirmed directly from the vendor's own docs, not a compliance
 * summary). This is a real client shaped to match that documented API, and
 * has been run — for real — against the live MoPay sandbox: a genuine
 * session was created and retrieved successfully via a real sandbox API
 * key, confirming auth, request shape, and response parsing all actually
 * work, not just that they compile against a mock. `mopay.service.test.ts`
 * still mocks `fetch` for the unit-level tests (deterministic, no network
 * dependency in CI); the live call is what actually proved this works.
 *
 * NOT YET exercised: an actual payment outcome. Creating/retrieving a
 * session is confirmed; walking a documented preset test number (M-Pesa
 * 52211111 = immediate success, 52233333 = failed, etc.) through the hosted
 * checkout page to confirm a session transitions from CREATED to COMPLETED
 * has not been done. Do that before treating the full payment flow —
 * not just session creation — as verified.
 *
 * What's still genuinely unconfirmed (not in the public docs): the exact
 * transaction-fee percentage (the marketing site confirms "transaction-based
 * fees + a one-time M500 onboarding fee," but not the rate) and settlement
 * time (same-day vs. multi-day) — both still need a direct question to
 * MoPay, per Master Plan Section 9's "ask for" list. Do not assume a
 * specific number for either.
 *
 * Architecturally different from the original LesothoMobileMoneyService
 * interface (lesotho-mobile-money.service.ts): MoPay is a hosted-checkout
 * redirect flow (create a session, redirect the customer to MoPay's page,
 * they pick M-Pesa/EcoCash/card themselves, you get redirected back and
 * verify), not a direct "charge this phone number" push API. This service
 * intentionally does not implement the generic LesothoMobileMoneyService
 * interface — that shape doesn't match how MoPay actually works, and forcing
 * it to fit would misrepresent the real integration.
 */

export class InvalidPaymentReferenceError extends Error {
  constructor(reference: string) {
    super(`MoPay payment reference must contain only alphanumeric characters, got "${reference}"`);
    this.name = "InvalidPaymentReferenceError";
  }
}

export class MoPayApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoPayApiError";
  }
}

// Documented constraint (mopay.co.ls/docs): "Reference Format: Must contain
// only alphanumeric characters. No spaces, hyphens, underscores, or special
// characters." Enforced client-side so a caller gets a clear error
// immediately rather than a vague API rejection after a round trip.
const REFERENCE_PATTERN = /^[A-Za-z0-9]+$/;

const DEFAULT_BASE_URL = "https://mopay.co.ls";

export interface CreatePaymentSessionInput {
  /** String, not number — matches the documented request body exactly (e.g. "100.00"). */
  amount: string;
  reference: string;
  redirectUrl: string;
  description?: string;
  customerEmail?: string;
  customerName?: string;
}

export interface CreatePaymentSessionResult {
  sessionId: string;
  paymentUrl: string;
  reference: string;
  amount: string;
}

export type MoPaySessionStatus = "CREATED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED";
export type MoPayTransactionStatus = "success" | "failed" | "cancelled" | null;

export interface MoPaySessionDetails {
  sessionId: string;
  amount: string;
  reference: string;
  status: MoPaySessionStatus;
  transactionStatus: MoPayTransactionStatus;
  transactionId?: string;
  selectedPaymentMethod?: string;
}

/**
 * Thin client for MoPay's documented external payment API
 * (mopay.co.ls/docs). Takes the API key via constructor, not an env read
 * inside methods — matches how AuthService takes its JWT secret, and keeps
 * this class trivially testable with a fake key.
 */
export class MoPayService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL
  ) {}

  /** Step 1 of the documented flow: create a session, then redirect the
   * customer's browser to the returned paymentUrl. */
  async createPaymentSession(input: CreatePaymentSessionInput): Promise<CreatePaymentSessionResult> {
    if (!REFERENCE_PATTERN.test(input.reference)) {
      throw new InvalidPaymentReferenceError(input.reference);
    }

    const res = await fetch(`${this.baseUrl}/api/external/payment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const data = await res.json();

    if (!data.success) {
      throw new MoPayApiError(data.error ?? `MoPay returned an error (HTTP ${res.status})`);
    }
    return { sessionId: data.sessionId, paymentUrl: data.paymentUrl, reference: data.reference, amount: data.amount };
  }

  /** Step 3 of the documented flow: after the customer is redirected back,
   * verify via this endpoint rather than trusting redirect query params
   * alone (the docs explicitly warn those can be tampered with).
   *
   * CONFIRMED LIVE (real sandbox call, not a guess): MoPay's session-detail
   * response is far larger than the public docs show, and includes the raw
   * project API key — twice, once on the session and again nested under
   * `project.apiKey` — plus the account owner's name and email under
   * `project.user`. None of that is optional here: this method explicitly
   * picks only the documented, safe-to-forward fields off the raw response
   * rather than returning it wholesale, specifically so a caller can never
   * accidentally serialize this into an HTTP response, a log line, or a
   * webhook payload and leak the API key. Do not change this to `return
   * data.session` — that reintroduces exactly that leak. */
  async getSession(sessionId: string): Promise<MoPaySessionDetails> {
    const res = await fetch(`${this.baseUrl}/api/external/session/v1/${encodeURIComponent(sessionId)}`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();

    if (!data.success) {
      throw new MoPayApiError(data.error ?? `MoPay returned an error (HTTP ${res.status})`);
    }
    const session = data.session;
    return {
      sessionId: session.sessionId,
      amount: session.amount,
      reference: session.reference,
      status: session.status,
      transactionStatus: session.transactionStatus,
      transactionId: session.transactionId ?? undefined,
      selectedPaymentMethod: session.selectedPaymentMethod ?? undefined,
    };
  }
}
