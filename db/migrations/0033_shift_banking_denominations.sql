-- Mytrima — Migration 0033: real denomination breakdown for shift banking
--
-- REAL GAP closed 2026-09-14, at the tenant's own explicit request ("on
-- banking add denominations"). Optional real note/coin counts
-- (0.10/0.20/0.50/1.00/2.00/5.00/10.00/20.00/50.00/100.00/200.00) recorded
-- alongside the shift's own counted_cash_amount — see
-- shift-banking.service.ts's own comment for the real arithmetic
-- validation this closes (the breakdown must actually sum to the counted
-- total, not just be stored decoratively). jsonb, not a child table: a
-- fixed 11-key map is never independently queried the way a sale's own
-- line items are.

begin;

alter table shift_banking add column denomination_counts jsonb;

commit;
