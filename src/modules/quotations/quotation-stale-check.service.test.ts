import { QuotationStaleCheckService, isQuotationStale, daysSinceSent } from "./quotation-stale-check.service";
import { QuotationService } from "./quotation.service";
import { InMemoryQuotationStore } from "./in-memory-quotation.store";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { TriggerService } from "../triggers/trigger.service";
import { InMemoryTriggerStore } from "../triggers/in-memory-trigger.store";
import { GrowthActionService } from "../growth-actions/growth-action.service";
import { InMemoryGrowthActionStore } from "../growth-actions/in-memory-growth-action.store";
import { GoalService } from "../goals/goal.service";
import { InMemoryGoalStore } from "../goals/in-memory-goal.store";

const NOW = new Date("2026-09-17T12:00:00.000Z");

test("daysSinceSent floors — a quotation sent 6.9 days ago has not yet had 7 full days", () => {
  const sentAt = new Date(NOW.getTime() - 6.9 * 24 * 60 * 60 * 1000);
  expect(daysSinceSent(sentAt, NOW)).toBe(6);
});

test("isQuotationStale is false for a draft — nothing has been sent yet, so there's no clock", () => {
  expect(isQuotationStale({ status: "draft", sentAt: undefined, convertedToSaleId: undefined }, 7, NOW)).toBe(false);
});

test("isQuotationStale is false for a sent quotation just under the threshold", () => {
  const sentAt = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
  expect(isQuotationStale({ status: "sent", sentAt, convertedToSaleId: undefined }, 7, NOW)).toBe(false);
});

test("isQuotationStale is true for a sent quotation at exactly the threshold", () => {
  const sentAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
  expect(isQuotationStale({ status: "sent", sentAt, convertedToSaleId: undefined }, 7, NOW)).toBe(true);
});

test("isQuotationStale is false for an already-converted quotation no matter how old — it's already a won sale, not a cooling lead", () => {
  const veryOld = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000);
  expect(isQuotationStale({ status: "sent", sentAt: veryOld, convertedToSaleId: "sale1" }, 7, NOW)).toBe(false);
});

test("checkAllTenants returns 0 and does nothing when there is no pool (DATABASE_URL unset)", async () => {
  const goalService = new GoalService(new InMemoryGoalStore());
  const growthActionService = new GrowthActionService(new InMemoryGrowthActionStore(), goalService);
  const service = new QuotationStaleCheckService(
    null,
    new QuotationService(new InMemoryQuotationStore()),
    new NotificationDeliveryService(null),
    new TriggerService(new InMemoryTriggerStore(), growthActionService)
  );
  await expect(service.checkAllTenants()).resolves.toBe(0);
});
