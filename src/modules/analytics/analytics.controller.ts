import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";
import { AnalyticsService } from "./website-visit.service";
import { TRACKER_SNIPPET_JS } from "./tracker-snippet";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";

/** A real `class`, not a plain `interface` — same reasoning as
 * RequestBookingBody's own comment: this is exactly the kind of body a
 * stranger's browser sends directly, unauthenticated, from a tenant's own
 * website (see mytrima-analytics.js). */
export class RecordVisitBody {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsOptional()
  @IsString()
  referrer?: string;
}

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /** Serves the actual tracking snippet a tenant embeds on their own
   * website — see tracker-snippet.ts's own top comment for the exact
   * `<script>` tag a tenant copies onto their site. A plain GET, publicly
   * cacheable, same as any static JS asset — deliberately not gated by the
   * `/analytics/collect` CORS middleware in main.ts, since a `<script src>`
   * load is never subject to CORS in the first place (only fetch/XHR reads
   * are), so this needs no special header at all to load cross-origin. */
  @Get("tracker.js")
  trackerScript(@Res() res: Response): void {
    res.type("application/javascript").send(TRACKER_SNIPPET_JS);
  }

  /**
   * The one endpoint the tracking snippet calls — deliberately
   * unauthenticated, same reasoning as BookingController.request()'s own
   * comment: a tenant's site visitor is not a Mytrima account holder
   * anywhere in this system. Reachable from ANY origin, not just origins
   * this app already knows about — see main.ts's own scoped CORS
   * middleware for the `/analytics` prefix, added specifically because a
   * tenant's own website domain can't be enumerated in CORS_ORIGIN ahead
   * of time the way the SPA's single dashboard origin can.
   *
   * Rate-limited the same way Booking/Rating/NPS's own public writes are —
   * unauthenticated by design means anyone (or any bot) can hammer it.
   * 60/min per client IP is more generous than booking's 20/min since a
   * single real visitor's browser can fire several of these in quick
   * succession while browsing a tenant's site.
   */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 60, windowMs: 60 * 1000 })
  @Post("collect/:tenantId")
  async collect(@Param("tenantId") tenantId: string, @Body() body: RecordVisitBody, @Req() req: Request) {
    await this.analyticsService.recordVisit({
      id: randomUUID(),
      tenantId,
      sessionId: body.sessionId,
      path: body.path,
      referrer: body.referrer,
      userAgent: req.headers["user-agent"],
      country: this.readCountry(req),
    });
    return { ok: true };
  }

  @UseGuards(AccessTokenGuard)
  @Get(":tenantId/summary")
  getSummary(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string
  ) {
    authorize(actor, tenantId, "reports:view");
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.analyticsService.getSummary(tenantId, start, end);
  }

  /** Reads a two-letter country code ONLY from a header a trusted edge/proxy
   * already set (the `CF-IPCountry` convention several CDNs use, and the
   * generic `X-Country-Code` some load balancers set the same way) — never
   * from the request's own IP address, which this method never looks at.
   * See migration 0025's own comment for why: no code path in this feature
   * reads req.ip/req.socket.remoteAddress at all, so there is no raw IP
   * anywhere in this feature to accidentally log or persist. Returns
   * undefined (and website_visit.country stays null) when no such header
   * is present — a real, disclosed gap for tenants not served through such
   * an edge, not papered over with an in-process GeoIP lookup. */
  private readCountry(req: Request): string | undefined {
    const header = req.headers["cf-ipcountry"] ?? req.headers["x-country-code"];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || value.length !== 2) return undefined;
    return value.toUpperCase();
  }
}
