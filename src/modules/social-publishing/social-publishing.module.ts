import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { SocialPublishingController } from "./social-publishing.controller";
import { SocialConnectionService, SocialConnectionStore } from "./social-connection.service";
import { InMemorySocialConnectionStore } from "./in-memory-social-connection.store";
import { PgSocialConnectionStore } from "./pg-social-connection.store";
import { MetaOAuthService } from "./meta-oauth.service";
import { SOCIAL_CONNECTION_STORE, META_APP_ID, META_APP_SECRET } from "./social-publishing.tokens";
import { PG_POOL } from "../../common/database.module";

@Module({
  controllers: [SocialPublishingController],
  providers: [
    SocialConnectionService,
    MetaOAuthService,
    {
      provide: SOCIAL_CONNECTION_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): SocialConnectionStore => (pool ? new PgSocialConnectionStore(pool) : new InMemorySocialConnectionStore()),
    },
    // No dev-only fallback for either, unlike JWT_SECRET — a fake App
    // ID/Secret doesn't let the OAuth flow "work insecurely," it just fails
    // outright against the real Meta API, so there's no equivalent
    // footgun to guard against by inventing one.
    { provide: META_APP_ID, useValue: process.env.META_APP_ID ?? "" },
    { provide: META_APP_SECRET, useValue: process.env.META_APP_SECRET ?? "" },
  ],
})
export class SocialPublishingModule {}
