-- Mytrima — Migration 0016: PayFast ITN idempotency
-- Real gap found by deep review, not live-triggered yet: PayFast's own docs
-- state it retries a notify_url delivery that doesn't return HTTP 200
-- "immediately, then after 10 minutes and then at exponentially longer
-- intervals" — every retry currently inserts a NEW payfast_itn_log row for
-- the same real payment. Harmless today (it's just an audit log with no
-- downstream effect), but the moment anything acts on an ITN (crediting a
-- sale, sending a receipt), duplicate processing becomes a real bug. Fixed
-- before that's ever built, not after a duplicate-credit incident.

begin;

-- Scoped per-tenant (not a bare unique on pf_payment_id alone) to match
-- this table's own RLS design — every other constraint/policy here is
-- tenant-scoped, and pf_payment_id is already namespaced by PayFast's own
-- per-merchant-account transaction id space in practice.
alter table payfast_itn_log add constraint payfast_itn_log_tenant_pf_payment_unique unique (tenant_id, pf_payment_id);

commit;
