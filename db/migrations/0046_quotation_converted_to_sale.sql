-- Mytrima — Migration 0046: quotation conversion to sale
--
-- P2.2 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER". Tracks whether a
-- quotation was ever turned into a real recorded Sale — a one-way link,
-- set once by QuotationController.convertToSale() and never cleared. Not
-- a new QuotationStatus value: converting is a separate fact from
-- draft/sent, and a quotation can only ever convert after being sent (see
-- that endpoint's own comment).

begin;

alter table quotation add column converted_to_sale_id uuid references sale_transaction(id) on delete set null;

commit;
