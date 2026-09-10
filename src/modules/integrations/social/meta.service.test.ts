import { MetaGraphSocialService, MetaApiError } from "./meta.service";

/**
 * These tests mock `fetch` for deterministic, network-free CI runs — same
 * discipline as mopay.service.test.ts. The Facebook-side methods here (and
 * the OAuth flow that feeds them a real token) are also live-verified end
 * to end — see meta.service.ts's own class comment and README.md for the
 * full trace. The Instagram methods below are NOT yet live-verified — see
 * meta.service.ts's own comment on why (no Instagram account linked to the
 * test Page yet).
 */

function mockFetchResolvedOnce(body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ json: async () => body });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

function mockFetchSequence(...bodies: unknown[]): jest.Mock {
  const mock = jest.fn();
  for (const body of bodies) mock.mockResolvedValueOnce({ json: async () => body });
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

test("updatePost posts the new message to /{post-id} directly, not /feed", async () => {
  const fetchMock = mockFetchResolvedOnce({ success: true });
  const service = new MetaGraphSocialService("test-page-token");

  const result = await service.updatePost("123456789_987654321", "Updated message");

  expect(result).toEqual({ success: true });
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://graph.facebook.com/v26.0/123456789_987654321");
  expect(options.method).toBe("POST");
  expect((options.body as URLSearchParams).get("message")).toBe("Updated message");
});

test("updatePost throws MetaApiError when the Graph API returns an error object", async () => {
  mockFetchResolvedOnce({ error: { message: "Unsupported post request.", type: "GraphMethodException", code: 100 } });
  const service = new MetaGraphSocialService("test-page-token");
  await expect(service.updatePost("nonexistent", "X")).rejects.toThrow(MetaApiError);
});

test("deletePost sends a DELETE request to /{post-id}", async () => {
  const fetchMock = mockFetchResolvedOnce({ success: true });
  const service = new MetaGraphSocialService("test-page-token");

  const result = await service.deletePost("123456789_987654321");

  expect(result).toEqual({ success: true });
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("https://graph.facebook.com/v26.0/123456789_987654321");
  expect(options.method).toBe("DELETE");
});

test("deletePost throws MetaApiError when the Graph API returns an error object", async () => {
  mockFetchResolvedOnce({ error: { message: "Unsupported delete request.", type: "GraphMethodException", code: 100 } });
  const service = new MetaGraphSocialService("test-page-token");
  await expect(service.deletePost("nonexistent")).rejects.toThrow(MetaApiError);
});

test("resolveInstagramAccount returns the linked Instagram account id", async () => {
  const fetchMock = mockFetchResolvedOnce({ instagram_business_account: { id: "17841400000000000" }, id: "123456789" });
  const service = new MetaGraphSocialService("test-page-token");

  const igId = await service.resolveInstagramAccount("123456789");

  expect(igId).toBe("17841400000000000");
  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toContain("https://graph.facebook.com/v26.0/123456789");
  expect(decodeURIComponent(url)).toContain("fields=instagram_business_account");
});

test("resolveInstagramAccount returns null when the Page has no linked Instagram account (field simply absent, not an error)", async () => {
  mockFetchResolvedOnce({ id: "123456789" });
  const service = new MetaGraphSocialService("test-page-token");

  const igId = await service.resolveInstagramAccount("123456789");

  expect(igId).toBeNull();
});

test("resolveInstagramAccount throws MetaApiError when the Graph API returns an error object", async () => {
  mockFetchResolvedOnce({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } });
  const service = new MetaGraphSocialService("bad-token");
  await expect(service.resolveInstagramAccount("123456789")).rejects.toThrow(MetaApiError);
});

test("publishInstagramPost creates a media container then publishes it, in two calls", async () => {
  const fetchMock = mockFetchSequence({ id: "container-id-1" }, { id: "17900000000000000" });
  const service = new MetaGraphSocialService("test-page-token");

  const result = await service.publishInstagramPost("17841400000000000", "https://example.com/photo.jpg", "New season, new look!");

  expect(result).toEqual({ postId: "17900000000000000" });
  expect(fetchMock).toHaveBeenCalledTimes(2);

  const [containerUrl, containerOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(containerUrl).toBe("https://graph.facebook.com/v26.0/17841400000000000/media");
  const containerBody = containerOptions.body as URLSearchParams;
  expect(containerBody.get("image_url")).toBe("https://example.com/photo.jpg");
  expect(containerBody.get("caption")).toBe("New season, new look!");

  const [publishUrl, publishOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(publishUrl).toBe("https://graph.facebook.com/v26.0/17841400000000000/media_publish");
  expect((publishOptions.body as URLSearchParams).get("creation_id")).toBe("container-id-1");
});

test("publishInstagramPost omits caption entirely when none is given", async () => {
  const fetchMock = mockFetchSequence({ id: "container-id-2" }, { id: "17900000000000001" });
  const service = new MetaGraphSocialService("test-page-token");

  await service.publishInstagramPost("17841400000000000", "https://example.com/photo2.jpg");

  const [, containerOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect((containerOptions.body as URLSearchParams).has("caption")).toBe(false);
});

test("publishInstagramPost throws MetaApiError when container creation fails, without attempting to publish", async () => {
  const fetchMock = mockFetchSequence({ error: { message: "Invalid image URL.", type: "OAuthException", code: 100 } });
  const service = new MetaGraphSocialService("test-page-token");

  await expect(service.publishInstagramPost("17841400000000000", "not-a-real-url")).rejects.toThrow(MetaApiError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("publishInstagramPost throws MetaApiError when the publish step itself fails", async () => {
  mockFetchSequence({ id: "container-id-3" }, { error: { message: "Media ID is not available.", type: "OAuthException", code: 9007 } });
  const service = new MetaGraphSocialService("test-page-token");

  await expect(service.publishInstagramPost("17841400000000000", "https://example.com/photo.jpg")).rejects.toThrow(MetaApiError);
});

// --- Account metrics, added 2026-09-10 for the Business Snapshot report ---

test("fetchPageFollowerCount reads the plain followers_count field", async () => {
  const fetchMock = mockFetchResolvedOnce({ followers_count: 842, id: "123456789" });
  const service = new MetaGraphSocialService("test-page-token");

  await expect(service.fetchPageFollowerCount("123456789")).resolves.toBe(842);
  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toBe("https://graph.facebook.com/v26.0/123456789?fields=followers_count&access_token=test-page-token");
});

test("fetchPageFollowerCount defaults to 0 when Meta omits the field entirely, same as an unshared post", async () => {
  mockFetchResolvedOnce({ id: "123456789" });
  const service = new MetaGraphSocialService("test-page-token");
  await expect(service.fetchPageFollowerCount("123456789")).resolves.toBe(0);
});

test("fetchPageInsights sums each day's value for page_impressions and page_views_total separately", async () => {
  const fetchMock = mockFetchResolvedOnce({
    data: [
      { name: "page_impressions", period: "day", values: [{ value: 40 }, { value: 55 }] },
      { name: "page_views_total", period: "day", values: [{ value: 3 }, { value: 5 }] },
    ],
  });
  const service = new MetaGraphSocialService("test-page-token");

  const result = await service.fetchPageInsights("123456789", new Date("2026-08-01T00:00:00Z"), new Date("2026-08-02T00:00:00Z"));
  expect(result).toEqual({ impressions: 95, views: 8 });
  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toContain("/123456789/insights?");
  expect(url).toContain("metric=page_impressions%2Cpage_views_total");
  expect(url).toContain("period=day");
});

test("fetchPageInsights defaults a metric to 0 when Meta's response omits it", async () => {
  mockFetchResolvedOnce({ data: [{ name: "page_impressions", period: "day", values: [{ value: 10 }] }] });
  const service = new MetaGraphSocialService("test-page-token");
  const result = await service.fetchPageInsights("123456789", new Date("2026-08-01"), new Date("2026-08-02"));
  expect(result).toEqual({ impressions: 10, views: 0 });
});

test("fetchPageInsights throws MetaApiError on a Graph API error (e.g. read_insights not granted)", async () => {
  mockFetchResolvedOnce({ error: { message: "(#10) Application does not have permission for this action", type: "OAuthException", code: 10 } });
  const service = new MetaGraphSocialService("bad-token");
  await expect(service.fetchPageInsights("123456789", new Date(), new Date())).rejects.toThrow(MetaApiError);
});

test("fetchPageMessageThreadCount counts only threads updated inside the window, across pagination", async () => {
  const fetchMock = jest.fn();
  fetchMock.mockResolvedValueOnce({
    json: async () => ({
      data: [{ id: "t1", updated_time: "2026-08-05T10:00:00+0000" }, { id: "t2", updated_time: "2026-07-01T10:00:00+0000" }],
      paging: { next: "https://graph.facebook.com/v26.0/123456789/conversations?after=CURSOR" },
    }),
  });
  fetchMock.mockResolvedValueOnce({
    json: async () => ({ data: [{ id: "t3", updated_time: "2026-08-20T10:00:00+0000" }] }),
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  const service = new MetaGraphSocialService("test-page-token");

  // t1 and t3 fall in August, t2 (July) does not.
  const count = await service.fetchPageMessageThreadCount("123456789", new Date("2026-08-01T00:00:00Z"), new Date("2026-08-31T23:59:59Z"));
  expect(count).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect((fetchMock.mock.calls[1] as [string])[0]).toBe("https://graph.facebook.com/v26.0/123456789/conversations?after=CURSOR");
});

test("fetchInstagramFollowerCount reads the plain followers_count field on the IG user node", async () => {
  mockFetchResolvedOnce({ followers_count: 310, id: "17841400000000000" });
  const service = new MetaGraphSocialService("test-page-token");
  await expect(service.fetchInstagramFollowerCount("17841400000000000")).resolves.toBe(310);
});

test("fetchInstagramInsights requests views and reach — never impressions, since Meta removed it from the IG API entirely", async () => {
  const fetchMock = mockFetchResolvedOnce({
    data: [
      { name: "views", period: "day", values: [{ value: 100 }, { value: 120 }] },
      { name: "reach", period: "day", values: [{ value: 60 }, { value: 70 }] },
    ],
  });
  const service = new MetaGraphSocialService("test-page-token");

  const result = await service.fetchInstagramInsights("17841400000000000", new Date("2026-08-01"), new Date("2026-08-02"));
  expect(result).toEqual({ views: 220, reach: 130 });
  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toContain("metric=views%2Creach");
  expect(url).not.toContain("impressions");
});
