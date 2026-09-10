import { MetaOAuthService, NoFacebookPageFoundError } from "./meta-oauth.service";
import { MetaApiError } from "../integrations/social/meta.service";

/**
 * Mocks fetch for deterministic, network-free CI runs — same discipline as
 * mopay.service.test.ts/meta.service.test.ts. The real exchange (dialog/oauth
 * redirect through an actual Facebook login) was walked by hand once, live,
 * to connect the real "Mytrima" Page — see the README's own record of that.
 */
function mockFetchSequence(...bodies: unknown[]): jest.Mock {
  const mock = jest.fn();
  for (const body of bodies) mock.mockResolvedValueOnce({ json: async () => body });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

test("buildAuthorizationUrl includes the app id, redirect uri, tenantId as state, and all four required scopes", () => {
  const service = new MetaOAuthService("test-app-id", "test-app-secret");
  const url = service.buildAuthorizationUrl("t1", "https://example.com/social/callback");

  expect(url).toContain("https://www.facebook.com/v26.0/dialog/oauth?");
  const parsed = new URL(url);
  expect(parsed.searchParams.get("client_id")).toBe("test-app-id");
  expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/social/callback");
  expect(parsed.searchParams.get("state")).toBe("t1");
  const scopes = (parsed.searchParams.get("scope") ?? "").split(",");
  expect(scopes.sort()).toEqual(["pages_manage_posts", "pages_read_engagement", "pages_read_user_content", "pages_show_list"].sort());
});

test("handleCallback exchanges the code for a user token, then resolves the first managed Page and its own Page token", async () => {
  mockFetchSequence(
    { access_token: "real-user-token", token_type: "bearer" },
    { data: [{ id: "123456789", name: "Mytrima", access_token: "real-page-token" }] }
  );
  const service = new MetaOAuthService("test-app-id", "test-app-secret");

  const connection = await service.handleCallback("t1", "auth-code-123", "https://example.com/social/callback");

  expect(connection.tenantId).toBe("t1");
  expect(connection.pageId).toBe("123456789");
  expect(connection.pageName).toBe("Mytrima");
  expect(connection.pageAccessToken).toBe("real-page-token");
  expect(connection.provider).toBe("facebook");
});

test("handleCallback throws NoFacebookPageFoundError when the account manages no Pages", async () => {
  mockFetchSequence({ access_token: "real-user-token" }, { data: [] });
  const service = new MetaOAuthService("test-app-id", "test-app-secret");
  await expect(service.handleCallback("t1", "auth-code-123", "https://example.com/social/callback")).rejects.toThrow(NoFacebookPageFoundError);
});

test("handleCallback throws MetaApiError when the code exchange itself fails", async () => {
  mockFetchSequence({ error: { message: "This authorization code has expired.", type: "OAuthException", code: 100 } });
  const service = new MetaOAuthService("test-app-id", "test-app-secret");
  await expect(service.handleCallback("t1", "expired-code", "https://example.com/social/callback")).rejects.toThrow(MetaApiError);
});
