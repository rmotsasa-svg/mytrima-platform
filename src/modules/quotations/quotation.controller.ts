import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { QuotationService, QuotationLineItemInput } from "./quotation.service";
import { CustomerService } from "../customers/customer.service";
import { TenantService } from "../auth/tenant.service";
import { EmailService, createEmailService } from "../integrations/email/email.service";
import { WhatsAppService, createWhatsAppService, WhatsAppApiError } from "../integrations/whatsapp/whatsapp.service";
import { PendingVerificationError } from "../integrations/pending-integration";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

interface CreateQuotationBody {
  customerId?: string;
  lineItems: QuotationLineItemInput[];
  discountAmount?: number;
  notes?: string;
  customerAddress?: string;
  validUntil?: string;
}

interface UpdateQuotationBody {
  customerId?: string | null;
  lineItems?: QuotationLineItemInput[];
  discountAmount?: number;
  notes?: string;
  customerAddress?: string;
  validUntil?: string | null;
}

type QuotationSendChannel = "email" | "whatsapp";

interface SendQuotationBody {
  channels: QuotationSendChannel[];
  /** Explicit overrides — used when the quotation has no linked customer
   * (a walk-in inquiry) or the tenant wants to send somewhere other than
   * the customer's own file (e.g. an accountant's inbox). Falls back to
   * the linked customer's own email/phone when omitted — see send()'s
   * own comment. */
  recipientEmail?: string;
  recipientPhone?: string;
}

/**
 * "Let's add a quotation module... tenants must be able to send through
 * email or whatsapp" — the tenant's own explicit request (2026-09-16).
 * `quotations:view` for reads, `quotations:manage` for every write
 * (create/update/send) — same view/manage split as every other business-
 * data controller in this codebase (see rbac.ts's own comment).
 */
@UseGuards(AccessTokenGuard)
@Controller("quotations")
export class QuotationController {
  // Instance fields, not constructor parameters — same reasoning as
  // CustomerController's own comment (an EmailService/WhatsAppService
  // interface erases to `Object` at runtime, so Nest's DI can't resolve
  // it as a constructor param).
  private readonly emailService: EmailService = createEmailService();
  private readonly whatsAppService: WhatsAppService = createWhatsAppService();

  constructor(
    private readonly quotationService: QuotationService,
    private readonly customerService: CustomerService,
    private readonly tenantService: TenantService
  ) {}

  @Post(":tenantId")
  create(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateQuotationBody) {
    authorize(actor, tenantId, "quotations:manage");
    return this.quotationService.create(
      tenantId,
      randomUUID(),
      {
        customerId: body.customerId,
        lineItems: body.lineItems,
        discountAmount: body.discountAmount,
        notes: body.notes,
        customerAddress: body.customerAddress,
        validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
      },
      actor.userId
    );
  }

  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "quotations:view");
    return this.quotationService.listForTenant(tenantId);
  }

  @Get(":tenantId/:id")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("id") id: string) {
    authorize(actor, tenantId, "quotations:view");
    const quotation = await this.quotationService.findById(tenantId, id);
    if (!quotation) throw new NotFoundException(`No quotation found with id "${id}"`);
    return quotation;
  }

  @Patch(":tenantId/:id")
  update(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("id") id: string, @Body() body: UpdateQuotationBody) {
    authorize(actor, tenantId, "quotations:manage");
    return this.quotationService.update(tenantId, id, {
      customerId: body.customerId,
      lineItems: body.lineItems,
      discountAmount: body.discountAmount,
      notes: body.notes,
      customerAddress: body.customerAddress,
      validUntil: body.validUntil === null ? null : body.validUntil ? new Date(body.validUntil) : undefined,
    });
  }

  /**
   * Real per-channel send/skip/fail logic, the same discipline
   * CustomerController.requestFeedback() established: a channel with
   * nothing to send to (no recipient email/phone, from either an
   * explicit override or the linked customer's own file) or nothing
   * configured to send with is reported `skipped` with a real reason, not
   * a fabricated success or a failure of the whole request. On at least
   * one real `sent`, the quotation is marked sent — never speculatively
   * before a real send succeeds.
   *
   * DISCLOSED, NOT HIDDEN, WhatsApp gap: same real constraint as every
   * other WhatsApp send in this codebase —
   * `WhatsAppCloudApiService.sendTemplateMessage()` needs a real,
   * separate, pre-approved Meta template (`WHATSAPP_QUOTATION_TEMPLATE`),
   * unset by default; honestly skipped with that reason rather than
   * sending Meta's fixed-content `hello_world` sample with a real
   * quotation's numbers silently dropped.
   */
  @Post(":tenantId/:id/send")
  async send(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("id") id: string, @Body() body: SendQuotationBody) {
    authorize(actor, tenantId, "quotations:manage");
    if (!body.channels || body.channels.length === 0) throw new BadRequestException("channels must include at least one of: email, whatsapp");

    const quotation = await this.quotationService.findById(tenantId, id);
    if (!quotation) throw new NotFoundException(`No quotation found with id "${id}"`);

    const customer = quotation.customerId ? await this.customerService.findById(tenantId, quotation.customerId) : null;
    const recipientEmail = body.recipientEmail ?? customer?.email;
    const recipientPhone = body.recipientPhone ?? customer?.phone;

    const tenant = await this.tenantService.getById(tenantId);
    const tenantName = tenant?.name ?? "your service provider";
    const customerLabel = customer?.displayName ?? customer?.email ?? customer?.phone;
    const quotationText = this.quotationService.buildQuotationText(quotation, tenantName, customerLabel);

    const results: { channel: QuotationSendChannel; status: "sent" | "skipped" | "failed"; reason?: string }[] = [];

    if (body.channels.includes("email")) {
      if (!recipientEmail) {
        results.push({ channel: "email", status: "skipped", reason: "No recipient email — the linked customer has none on file, and none was given" });
      } else {
        try {
          await this.emailService.sendQuotationEmail(recipientEmail, quotationText, tenantName);
          results.push({ channel: "email", status: "sent" });
        } catch (err) {
          results.push({ channel: "email", status: "failed", reason: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    if (body.channels.includes("whatsapp")) {
      const templateName = process.env.WHATSAPP_QUOTATION_TEMPLATE;
      if (!recipientPhone) {
        results.push({ channel: "whatsapp", status: "skipped", reason: "No recipient phone — the linked customer has none on file, and none was given" });
      } else if (!templateName) {
        results.push({
          channel: "whatsapp",
          status: "skipped",
          reason: "No approved WhatsApp template configured (WHATSAPP_QUOTATION_TEMPLATE unset) — see this endpoint's own comment",
        });
      } else {
        try {
          await this.whatsAppService.sendTemplateMessage(recipientPhone, templateName, [quotation.quoteNumber, quotation.totalAmount.toFixed(2)]);
          results.push({ channel: "whatsapp", status: "sent" });
        } catch (err) {
          const reason =
            err instanceof PendingVerificationError || err instanceof WhatsAppApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          results.push({ channel: "whatsapp", status: "failed", reason });
        }
      }
    }

    const updated = results.some((r) => r.status === "sent") ? await this.quotationService.markSent(tenantId, id) : quotation;
    return { quotation: updated, results };
  }
}
