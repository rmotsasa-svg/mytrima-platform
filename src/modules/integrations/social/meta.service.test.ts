import { MetaGraphSocialService, MetaApiError } from "./meta.service";

/**
 * These tests mock `fetch` for deterministic, network-free CI runs — same
 * discipline as mopay.service.test.ts. Not yet run against the live Graph
 * API with a real Page access token (that needs the user to generate one
 * via Graph API Explorer first); see meta.service.ts's own class comment
 * for exactly what is and isn't confirmed.
 */

function mockFetchResolvedOnce(body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ json: async () => body });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

test("publishPost posts a text-only message to /{page-id}/feed", async () => {
  const fetchMock = mockFetchResolvedOnce({ id: "123456789_987654321" });
  const service = new MetaGraphSocialService("test-page-token");

  const result = await service.publishPost("123456789", "Hello from Mytrima!");

  expect(result).toEqual({ postId: "123456789_987654321" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://graph.facebook.com/v26.0/123456789/feed");
  expect(options.method).toBe("POST");
  const body = options.body as URLSearchParams;
  expect(body.get("message")).toBe("Hello from Mytrima!");
  expect(body.get("access_token")).toBe("test-page-token");
});

test("publishPost with an imageUrl posts to /{page-id}/photos instead, with the message as the caption", async () => {
  const fetchMock = mockFetchResolvedOnce({ id: "photo-id-1", post_id: "123456789_555555555" });
  const service = new MetaGraphSocialService("test-page-token");

  const result = await service.publishPost("123456789", "Check out our new look!", "https://example.com/photo.jpg");

  // Normalized to the real post id (post_id), not the photo's own id.
  expect(result).toEqual({ postId: "123456789_555555555" });
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://graph.facebook.com/v26.0/123456789/photos");
  const body = options.body as URLSearchParams;
  expect(body.get("url")).toBe("https://example.com/photo.jpg");
  expect(body.get("caption")).toBe("Check out our new look!");
});

test("publishPost throws MetaApiError when the Graph API returns an error object", async () => {
  mockFetchResolvedOnce({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } });
  const service = new MetaGraphSocialService("bad-token");
  await expect(service.publishPost("123456789", "Hello")).rejects.toThrow(MetaApiError);
});

test("fetchEngagementSummary reads reactions/comments/shares from the correct post and fields", async () => {
  const fetchMock = mockFetchResolvedOnce({
    reactions: { summary: { total_count: 42 } },
    comments: { summary: { total_count: 7 } },
    shares: { count: 3 },
  });
  const service = new MetaGraphSocialService("test-page-token");

  const summary = await service.fetchEngagementSummary("123456789_987654321");

  expect(summary).toEqual({ likes: 42, comments: 7, shares: 3 });
  const [url] = fetchMock.mock.calls[0] as [string];
  // Decode before asserting on the `fields` param's contents — URLSearchParams
  // correctly percent-encodes "(" and ")" (real behavior, not a bug), so
  // checking for the literal unencoded substring would be asserting on the
  // wrong thing.
  expect(url).toContain("https://graph.facebook.com/v26.0/123456789_987654321");
  const decoded = decodeURIComponent(url);
  expect(decoded).toContain("reactions.summary(true)");
  expect(decoded).toContain("comments.summary(true)");
});

test("fetchEngagementSummary defaults shares to 0 when a post has never been shared (Meta omits the field entirely)", async () => {
  mockFetchResolvedOnce({ reactions: { summary: { total_count: 5 } }, comments: { summary: { total_count: 0 } } });
  const service = new MetaGraphSocialService("test-page-token");

  const summary = await service.fetchEngagementSummary("123456789_987654321");

  expect(summary).toEqual({ likes: 5, comments: 0, shares: 0 });
});

test("fetchEngagementSummary throws MetaApiError when the Graph API returns an error object", async () => {
  mockFetchResolvedOnce({ error: { message: "Unsupported get request.", type: "GraphMethodException", code: 100 } });
  const service = new MetaGraphSocialService("test-page-token");
  await expect(service.fetchEngagementSummary("nonexistent")).rejects.toThrow(MetaApiError);
});
