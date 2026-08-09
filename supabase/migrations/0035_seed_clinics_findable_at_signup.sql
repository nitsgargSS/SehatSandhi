-- ============================================================================
-- Sehatsandhi — let a clinic find itself while signing up
--
-- Run AFTER 0034. Safe to re-run.
--
-- WHY
-- We know 80 clinics in Yamunanagar exist, with their addresses, because MoHFW
-- publishes them. A clinic signing up currently types all of that again. It
-- should be able to type its name, see itself, and confirm — the address we have
-- is more likely right than one typed on a phone, and it is already public.
--
-- WHY A VIEW AND NOT A POLICY ON THE TABLE
-- seed_clinics is two things at once: a set of names and addresses that are
-- public record, and a sales pipeline. status tells us who we have rung and who
-- told us no; notes are our own words about someone else's business. RLS is
-- row-level, so a select policy on the table would hand all of that to anyone
-- with the anon key, which every visitor has.
--
-- The view publishes the four fields a clinic needs to recognise itself and
-- nothing else. Rejected rows are gone from it: a business that asked not to be
-- listed should not be offered back to whoever asks next.
-- ============================================================================

create or replace view findable_clinics as
  select
    sc.id,
    sc.name,
    sc.address,
    sc.pincode,
    sc.district
  from seed_clinics sc
  where sc.status in ('unclaimed', 'contacted');

comment on view findable_clinics is
  'Clinics offered as suggestions during signup, from open government data '
  '(National Hospital Directory, MoHFW/NIHFW via data.gov.in, GODL-India — '
  'attribution required wherever these are shown). Name and address only: the '
  'pipeline status, our notes and who claimed a row stay in seed_clinics, which '
  'the anon key cannot read. Excludes rejected rows so a clinic that declined is '
  'never suggested again.';

grant select on findable_clinics to anon, authenticated;
