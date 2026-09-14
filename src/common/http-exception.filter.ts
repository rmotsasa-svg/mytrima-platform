import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

/**
 * Maps this platform's domain error classes (InvalidAuditAnswersError,
 * InvalidCredentialsError, etc.) to sensible HTTP status codes by error
 * name, so controllers don't need a try/catch + manual HttpException in
 * every method — they can just let a domain error propagate. Anything not
 * in this map falls through to 500 deliberately: an unmapped error should be
 * loud, not silently coerced into a client error.
 *
 * An `HttpException` (Nest's own — e.g. the 404 it throws for an unmatched
 * route, or anything a controller throws deliberately) is handled first and
 * passed through with its own real status, never forced through this map.
 * This filter's job is to give plain `Error` subclasses an HTTP status they
 * don't otherwise have — not to override a status Nest already assigned.
 * (Caught the hard way: without this check, visiting an unmapped route
 * returned a 500 with `"error":"NotFoundException"` instead of an actual 404.)
 *
 * KNOWN GAP: the domain-error branch dispatches on `error.name` (a string),
 * not `instanceof`, because each error class lives in its own module and
 * importing all of them here would make every domain module depend on this
 * one filter file. A misspelled or renamed error class name would silently
 * fall through to 500 instead of failing loudly at compile time — revisit if
 * that trade-off stops being worth it.
 */
const STATUS_BY_ERROR_NAME: Readonly<Record<string, number>> = {
  InvalidAuditAnswersError: HttpStatus.BAD_REQUEST,
  InvalidRatingError: HttpStatus.BAD_REQUEST,
  InvalidCustomerError: HttpStatus.BAD_REQUEST,
  CustomerNotFoundError: HttpStatus.NOT_FOUND,
  InvalidCatalogItemError: HttpStatus.BAD_REQUEST,
  CatalogItemNotFoundError: HttpStatus.NOT_FOUND,
  UnsupportedImageTypeError: HttpStatus.BAD_REQUEST,
  // Multer's own error class (e.g. LIMIT_FILE_SIZE when a real upload
  // exceeds imageUploadOptions()'s 5 MB cap) — mapped here so an oversized
  // upload gets a clean 400, not a raw 500.
  MulterError: HttpStatus.BAD_REQUEST,
  InvalidVendorError: HttpStatus.BAD_REQUEST,
  VendorNotFoundError: HttpStatus.NOT_FOUND,
  InvalidPettyCashTransactionError: HttpStatus.BAD_REQUEST,
  InvalidDealError: HttpStatus.BAD_REQUEST,
  DealNotFoundError: HttpStatus.NOT_FOUND,
  InvalidSaleError: HttpStatus.BAD_REQUEST,
  InvalidRefundError: HttpStatus.BAD_REQUEST,
  SaleNotFoundError: HttpStatus.NOT_FOUND,
  InvalidSalesTargetError: HttpStatus.BAD_REQUEST,
  InvalidKpiBenchmarkError: HttpStatus.BAD_REQUEST,
  InvalidTenantNameError: HttpStatus.BAD_REQUEST,
  // TenantSignupNotEnabledError removed 2026-09-11 — see tenant.service.ts's
  // own "DELIBERATE POLICY CHANGE" comment: self-serve signup is now open
  // by default (no code required), so that error class has no throw site
  // left at all.
  InvalidSignupCodeError: HttpStatus.FORBIDDEN,
  InvalidNotificationPhoneError: HttpStatus.BAD_REQUEST,
  NotificationPhoneNotConfiguredError: HttpStatus.BAD_REQUEST,
  InvalidPayfastMerchantIdError: HttpStatus.BAD_REQUEST,
  InvalidContactEmailError: HttpStatus.BAD_REQUEST,
  InvalidContactPhoneError: HttpStatus.BAD_REQUEST,
  TenantPayfastNotConfiguredError: HttpStatus.BAD_REQUEST,
  PayFastConfigError: HttpStatus.BAD_REQUEST,
  WhatsAppApiError: HttpStatus.BAD_GATEWAY,
  SocialConnectionNotFoundError: HttpStatus.NOT_FOUND,
  NoFacebookPageFoundError: HttpStatus.BAD_REQUEST,
  NoInstagramAccountLinkedError: HttpStatus.BAD_REQUEST,
  MetaApiError: HttpStatus.BAD_GATEWAY,
  ConsentNotFoundError: HttpStatus.NOT_FOUND,
  InvalidCredentialsError: HttpStatus.UNAUTHORIZED,
  MfaEnrollmentRequiredError: HttpStatus.UNAUTHORIZED,
  EmailNotVerifiedError: HttpStatus.UNAUTHORIZED,
  MfaRequiredError: HttpStatus.UNAUTHORIZED,
  MfaInvalidCodeError: HttpStatus.UNAUTHORIZED,
  InvalidTokenError: HttpStatus.UNAUTHORIZED,
  TokenExpiredError: HttpStatus.UNAUTHORIZED,
  CrossTenantAccessError: HttpStatus.FORBIDDEN,
  InsufficientPermissionError: HttpStatus.FORBIDDEN,
  MalformedPasswordHashError: HttpStatus.INTERNAL_SERVER_ERROR,
  EmailAlreadyRegisteredError: HttpStatus.CONFLICT,
  WeakPasswordError: HttpStatus.BAD_REQUEST,
  UserNotFoundError: HttpStatus.NOT_FOUND,
  InvalidMfaEncryptionKeyError: HttpStatus.INTERNAL_SERVER_ERROR,
  MfaSecretDecryptionError: HttpStatus.INTERNAL_SERVER_ERROR,
  RateLimitExceededError: HttpStatus.TOO_MANY_REQUESTS,
  AdminApiKeyNotConfiguredError: HttpStatus.FORBIDDEN,
  InvalidAdminApiKeyError: HttpStatus.FORBIDDEN,
  InvalidBookingError: HttpStatus.BAD_REQUEST,
  BookingNotFoundError: HttpStatus.NOT_FOUND,
  BookingConflictError: HttpStatus.CONFLICT,
  InvalidBookingStatusTransitionError: HttpStatus.CONFLICT,
  InvalidSupportTicketError: HttpStatus.BAD_REQUEST,
  SupportTicketNotFoundError: HttpStatus.NOT_FOUND,
  InvalidSupportTicketStatusTransitionError: HttpStatus.CONFLICT,
  AccountDeactivatedError: HttpStatus.UNAUTHORIZED,
  CannotRemoveLastOwnerError: HttpStatus.CONFLICT,
  InvalidStaffRoleError: HttpStatus.BAD_REQUEST,
  // REAL BUG found live-verifying the website-analytics feature
  // (2026-09-11): an empty-path beacon threw InvalidVisitError and, unmapped
  // here, surfaced as a raw 500 instead of the 400 it actually is — the
  // exact bug class this filter exists to prevent, same as every other
  // Invalid*Error above.
  InvalidVisitError: HttpStatus.BAD_REQUEST,
  // REAL BUG found live-curl-testing the 2026-09-14 shift-banking
  // denomination-breakdown validation: InvalidShiftBankingError has thrown
  // real, correct validation errors (bad periods, negative amounts, a
  // denomination breakdown that doesn't sum to the counted total) since
  // shift banking's own first pass, but was never added here — every one
  // of those real 400s was actually surfacing as a raw 500, the exact bug
  // class this filter exists to prevent (see InvalidVisitError's own
  // comment above for the same class of gap found earlier). Same
  // oversight caught the same way for CampaignService's two error classes
  // below, added the same session and never wired in either.
  InvalidShiftBankingError: HttpStatus.BAD_REQUEST,
  InvalidCampaignError: HttpStatus.BAD_REQUEST,
  CampaignNotFoundError: HttpStatus.NOT_FOUND,
  // REAL BUG found by a deliberate sweep (2026-09-14) after the
  // InvalidShiftBankingError gap above: a `grep` for every real domain
  // error class in src, diffed against this map's own keys, turned up six
  // more with the identical gap. None currently has a LIVE, uncaught path
  // to this filter today (see each one's own note below) — but the same
  // was true of InvalidVisitError once, before a caller changed, and this
  // map's whole job is to give a class the right status the moment some
  // caller does propagate it, not just the callers that happen to exist
  // right now.
  //
  // GoogleBusinessApiError/MoPayApiError: real third-party-API-failure
  // wrappers (same shape as MetaApiError/WhatsAppApiError above), but
  // neither GoogleBusinessService nor MoPayService is wired into any
  // controller yet — both are real, tested clients with no live HTTP
  // throw site today.
  GoogleBusinessApiError: HttpStatus.BAD_GATEWAY,
  MoPayApiError: HttpStatus.BAD_GATEWAY,
  // InvalidPaymentReferenceError: a real validation error (MoPay's own
  // documented alphanumeric-only reference format) — same dormant status
  // as MoPayApiError above (MoPayService has no live caller yet).
  InvalidPaymentReferenceError: HttpStatus.BAD_REQUEST,
  // InvalidNpsScoreError: NpsService.submit()'s own defense-in-depth check
  // (categorize() validates before persisting) — NpsController.submit()'s
  // own SubmitNpsBody already rejects an out-of-range score with
  // class-validator's `@IsInt()/@Min(0)/@Max(10)` before this is ever
  // reached, so this is currently unreachable via that one real caller,
  // not a live bug — but the service-level check exists specifically so a
  // future second caller that skips the DTO can't skip the validation
  // too, and it deserves the correct status when that happens.
  InvalidNpsScoreError: HttpStatus.BAD_REQUEST,
  // TrendRangeTooLargeError: SaleService.computeSalesTrend()'s real
  // 366-day cap — its one current caller, SnapshotService.getSnapshot(),
  // already swallows it with its own `.catch(() => [])` (a separate,
  // pre-existing design choice — a snapshot's sales-trend chart silently
  // goes empty for an over-large period rather than failing the whole
  // report), so this doesn't reach any HTTP response today either. Mapped
  // for the same reason as the others: a future direct trend endpoint
  // that lets this propagate should get a 400, not a 500.
  TrendRangeTooLargeError: HttpStatus.BAD_REQUEST,
  // PendingVerificationError: thrown by an integration stub that's real,
  // tested code but not yet a confirmed vendor relationship (see
  // pending-integration.ts's own comment) — 501, not 400/502, since this
  // is never the caller's fault: the request was fine, this platform's
  // own dependency just isn't available yet. Every current HTTP-reachable
  // caller (CustomerController.requestFeedback(), SalesController.sendShiftBankingSlip(),
  // CampaignsController.launch()) already catches this locally and turns
  // it into a real per-channel result or its own BadRequestException, so
  // this is also currently a no-op for live traffic — mapped so a future
  // caller that doesn't bother with its own try/catch still gets a real,
  // correct status instead of a raw 500.
  PendingVerificationError: HttpStatus.NOT_IMPLEMENTED,
  // Phase 2 of the GrowthOS-aligned restructuring plan (persisted
  // Triggers, src/modules/triggers/) — added in the same commit that
  // introduces these two classes, not deferred, per this file's own
  // recurring "REAL BUG" lesson above.
  InvalidTriggerError: HttpStatus.BAD_REQUEST,
  TriggerNotFoundError: HttpStatus.NOT_FOUND,
  // Phase 3 of the GrowthOS-aligned restructuring plan (Goals module).
  InvalidGoalError: HttpStatus.BAD_REQUEST,
  GoalNotFoundError: HttpStatus.NOT_FOUND,
};

@Catch(Error)
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === "string" ? { statusCode: status, error: exception.name, message: body } : body);
      return;
    }

    const status = STATUS_BY_ERROR_NAME[exception.name] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json({
      statusCode: status,
      error: exception.name,
      message: exception.message,
    });
  }
}
