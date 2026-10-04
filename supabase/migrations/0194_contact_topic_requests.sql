-- ============================================================================
-- Sehatsandhi — contact form: a problem with a medicine order, ambulance or
--               insurance request
--
-- Run AFTER 0193. Safe to re-run.
--
-- 4 Oct 2026: patients connected to a pharmacy (0189), ambulance (0191) or
-- insurance advisor (0192) need a clear way to tell us when something goes
-- wrong. The Contact page offers "A medicine order, ambulance or insurance
-- request"; contact-submit files it as topic 'request'.
-- ============================================================================

alter table contact_inquiries drop constraint if exists contact_inquiries_topic_check;
do $$
declare c text;
begin
  -- The topic check was created unnamed in 0165; drop whichever one lists the topics.
  for c in select conname from pg_constraint
            where conrelid = 'contact_inquiries'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%listing_change%'
  loop
    execute format('alter table contact_inquiries drop constraint %I', c);
  end loop;
end $$;
alter table contact_inquiries add constraint contact_inquiries_topic_check
  check (topic in ('booking', 'listing', 'partner', 'request', 'billing', 'listing_change', 'privacy', 'other'));
