import { WhatsAppCloudApiService, WhatsAppApiError, NotYetVerifiedWhatsAppService } from "./whatsapp.service";
import { PendingVerificationError } from "../pending-integration";

/**
 * These tests mock `fetch` for deterministic, network-free CI runs — same
 * discipline as meta.service.test.ts/mopay.service.test.ts. See
 * whatsapp.service.ts's own top comment and README.md for what is and isn't
 * live-verified.
 */
function mockFetchResolvedOnce(body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ json: async () => body });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

test("sendTemplateMessage posts the correct template body to /{phone-number-id}/messages, with a Bearer auth header", async () => {
  const fetchMock = mockFetchResolvedOnce({ messaging_product: "whatsapp", messages: [{ id: "wamid.123" }] });
  const service = new WhatsAppCloudApiService("test-phone-number-id", "test-access-token");

  const result = await service.sendTemplateMessage("+26612345678", "hello_world", []);

  expect(result).toEqual({ messageId: "wamid.123" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://graph.facebook.com/v26.0/test-phone-number-id/messages");
  expect(options.method).toBe("POST");
  expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
  const body = JSON.parse(options.body as string);
  expect(body).toEqual({
    messaging_product: "whatsapp",
    to: "+26612345678",
    type: "template",
    template: { name: "hello_world", language: { code: "en_US" } },
  });
});

test("sendTemplateMessage includes a body component with text parameters when params are given", async () => {
  const fetchMock = mockFetchResolvedOnce({ messages: [{ id: "wamid.456" }] });
  const service = new WhatsAppCloudApiService("test-phone-number-id", "test-access-token");

  await service.sendTemplateMessage("+26612345678", "mytrima_notification", ["A customer left a low rating"]);

  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(options.body as string);
  expect(body.template.components).toEqual([{ type: "body", parameters: [{ type: "text", text: "A customer left a low rating" }] }]);
});

test("sendTemplateMessage throws WhatsAppApiError when the Cloud API returns an error object", async () => {
  mockFetchResolvedOnce({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } });
  const service = new WhatsAppCloudApiService("test-phone-number-id", "bad-token");
  await expect(service.sendTemplateMessage("+26612345678", "hello_world", [])).rejects.toThrow(WhatsAppApiError);
});

test("sendFreeformReply posts a plain text message", async () => {
  const fetchMock = mockFetchResolvedOnce({ messages: [{ id: "wamid.789" }] });
  const service = new WhatsAppCloudApiService("test-phone-number-id", "test-access-token");

  const result = await service.sendFreeformReply("+26612345678", "Thanks for your message!");

  expect(result).toEqual({ messageId: "wamid.789" });
  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(options.body as string);
  expect(body).toEqual({ messaging_product: "whatsapp", to: "+26612345678", type: "text", text: { body: "Thanks for your message!" } });
});

test("sendFreeformReply throws WhatsAppApiError when the Cloud API returns an error object", async () => {
  mockFetchResolvedOnce({ error: { message: "Recipient phone number not in allowed list.", type: "OAuthException", code: 131030 } });
  const service = new WhatsAppCloudApiService("test-phone-number-id", "test-access-token");
  await expect(service.sendFreeformReply("+26612345678", "Hi")).rejects.toThrow(WhatsAppApiError);
});

test("NotYetVerifiedWhatsAppService still throws PendingVerificationError — the fallback when no real credentials are configured", async () => {
  const service = new NotYetVerifiedWhatsAppService();
  await expect(service.sendTemplateMessage("+26612345678", "hello_world", [])).rejects.toThrow(PendingVerificationError);
  await expect(service.sendFreeformReply("+26612345678", "hi")).rejects.toThrow(PendingVerificationError);
});
