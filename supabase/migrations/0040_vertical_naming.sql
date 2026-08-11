-- ============================================================================
-- Sehatsandhi — one spelling for the clinic vertical
--
-- Run AFTER 0039. Safe to re-run.
--
-- 0037 named the verticals on `businesses`:
--   clinic | hospital | pharmacy | lab | insurance | ambulance
--
-- but vertical_billing — which decides whether a vertical pays monthly or on
-- commission — has keyed the same concept as 'doctors' since 0006. Nothing
-- joined the two before, because the vertical used to be derived from
-- doctors.speciality through a hardcoded map in _shared/pricing.ts. Now that it
-- is a column, the two spellings meet, and a clinic would have missed its
-- billing row and fallen through to the defaults.
--
-- 'clinic' wins: it names the business, which is what the row is. 'doctors' was
-- always the odd one out — every other vertical is already singular and already
-- names the establishment rather than the people inside it.
-- ============================================================================

update vertical_billing set vertical = 'clinic' where vertical = 'doctors';

-- applies_to_verticals on a plan carries the same strings.
update pricing_plans
   set applies_to_verticals = array_replace(applies_to_verticals, 'doctors', 'clinic')
 where applies_to_verticals is not null
   and 'doctors' = any(applies_to_verticals);

do $$ begin
  alter table vertical_billing add constraint vertical_billing_known_vertical
    check (vertical in ('clinic','hospital','pharmacy','lab','insurance','ambulance')) not valid;
exception when duplicate_object then null; end $$;

comment on column vertical_billing.vertical is
  'clinic | hospital | pharmacy | lab | insurance | ambulance. Must match '
  'businesses.vertical exactly — this row is looked up by that column, and a '
  'spelling that does not match silently bills the default.';
