-- ============================================================================
-- 0305 — "Ask the doctor" on a clinic's own website: what the bot answered
-- ============================================================================
-- AFTER 0304. Safe to re-run.
--
-- Asked 31 Oct 2026 for SN Eye Hospital ("Ask Dr. Swati"): the site's bot
-- answers general eye questions from the doctor's approved articles and
-- published Q&A; questions about one patient go to an online consultation;
-- urgent symptoms are told to come in now; anything the approved content does
-- not cover is offered to the doctor's question list (clinic_site_messages,
-- kind 'question', 0304).
--
-- clinic_site_asks keeps every question and the bot's reply, so the doctor
-- can check what the bot is telling people (Website → Messages → Bot answers),
-- and so the site-ask function can limit use: 20 questions an hour from one
-- visitor, 400 a day per site. Visitors are counted by a salted hash of the
-- IP, never the address. Written only by site-ask (service role).
-- ============================================================================

create table if not exists clinic_site_asks (
  id bigserial primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  question text not null,
  lang text check (lang is null or lang in ('en', 'hi')),
  kind text not null check (kind in ('answer', 'personal', 'emergency', 'doctor', 'error')),
  answer text,
  sources jsonb not null default '[]'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists clinic_site_asks_biz_idx on clinic_site_asks (business_id, created_at desc);
create index if not exists clinic_site_asks_ip_idx on clinic_site_asks (ip_hash, created_at desc);

alter table clinic_site_asks enable row level security;
revoke all on clinic_site_asks from anon;
revoke all on sequence clinic_site_asks_id_seq from anon, authenticated;
grant select on clinic_site_asks to authenticated;

drop policy if exists site_asks_read on clinic_site_asks;
create policy site_asks_read on clinic_site_asks for select
  using (sehat_caller_is_business(business_id) or sehat_is_admin());

notify pgrst, 'reload schema';
