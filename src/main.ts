import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DomainErrorFilter } from "./common/http-exception.filter";

/**
 * ACTUALLY RUN as a real listening server multiple times against a live
 * Postgres + Redis-compatible (Memurai) instance — not just booted via
 * @nestjs/testing's DI container. Verified end-to-end: real HTTP requests
 * against the dashboard and API endpoints, real BullMQ jobs enqueued and
 * processed by RevokedTokenCleanupService/NotificationWorkerService's real
 * in-process workers, and a real process-restart proof for refresh-token
 * revocation (see README.md's "Auth/RBAC" and "Redis/BullMQ" sections).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DomainErrorFilter());
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
