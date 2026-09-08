import { GoogleBusinessProfileService, GoogleBusinessApiError } from "./google-business.service";

/**
 * These tests mock `fetch` — obtaining a real OAuth access token requires a
 * completed consent screen and a full user consent round-trip (see the
 * class comment in google-business.service.ts), which has not been done in
 * this environment. They verify request shaping and response parsing
 * against the documented Review resource schema
 * (developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews),
 * not against a live call.
 */

function mockFetchResolvedOnce(ok: boolean, status: number, body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ ok, status, json: async () => body });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

test("fetchReviews calls the documented endpoint with the Bearer access token", async () => {
  const fetchMock = mockFetchResolvedOnce(true, 200, { reviews: [] });
  const service = new GoogleBusinessProfileService();

  await service.fetchReviews("test-access-token", "12345", "67890");

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://mybusiness.googleapis.com/v4/accounts/12345/locations/67890/reviews");
  expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
});

test("fetchReviews normalizes the documented ONE..FIVE starRating enum to a 1-5 number", async () => {
  mockFetchResolvedOnce(true, 200, {
    reviews: [
      { name: "accounts/1/locations/2/reviews/r1", reviewId: "r1", starRating: "FIVE", comment: "Great!", createTime: "2026-01-01T00:00:00Z", updateTime: "2026-01-01T00:00:00Z" },
      { name: "accounts/1/locations/2/reviews/r2", reviewId: "r2", starRating: "ONE", createTime: "2026-01-02T00:00:00Z", updateTime: "2026-01-02T00:00:00Z" },
      { name: "accounts/1/locations/2/reviews/r3", reviewId: "r3", starRating: "STAR_RATING_UNSPECIFIED", createTime: "2026-01-03T00:00:00Z", updateTime: "2026-01-03T00:00:00Z" },
    ],
  });
  const service = new GoogleBusinessProfileService();

  const reviews = await service.fetchReviews("token", "1", "2");

  expect(reviews[0].starRating).toBe(5);
  expect(reviews[1].starRating).toBe(1);
  expect(reviews[2].starRating).toBe(0);
});

test("fetchReviews surfaces a business reply's comment and the reviewer's display name", async () => {
  mockFetchResolvedOnce(true, 200, {
    reviews: [
      {
        name: "accounts/1/locations/2/reviews/r1",
        reviewId: "r1",
        reviewer: { displayName: "Jane D.", isAnonymous: false },
        starRating: "FOUR",
        comment: "Good service",
        createTime: "2026-01-01T00:00:00Z",
        updateTime: "2026-01-01T00:00:00Z",
        reviewReply: { comment: "Thanks for the feedback!", updateTime: "2026-01-02T00:00:00Z" },
      },
    ],
  });
  const service = new GoogleBusinessProfileService();

  const [review] = await service.fetchReviews("token", "1", "2");

  expect(review.reviewer?.displayName).toBe("Jane D.");
  expect(review.replyComment).toBe("Thanks for the feedback!");
});

test("fetchReviews returns an empty array when a location has no reviews yet", async () => {
  mockFetchResolvedOnce(true, 200, {});
  const service = new GoogleBusinessProfileService();
  const reviews = await service.fetchReviews("token", "1", "2");
  expect(reviews).toEqual([]);
});

test("fetchReviews throws GoogleBusinessApiError on a non-OK response, using the API's own error message", async () => {
  mockFetchResolvedOnce(false, 403, { error: { message: "The caller does not have permission" } });
  const service = new GoogleBusinessProfileService();
  await expect(service.fetchReviews("expired-token", "1", "2")).rejects.toThrow(GoogleBusinessApiError);
  await expect(service.fetchReviews("expired-token", "1", "2")).rejects.toThrow("The caller does not have permission");
});
