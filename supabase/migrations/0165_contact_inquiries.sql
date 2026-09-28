-- ============================================================================
-- Sehatsandhi — the Contact Us form: every inquiry kept, and emailed to us
--
-- Run AFTER 0164. Safe to re-run.
--
-- The Contact page offered a mailto: link, which does nothing on a phone or a
-- computer with no mail app set up — so "contact us" looked broken. It now has
-- a form. The contact-submit edge function checks it, writes the row here and
-- emails it to contact@sehatsandhi.com (Reply-To the sender, when they gave an
-- email). The row is written FIRST, so an inquiry is never lost to a mail
-- outage: emailed_at stays null and email_error says why.
--
-- Nobody writes here but the edge function (service role). Sehatsandhi admins
-- and managers can read it.
-- ============================================================================

create table if not exists contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 100),
  phone text check (phone is null or phone ~ '^91[6-9][0-9]{9}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  topic text not null default 'other'
    check (topic in ('booking', 'listing', 'partner', 'billing', 'listing_change', 'other')),
  message text not null check (length(btrim(message)) between 5 and 3000),
  page text,
  lang text,
  -- A hash, not the address: enough to rate-limit a sender, nothing to leak.
  ip_hash text,
  emailed_at timestamptz,
  email_error text,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);

create index if not exists contact_inquiries_created_idx on contact_inquiries (created_at desc);
create index if not exists contact_inquiries_ip_idx on contact_inquiries (ip_hash, created_at desc);

alter table contact_inquiries enable row level security;
drop policy if exists "staff_reads_contact_inquiries" on contact_inquiries;
create policy "staff_reads_contact_inquiries" on contact_inquiries for select
  using (sehat_is_staff());

grant select on contact_inquiries to authenticated;
revoke insert, update, delete on contact_inquiries from anon, authenticated;
revoke all on contact_inquiries from anon;

notify pgrst, 'reload schema';
