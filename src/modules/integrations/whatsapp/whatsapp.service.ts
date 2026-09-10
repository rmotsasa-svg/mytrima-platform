import { PendingVerificationError } from "../pending-integration";

/**
 * Master Plan Section 8 status: UPGRADED 2026-09-10 from "Assumed" to a real
 * client, same pattern as MoPay/Meta Graph API before it. Checked directly
 * against Meta's current WhatsApp Cloud API docs (developers.facebook.com,
 * Graph API v26.0, 2026-09-10) — direct Cloud API access, the route this
 * project already has an app for (the same Meta Developer app used for
 * Facebook/Instagram — WhatsApp is a product added to that same app, not a
 * separate developer registration), not a third-party BSP.
 *
 * STILL NOT CONFIRMED, and this client doesn't pretend otherwise: real
 * production costs (Meta charges per conversation once past any free tier),
 * and template-approval turnaround for a real, business-specific template —
 * see WhatsAppCloudApiService's own comment on what "hello_world" is
 * standing in for below and why.
 */
export interface WhatsAppService {
  sendTemplateMessage(toE164Phone: string, templateName: string, params: string[]): Promise<{ messageId: string }>;
  sendFreeformReply(toE164Phone: string, body: string): Promise<{ messageId: string }>;
}

export class NotYetVerifiedWhatsAppService implements WhatsAppService {
  async sendTemplateMessage(_toE164Phone: string, _templateName: string, _params: string[]): Promise<{ messageId: string }> {
    throw new PendingVerificationError(
      "WhatsApp Business API",
      "Assumed",
      "WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN not configured — see WhatsAppCloudApiService for the real client this falls back from"
    );
  }

  async sendFreeformReply(_toE164Phone: string, _body: string): Promise<{ messageId: string }> {
    throw new PendingVerificationError(
      "WhatsApp Business API",
      "Assumed",
      "WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN not configured — see WhatsAppCloudApiService for the real client this falls back from"
    );
  }
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

const GRAPH_API_VERSION = "v26.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Real client for the WhatsApp Cloud API. Takes the sending phone number's
 * own Phone Number ID and a Bearer access token via constructor — same
 * "trivially testable with a fake credential" pattern as MetaGraphSocialService's
 * pageAccessToken.
 *
 * `sendTemplateMessage` is the only call that can reach a customer/tenant
 * outside a 24-hour customer-service window (per the docs: a freeform
 * message is only allowed within 24 hours of that recipient's last inbound
 * message to this number) — every notification this platform sends is
 * business-initiated, never in reply to an inbound message, so
 * `sendFreeformReply` exists for completeness (interface parity with the
 * stub it replaces) but `notification-worker.service.ts` only ever calls
 * `sendTemplateMessage`.
 */
export class WhatsAppCloudApiService implements WhatsAppService {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string
  ) {}

  async sendTemplateMessage(toE164Phone: string, templateName: string, params: string[]): Promise<{ messageId: string }> {
    return this.post({
      messaging_product: "whatsapp",
      to: toE164Phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        ...(params.length > 0 ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}),
      },
    });
  }

  async sendFreeformReply(toE164Phone: string, body: string): Promise<{ messageId: string }> {
    return this.post({ messaging_product: "whatsapp", to: toE164Phone, type: "text", text: { body } });
  }

  private async post(body: unknown): Promise<{ messageId: string }> {
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(this.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) {
      throw new WhatsAppApiError(`WhatsApp Cloud API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    return { messageId: data.messages?.[0]?.id };
  }
}
