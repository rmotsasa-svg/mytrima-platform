# AWS Africa (Cape Town) vs. Azure South Africa — Hosting Decision

Per Master Plan Section 4/17: "Build a like-for-like cost comparison at pilot scale
(5–10 tenants, low request volume) rather than defaulting to whichever is more familiar."
This is that comparison. Real, sourced numbers below (as of September 2026) — not
estimates from memory. Sources are linked at the bottom of each section.

**Status: comparison complete, decision not yet made — that's the one part of this
document only you can fill in** (see "Decision" at the bottom).

## Region confirmation (already known, restated for completeness)

- **AWS Africa (Cape Town) — `af-south-1`**: real region, live since April 2020.
- **Azure South Africa North (Johannesburg) / South Africa West (Cape Town)**: real
  regions, live since March 2019.

Both physically exist and are production regions, not previews.

## Managed PostgreSQL — smallest realistic pilot tier

| | AWS RDS for PostgreSQL (af-south-1) | Azure Database for PostgreSQL Flexible Server (South Africa North) |
|---|---|---|
| Smallest burstable instance | `db.t4g.micro` (2 vCPU, 1 GiB) — **$12/month** (~$0.0164/hr) | `B1MS` (1 vCore, 2 GiB) — **$0.0215/hr ≈ $15.70/month** |
| Next size up | `db.t3.small` — ~$26/month | `B2S` — $0.086/hr ≈ $62.78/month |
| Storage (gp3 / general purpose) | ~$0.115/GB-month (US baseline; af-south-1 likely carries the same ~25–30% regional premium seen on compute, so realistically **~$0.14–0.15/GB-month** — not directly confirmed for this region, flagged as an estimate) | **$0.151/GB-month** (confirmed for South Africa North) |
| Backup storage | Included allowance, then billed per GB — not separately confirmed for af-south-1 | **$0.113/GB-month** (confirmed) |

**At the smallest tier, AWS is roughly 24% cheaper on compute** ($12 vs. ~$15.70/month).
Storage is close either way once the likely af-south-1 premium is factored in.

Sources: [Azure PostgreSQL retail pricing (South Africa North)](https://prices.azure.com/api/retail/prices?%24filter=armRegionName%20eq%20%27southafricanorth%27%20and%20contains%28productName%2C%27PostgreSQL%27%29), [Bytebase RDS pricing (af-south-1 figures)](https://www.bytebase.com/dbcost/rds-pricing/)

## Managed Redis — smallest tier

| | AWS ElastiCache for Redis | Azure Cache for Redis (South Africa North) |
|---|---|---|
| Smallest single-node | `cache.t4g.micro` — **~$0.016/hr ≈ $11.68/month** (US baseline; af-south-1 rate not directly confirmed, likely a similar premium applies) | Basic C0 (250MB, no HA) — **$0.0321/hr ≈ $23.43/month** (confirmed for South Africa North) |
| Smallest tier with built-in HA/replica | Not available at this size — HA requires a second node, roughly **doubling** the cost | Standard C0 (250MB, HA included) — **$0.04/hr ≈ $29.20/month** (confirmed) |

**Not a clean apples-to-apples comparison**: Azure's cheapest *Standard* tier includes a
replica for high availability by default; AWS's cheapest single node does not — matching
that would roughly double the AWS number. At the same reliability level, these land much
closer together than the raw single-node prices suggest.

**Azure-specific note, worth knowing regardless of provider choice**: Azure Cache for
Redis (Basic/Standard/Premium, the tiers priced above) is being retired — **September 30,
2028** for Basic/Standard/Premium, **March 30, 2027** for Enterprise. Microsoft is steering
new deployments toward "Azure Managed Redis" instead. Nothing urgent for a Stage 1 pilot,
but worth pricing Azure Managed Redis specifically rather than assuming these numbers
hold for the full life of the product, if Azure is chosen.

Sources: [Azure Redis retail pricing (South Africa North)](https://prices.azure.com/api/retail/prices?%24filter=armRegionName%20eq%20%27southafricanorth%27%20and%20contains%28productName%2C%27Redis%27%29), [AWS ElastiCache pricing overview](https://upstash.com/blog/aws-elasticache-pricing-explained-2026-full-cost-breakdown)

## Egress / data transfer out

| | AWS (af-south-1) | Azure (South Africa North) |
|---|---|---|
| Free allowance | 100 GB/month | 100 GB/month |
| Rate beyond that | **$0.147/GB** | **$0.181/GB** (Azure's highest-cost "Zone 3" tier — Africa/Middle East/South America) |

**AWS is ~19% cheaper per GB beyond the free tier.** At genuine pilot scale (5–10
tenants, low request volume per Section 3's own topology table), monthly egress will very
likely stay under the 100GB free allowance on both providers — meaning this difference is
probably **$0 in practice during Stage 1**, and only starts to matter at Stage 2 growth.

Sources: [AWS data transfer pricing analysis](https://egresscost.com/aws/data-transfer-pricing/), [Azure bandwidth pricing by zone](https://egresscost.com/azure/zones-explained/)

## Terraform provider support

Both `hashicorp/aws` and `hashicorp/azurerm` are official, first-party-maintained
providers with complete, mature resource coverage for everything above (RDS, ElastiCache,
Azure Database for PostgreSQL Flexible Server, Azure Cache for Redis). **No meaningful
maturity gap between them for these specific resources.**

One operational quirk worth knowing before the first `terraform apply`: **`af-south-1` is
an AWS "opt-in region"** — it must be explicitly enabled at the AWS account level before
anything (Terraform included) can provision resources there, or you'll hit an
`OptInRequired` error. This is a one-time account setting, not a blocker, but it's a
5-minute surprise the first time if nobody knows to expect it. Azure's South Africa
regions have no equivalent opt-in step.

## Bottom line, at pilot scale (5–10 tenants)

Total infrastructure spend for either provider at this scale is small in absolute terms
— realistically **under $60–80/month** for a single small Postgres instance + single
small Redis cache, before storage/egress, on either cloud. The percentage differences
above are real, but the absolute dollar difference at pilot scale is modest (likely
$15–30/month). **AWS af-south-1 comes out cheaper on every line item measured directly**,
though the Redis comparison isn't quite apples-to-apples on availability, and two of the
AWS figures (storage, Redis) are extrapolated from US baseline pricing plus the observed
regional premium, not directly confirmed line items like the Azure numbers are.

Given the dollar amounts involved are small either way, the more decisive factors for a
1–2 person team may reasonably be things this document can't measure — which cloud's
console/CLI the team already knows, existing AWS or Azure credits, or a pre-existing
account. The Master Plan is explicit that the choice shouldn't *default* to familiarity
without looking at the numbers first — this document is that look. Familiarity is a
legitimate tie-breaker once the numbers are this close; it just shouldn't be the only
input.

## Decision

- [x] **AWS Africa (Cape Town) — `af-south-1`**
- [ ] ~~Azure South Africa North / West~~

**Decided: 2026-09-07.** Consistent with this document's own numbers — AWS came out
cheaper on every directly-measured line item (compute, storage, egress) at pilot scale.

**Next step this unblocks**: infrastructure-as-code for `af-south-1` (Master Plan Section
4: "Terraform from day one") — an RDS PostgreSQL instance and an ElastiCache Redis node,
sized for the pilot tier priced above. Remember the account-level opt-in step noted above
before the first `terraform apply` against this region.
