-- Mytrima — Migration 0038: customer gender + location
--
-- Real gap closed 2026-09-15 at the tenant's own explicit request ("on add
-- customer: let's include Gender and Location"). Both nullable, same
-- "optional at the database level, requireAtLeastOneIdentifyingField()
-- enforces the real business rule in code" pattern as every other
-- customer field — see customer.service.ts's own comment. `gender` is
-- constrained to the same real, bounded set the service layer validates
-- (female/male/other/prefer_not_to_say), not free text.

begin;

alter table customer add column gender text check (gender in ('female', 'male', 'other', 'prefer_not_to_say'));
alter table customer add column location text;

commit;
