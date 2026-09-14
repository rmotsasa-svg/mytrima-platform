import { CrmStaleLeadCheckService, isLeadStale, daysSinceActivity } from "./crm-stale-lead-check.service";
import { CrmService } from "./crm.service";
import { InMemoryLeadStore } from "./in-memory-lead.store";
import { InMemoryCrmActivityStore } from "./in-memory-crm-activity.store";
import { CustomerService } from "../customers/customer.service";
import { InMemoryCustomerStore } from "../customers/in-memory-customer.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { ConsentService } from "../compliance/consent.service";
import { InMemoryConsentStore } from "../compliance/in-memory-consent.store";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { TriggerService } from "../triggers/trigger.service";
import { InMemoryTriggerStore } from "../triggers/in-memory-trigger.store";
import { GrowthActionService } from "../growth-actions/growth-action.service";
import { InMemoryGrowthActionStore } from "../growth-actions/in-memory-growth-action.store";

const NOW = new Date("2026-09-14T12:00:00.000Z");

test("daysSinceActivity floors — a lead at 6.9 days has not yet had 7 full days", () => {
  const lastActivityAt = new Date(NOW.getTime() - 6.9 * 24 * 60 * 60 * 1000);
  expect(daysSinceActivity(lastActivityAt, NOW)).toBe(6);
});

test("isLeadStale is false for an open lead just under the threshold", () => {
  const lastActivityAt = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
  expect(isLeadStale({ stage: "qualified", lastActivityAt }, 7, NOW)).toBe(false);
});

test("isLeadStale is true for an open lead at exactly the threshold", () => {
  const lastActivityAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
  expect(isLeadStale({ stage: "qualified", lastActivityAt }, 7, NOW)).toBe(true);
});

test("isLeadStale is true for an open lead well past the threshold", () => {
  const lastActivityAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
  expect(isLeadStale({ stage: "new", lastActivityAt }, 7, NOW)).toBe(true);
});

test("isLeadStale is false for a won or lost lead no matter how old — no clock on a closed lead", () => {
  const veryOld = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000);
  expect(isLeadStale({ stage: "won", lastActivityAt: veryOld }, 7, NOW)).toBe(false);
  expect(isLeadStale({ stage: "lost", lastActivityAt: veryOld }, 7, NOW)).toBe(false);
});

test("checkAllTenants returns 0 and does nothing when there is no pool (DATABASE_URL unset)", async () => {
  const customerService = new CustomerService(new InMemoryCustomerStore(), new RatingService(new InMemoryRatingStore()), new ConsentService(new InMemoryConsentStore()));
  const crmService = new CrmService(new InMemoryLeadStore(), new InMemoryCrmActivityStore(), customerService);
  const service = new CrmStaleLeadCheckService(
    null,
    crmService,
    new NotificationDeliveryService(null),
    new TriggerService(new InMemoryTriggerStore(), new GrowthActionService(new InMemoryGrowthActionStore()))
  );
  await expect(service.checkAllTenants()).resolves.toBe(0);
});
