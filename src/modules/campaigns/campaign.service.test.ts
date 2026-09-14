import { CampaignService, InvalidCampaignError, CampaignNotFoundError } from "./campaign.service";
import { InMemoryCampaignStore } from "./in-memory-campaign.store";
import { DealService } from "../deals/deal.service";
import { InMemoryDealStore } from "../deals/in-memory-deal.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { InMemoryCatalogItemStore } from "../catalog/in-memory-catalog-item.store";

function makeServices() {
  const catalogService = new CatalogService(new InMemoryCatalogItemStore());
  const dealService = new DealService(new InMemoryDealStore(), catalogService);
  const campaignService = new CampaignService(new InMemoryCampaignStore(), dealService);
  return { catalogService, dealService, campaignService };
}

test("create persists a campaign with the given channels", async () => {
  const { campaignService } = makeServices();
  const campaign = await campaignService.create("t1", "c1", { name: "Spring Push", channels: ["facebook", "website"] });
  expect(campaign.channels).toEqual(["facebook", "website"]);
  expect(campaign.name).toBe("Spring Push");
});

test("create rejects an empty name", async () => {
  const { campaignService } = makeServices();
  await expect(campaignService.create("t1", "c1", { name: "  ", channels: ["facebook"] })).rejects.toThrow(InvalidCampaignError);
});

test("create rejects a campaign with no channels", async () => {
  const { campaignService } = makeServices();
  await expect(campaignService.create("t1", "c1", { name: "Push", channels: [] })).rejects.toThrow(InvalidCampaignError);
});

test("create rejects a dealId from a different tenant", async () => {
  const { campaignService, catalogService, dealService } = makeServices();
  const item = await catalogService.create("t2", "i1", "Haircut", "service", 150);
  const deal = await dealService.create("t2", "d1", { name: "Deal", discountType: "percentage_off", percentageOff: 10, catalogItemIds: [item.id] });
  await expect(campaignService.create("t1", "c1", { name: "Push", dealId: deal.id, channels: ["facebook"] })).rejects.toThrow(InvalidCampaignError);
});

test("buildMessage uses the campaign's own explicit message when set", async () => {
  const { campaignService } = makeServices();
  const campaign = await campaignService.create("t1", "c1", { name: "Push", message: "Custom copy!", channels: ["facebook"] });
  expect(await campaignService.buildMessage("t1", campaign)).toBe("Custom copy!");
});

test("buildMessage falls back to the linked deal's own real default message", async () => {
  const { campaignService, catalogService, dealService } = makeServices();
  const item = await catalogService.create("t1", "i1", "Haircut", "service", 150);
  const deal = await dealService.create("t1", "d1", { name: "20% off haircuts", discountType: "percentage_off", percentageOff: 20, catalogItemIds: [item.id] });
  const campaign = await campaignService.create("t1", "c1", { name: "Push", dealId: deal.id, channels: ["facebook"] });
  const message = await campaignService.buildMessage("t1", campaign);
  expect(message).toContain("20% off haircuts");
  expect(message).toContain("20% off");
});

test("buildMessage falls back to the campaign's own name with no message and no deal", async () => {
  const { campaignService } = makeServices();
  const campaign = await campaignService.create("t1", "c1", { name: "Just The Name", channels: ["website"] });
  expect(await campaignService.buildMessage("t1", campaign)).toBe("Just The Name");
});

test("recordLaunch sets real lastLaunchedAt/lastLaunchResults", async () => {
  const { campaignService } = makeServices();
  const campaign = await campaignService.create("t1", "c1", { name: "Push", channels: ["website"] });
  expect(campaign.lastLaunchedAt).toBeUndefined();
  const launched = await campaignService.recordLaunch("t1", campaign.id, [{ channel: "website", status: "info", detail: "link" }]);
  expect(launched.lastLaunchedAt).toBeInstanceOf(Date);
  expect(launched.lastLaunchResults).toEqual([{ channel: "website", status: "info", detail: "link" }]);
});

test("recordLaunch throws CampaignNotFoundError for a wrong tenant or unknown id", async () => {
  const { campaignService } = makeServices();
  const campaign = await campaignService.create("t1", "c1", { name: "Push", channels: ["website"] });
  await expect(campaignService.recordLaunch("t2", campaign.id, [])).rejects.toThrow(CampaignNotFoundError);
  await expect(campaignService.recordLaunch("t1", "unknown", [])).rejects.toThrow(CampaignNotFoundError);
});

test("listForTenant only returns this tenant's own campaigns", async () => {
  const { campaignService } = makeServices();
  await campaignService.create("t1", "c1", { name: "Mine", channels: ["website"] });
  await campaignService.create("t2", "c2", { name: "Theirs", channels: ["website"] });
  const list = await campaignService.listForTenant("t1");
  expect(list.map((c) => c.id)).toEqual(["c1"]);
});
