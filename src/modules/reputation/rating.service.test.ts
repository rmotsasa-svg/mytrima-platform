import { RatingService, InvalidRatingError } from "./rating.service";
import { InMemoryRatingStore } from "./in-memory-rating.store";

test("submit creates a rating with status 'pending'", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const rating = await service.submit("t1", "c1", 5, "r1", "Great service");
  expect(rating.status).toBe("pending");
  expect(rating.stars).toBe(5);
});

test("submit rejects out-of-range stars", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  await expect(service.submit("t1", "c1", 0, "r1")).rejects.toThrow(InvalidRatingError);
  await expect(service.submit("t1", "c1", 6, "r2")).rejects.toThrow(InvalidRatingError);
});

test("submit rejects non-integer stars", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  await expect(service.submit("t1", "c1", 3.5, "r1")).rejects.toThrow(InvalidRatingError);
});

test("moderate to 'public' updates status", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const rating = await service.submit("t1", "c1", 4, "r1");
  await service.moderate("t1", rating.id, "public");
  const agg = await service.aggregateForTenant("t1");
  expect(agg.count).toBe(1);
});

test("moderate to 'hidden' keeps it out of the aggregate", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const rating = await service.submit("t1", "c1", 1, "r1");
  await service.moderate("t1", rating.id, "hidden");
  const agg = await service.aggregateForTenant("t1");
  expect(agg.count).toBe(0);
});

test("moderate rejects an invalid target status", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const rating = await service.submit("t1", "c1", 4, "r1");
  await expect(service.moderate("t1", rating.id, "pending" as "public")).rejects.toThrow(InvalidRatingError);
});

test("aggregateForTenant only counts 'public' ratings, not 'pending' or 'hidden'", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const a = await service.submit("t1", "c1", 5, "r1");
  const b = await service.submit("t1", "c2", 3, "r2");
  await service.submit("t1", "c3", 1, "r3"); // left pending
  await service.moderate("t1", a.id, "public");
  await service.moderate("t1", b.id, "hidden");
  const agg = await service.aggregateForTenant("t1");
  expect(agg.count).toBe(1);
  expect(agg.averageStars).toBe(5);
});

/**
 * Regression test for a real gap surfaced while building the Postgres-
 * backed RatingStore: moderate() originally took only an id, with no tenant
 * to scope a real RLS-enforced query to — a caller from the wrong tenant
 * must not be able to moderate (and thus publish) another tenant's rating.
 */
test("moderate does nothing when called with the wrong tenantId — cannot moderate another tenant's rating", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const rating = await service.submit("tenant-A", "c1", 5, "r-cross-tenant");
  await service.moderate("tenant-B", rating.id, "public");
  const agg = await service.aggregateForTenant("tenant-A");
  expect(agg.count).toBe(0); // still pending — the cross-tenant moderate attempt had no effect
});

/**
 * Regression coverage for the real gap RatingController's moderate endpoint
 * used to flag inline: it couldn't produce a notificationsForModeratedRating
 * event because RatingStore had no findById to look up the rating's own
 * customerId/stars from just the id. moderate() now returns the updated
 * Rating for exactly that purpose.
 */
test("moderate returns the updated rating, with customerId/stars available for the caller", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const rating = await service.submit("t1", "c1", 2, "r1", "Not great");
  const updated = await service.moderate("t1", rating.id, "hidden");
  expect(updated).not.toBeNull();
  expect(updated!.customerId).toBe("c1");
  expect(updated!.stars).toBe(2);
  expect(updated!.status).toBe("hidden");
});

test("moderate returns null for a wrong-tenant or unknown id — a caller learns nothing about whether it exists", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const rating = await service.submit("tenant-A", "c1", 5, "r1");
  expect(await service.moderate("tenant-B", rating.id, "public")).toBeNull();
  expect(await service.moderate("tenant-A", "no-such-id", "public")).toBeNull();
});

test("aggregateForTenant returns 0 count and 0 average when no public ratings exist, not NaN", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const agg = await service.aggregateForTenant("t1");
  expect(agg.count).toBe(0);
  expect(agg.averageStars).toBe(0);
});

test("aggregateForTenant is tenant-scoped: another tenant's public rating does not count", async () => {
  const service = new RatingService(new InMemoryRatingStore());
  const rating = await service.submit("tenant-A", "c1", 5, "r1");
  await service.moderate("tenant-A", rating.id, "public");
  const agg = await service.aggregateForTenant("tenant-B");
  expect(agg.count).toBe(0);
});

test("hand-calculated mixed average matches the engine", async () => {
  // Public ratings: 5, 4, 3 -> average 4.00
  const service = new RatingService(new InMemoryRatingStore());
  const r1 = await service.submit("t1", "c1", 5, "r1");
  const r2 = await service.submit("t1", "c2", 4, "r2");
  const r3 = await service.submit("t1", "c3", 3, "r3");
  await service.moderate("t1", r1.id, "public");
  await service.moderate("t1", r2.id, "public");
  await service.moderate("t1", r3.id, "public");
  const agg = await service.aggregateForTenant("t1");
  expect(agg.count).toBe(3);
  expect(agg.averageStars).toBe(4);
});
