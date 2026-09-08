import { PendingVerificationError } from "../pending-integration";

/**
 * Master Plan Section 8 status: Needs verification — Pay-Lesotho ONLY.
 * MoPay has been split out into its own file (mopay.service.ts) now that its
 * API is publicly documented and self-serve — see that file. This stub still
 * covers Pay-Lesotho specifically: confirmed to be a real, operating Lesotho
 * business offering mobile-money access, but its API documentation, sandbox
 * availability, settlement times, and integration fees have not been
 * obtained. This service must NOT store full payment credentials regardless
 * of which aggregator is chosen (Master Plan Section 7, PaymentReference
 * entity) — only a reference to the gateway-side transaction.
 */
export interface LesothoMobileMoneyService {
  initiatePayment(customerPhoneE164: string, amountLSL: number, reference: string): Promise<{ paymentReferenceId: string; status: "pending" }>;
  checkStatus(paymentReferenceId: string): Promise<{ status: "pending" | "settled" | "failed" }>;
}

export class NotYetVerifiedLesothoMobileMoneyService implements LesothoMobileMoneyService {
  async initiatePayment(): Promise<{ paymentReferenceId: string; status: "pending" }> {
    throw new PendingVerificationError("M-Pesa/EcoCash via Pay-Lesotho", "Needs verification", "API docs, sandbox access, fees, and settlement terms not yet obtained from Pay-Lesotho");
  }

  async checkStatus(): Promise<{ status: "pending" | "settled" | "failed" }> {
    throw new PendingVerificationError("M-Pesa/EcoCash via Pay-Lesotho", "Needs verification", "API docs, sandbox access, fees, and settlement terms not yet obtained from Pay-Lesotho");
  }
}
