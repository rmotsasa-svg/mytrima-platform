-- Mytrima — Migration 0014: Tenant notification phone number
-- Backs the real WhatsApp Cloud API send (src/modules/integrations/whatsapp/) —
-- notifications (Growth Audit bands, NPS detractors, moderated ratings, KPI
-- benchmarks) are always addressed to tenant staff, never the customer
-- directly (see automation.service.ts's own NotificationEvent comment), but
-- until now there was nowhere to actually send one: no phone number existed
-- anywhere above the individual `customer` row.
--
-- One number per tenant, not per staff member — right-sized for the pilot
-- cohort (Master Plan Section 3), same reasoning as the shared signup code
-- (migration comment, tenant.service.ts). Nullable: a tenant that hasn't set
-- one yet should fail a notification job loudly (NotificationPhoneNotConfiguredError),
-- not silently guess a recipient.

begin;

alter table tenant add column notification_phone_e164 text;

commit;
