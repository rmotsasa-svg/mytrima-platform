import { BadRequestException } from "@nestjs/common";
import { diskStorage } from "multer";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AuthenticatedRequest } from "../modules/auth/access-token.guard";

/**
 * Real, local-disk image storage for Catalog item photos and Deal ad
 * creatives — added 2026-09-12 per the tenant's own explicit choice (asked
 * directly: local disk vs. S3 vs. base64-in-Postgres). Disclosed limitation
 * that choice accepts: files written here do NOT survive a redeploy on any
 * ephemeral/serverless host, and there is exactly one app instance's local
 * disk, not a shared volume — fine for this pilot/dev environment, wrong
 * for a real multi-instance production deployment. Move to a real object
 * store (S3 is the natural next step — this project's own AWS account
 * already exists per infra/terraform/) before that becomes true, without
 * needing to change any caller of `imageUrl`/`adImageUrl`: those are opaque
 * URLs, and a future migration only needs to change what UPLOADS_ROOT
 * writes to and what serves it.
 *
 * SECURITY NOTE, found while wiring this up: `npm audit` flagged multer's
 * bundled version (2.2.0, pinned by @nestjs/platform-express@11.2.3) with 4
 * real high-severity advisories — a multipart DoS, a file-descriptor leak
 * on aborted uploads, a fileFilter race bypassing the size limit, and a DoS
 * via oversized array-index field names. package.json's own `overrides`
 * block forces 2.3.0 (not covered by those advisories) across the whole
 * tree; `npm audit` reports zero vulnerabilities with it in place. This
 * file's own upload configuration also doesn't rely on fileFilter alone
 * for the size limit — `limits.fileSize` below is enforced by multer's
 * stream-level Busboy backend independently of the filter.
 */
export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

const ALLOWED_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export class UnsupportedImageTypeError extends Error {
  constructor(mimetype: string) {
    super(`Unsupported image type "${mimetype}" — only PNG, JPEG, WebP, and GIF are accepted`);
    this.name = "UnsupportedImageTypeError";
  }
}

/**
 * Builds a real multer configuration writing under
 * `uploads/<category>/<tenantId>/`, one real subtree per category
 * (catalog/deals) so a future per-category retention or CDN-path decision
 * doesn't need to touch the other. `tenantId` is read from the real
 * request's own route param inside the `destination` callback (`req`),
 * not passed in ahead of time — `@UseInterceptors(FileInterceptor(field,
 * options))`'s `options` argument is built once at decoration time, before
 * any request exists, so there is no per-request tenantId available at
 * that point; multer's own per-request callbacks are the real hook for it.
 *
 * REAL SECURITY ISSUE avoided here, not just a convenience choice:
 * `FileInterceptor` (like every Nest interceptor) runs AFTER
 * `AccessTokenGuard` but BEFORE the route handler's own body — which is
 * where every controller here calls `authorize(actor, tenantId,
 * permission)` to check the route's `:tenantId` actually matches the
 * caller's own tenant. That means multer has already written the file to
 * disk by the time a cross-tenant attempt would be rejected. Deriving the
 * destination folder from `req.user.tenantId` (the VERIFIED tenant
 * AccessTokenGuard attached, not the route's own untrusted `:tenantId`
 * param) closes that gap structurally: a caller can only ever write into
 * their own tenant's folder here, no matter what `:tenantId` their request
 * URL names — the handler's own authorize() call still separately rejects
 * a real cross-tenant request as a 403, exactly as it already did before
 * file uploads existed.
 *
 * The stored filename is always a fresh `randomUUID()` plus an extension
 * picked from `ALLOWED_IMAGE_MIME_TYPES` — never anything derived from the
 * caller-supplied original filename, which is exactly the kind of
 * untrusted string a path-traversal or overwrite attack would try to
 * smuggle a `../` or a collision through.
 */
export function imageUploadOptions(category: "catalog" | "deals") {
  return {
    storage: diskStorage({
      destination: (req: AuthenticatedRequest, _file, cb) => {
        const tenantId = req.user?.tenantId;
        if (!tenantId) {
          cb(new Error("No verified tenant on this request — AccessTokenGuard must run before this interceptor"), "");
          return;
        }
        const destination = path.join(UPLOADS_ROOT, category, tenantId);
        fs.mkdirSync(destination, { recursive: true });
        cb(null, destination);
      },
      filename: (_req, file, cb) => {
        const ext = ALLOWED_IMAGE_MIME_TYPES[file.mimetype];
        if (!ext) {
          cb(new UnsupportedImageTypeError(file.mimetype), "");
          return;
        }
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    fileFilter: (_req: unknown, file: { mimetype: string }, cb: (error: Error | null, accept: boolean) => void) => {
      if (!(file.mimetype in ALLOWED_IMAGE_MIME_TYPES)) {
        cb(new UnsupportedImageTypeError(file.mimetype), false);
        return;
      }
      cb(null, true);
    },
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB — generous for a real product photo/ad creative, not an invitation to host arbitrary large files
      files: 1,
    },
  };
}

export function publicImageUrl(category: "catalog" | "deals", tenantId: string, filename: string): string {
  return `/uploads/${category}/${tenantId}/${filename}`;
}

export function assertFileProvided(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
  if (!file) throw new BadRequestException("No image file was uploaded (expected multipart field \"image\")");
}
