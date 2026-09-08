import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DomainErrorFilter } from "./common/http-exception.filter";

/**
 * NOT YET RUN in this sandbox as a real listening server — verified only by
 * booting the DI container via @nestjs/testing (see app.module.test.ts) and
 * by `npm run build` (tsc) succeeding. `npm start` should work on a machine
 * with normal registry/network access, but that has not been exercised here.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DomainErrorFilter());
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
