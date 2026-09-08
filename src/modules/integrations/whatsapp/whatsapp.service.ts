import { PendingVerificationError } from "../pending-integration";

/**
 * Master Plan Section 8 status: Assumed.
 * Confirmed: Meta operates a Cloud API with self-serve access, and via
 * approved Business Solution Providers (BizAI, a named competitor, is
 * confirmed as one).
 * NOT confirmed: exact costs, template-message approval turnaround, and
 * rate limits at pilot scale. Do not build against assumed numbers for any
 * of those — confirm directly with Meta or a BSP first (checklist item,
 * Master Plan Section 16).
 */
export interface WhatsAppService {
  sendTemplateMessage(toE164Phone: string, templateName: string, params: string[]): Promise<{ messageId: string }>;
  sendFreeformReply(toE164Phone: string, body: string): Promise<{ messageId: string }>;
}

export class NotYetVerifiedWhatsAppService implements WhatsAppService {
  async sendTemplateMessage(): Promise<{ messageId: string }> {
    throw new PendingVerificationError(
      "WhatsApp Business API",
      "Assumed",
      "access route (direct Cloud API vs. BSP), cost, and template-approval turnaround not yet confirmed with Meta/a BSP"
    );
  }

  async sendFreeformReply(): Promise<{ messageId: string }> {
    throw new PendingVerificationError(
      "WhatsApp Business API",
      "Assumed",
      "access route (direct Cloud API vs. BSP), cost, and template-approval turnaround not yet confirmed with Meta/a BSP"
    );
  }
}
