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
  InvalidVendorError: HttpStatus.BAD_REQUEST,
  VendorNotFoundError: HttpStatus.NOT_FOUND,
  InvalidPettyCashTransactionError: HttpStatus.BAD_REQUEST,
  InvalidDealError: HttpStatus.BAD_REQUEST,
  DealNotFoundError: HttpStatus.NOT_FOUND,
  InvalidSaleError: HttpStatus.BAD_REQUEST,
  InvalidSalesTargetError: HttpStatus.BAD_REQUEST,
  InvalidKpiBenchmarkError: HttpStatus.BAD_REQUEST,
  InvalidTenantNameError: HttpStatus.BAD_REQUEST,
  TenantSignupNotEnabledError: HttpStatus.FORBIDDEN,
  InvalidSignupCodeError: HttpStatus.FORBIDDEN,
  InvalidNotificationPhoneError: HttpStatus.BAD_REQUEST,
  NotificationPhoneNotConfiguredError: HttpStatus.BAD_REQUEST,
  InvalidPayfastMerchantIdError: HttpStatus.BAD_REQUEST,
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
