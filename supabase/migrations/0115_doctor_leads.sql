-- ============================================================================
-- Sehatsandhi — doctor leads: a small CRM inside the admin panel
--
-- Run AFTER 0113. Independent of 0114. Safe to re-run.
--
-- A doctor who rang after a video, messaged us, or opted in on an ad, and whom
-- someone has to follow up. Two tables: the lead (who, where from, how far
-- along, when to call next) and its notes (what was said, newest first).
--
-- ── NAMES ───────────────────────────────────────────────────────────────────
-- The plan called these doctor_leads_v2 to sit beside an older doctor_leads.
-- There is no older doctor_leads — 0046 says so, and nothing since created one
-- — so there is nothing to migrate and no reason for the _v2.
--
-- ── ACCESS ──────────────────────────────────────────────────────────────────
-- Admin only, through sehat_is_admin() (0012, gated in 0081). Admin login is
-- real Supabase Auth now, so auth.uid() is set and the policies work; the
-- open-policy workaround the plan warns about is not needed. anon gets
-- nothing: a phone list is exactly what must never be one REST call away.
--
-- ── PHONE ───────────────────────────────────────────────────────────────────
-- Stored normalised, 91XXXXXXXXXX, like insurance_leads, so tel: and wa.me
-- work as-is and the duplicate check compares like with like. The UNIQUE
-- index is the duplicate check that cannot be raced; the screen looks first
-- only so it can offer the existing lead instead of an error.
--
-- ── registered_at ───────────────────────────────────────────────────────────
-- "Registered this week" is about when the stage changed, not when the lead
-- came in, and updated_at moves on every note-free edit. So the first time a
-- lead reaches 'registered' is stamped once and never moved.
-- ============================================================================

create table if not exists doctor_leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text not null,                     -- normalised: 91XXXXXXXXXX
  source text,                             -- video_founder_intro | video_doctors_flow | meta_ad | inbound_call | ...
  consent_type text,                       -- called_us | messaged_us | ad_optin
  stage text not null default 'called',
  next_followup date,
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table doctor_leads add constraint doctor_leads_stage_check
    check (stage in ('called','interested','registered','active','not_interested'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table doctor_leads add constraint doctor_leads_phone_check
    check (phone ~ '^91[6-9][0-9]{9}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table doctor_leads add constraint doctor_leads_consent_check
    check (consent_type is null or consent_type in ('called_us','messaged_us','ad_optin'));
exception when duplicate_object then null; end $$;

create unique index if not exists doctor_leads_phone_key on doctor_leads (phone);
create index if not exists doctor_leads_followup_idx on doctor_leads (next_followup);

create table if not exists doctor_lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references doctor_leads(id) on delete cascade,
  note text not null check (length(btrim(note)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists doctor_lead_notes_lead_idx on doctor_lead_notes (lead_id, created_at desc);

-- updated_at, and registered_at stamped once on the first move to 'registered'.
create or replace function sehat_doctor_leads_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.stage = 'registered' and new.registered_at is null then
    new.registered_at := now();
  end if;
  return new;
end $$;

drop trigger if exists doctor_leads_touch on doctor_leads;
create trigger doctor_leads_touch before insert or update on doctor_leads
  for each row execute function sehat_doctor_leads_touch();

revoke all on function sehat_doctor_leads_touch() from public, anon, authenticated;

-- ── RLS: admins only ────────────────────────────────────────────────────────
alter table doctor_leads enable row level security;
alter table doctor_lead_notes enable row level security;

revoke all on doctor_leads      from anon;
revoke all on doctor_lead_notes from anon;
grant select, insert, update on doctor_leads      to authenticated;
grant select, insert         on doctor_lead_notes to authenticated;

drop policy if exists "admins_read_doctor_leads" on doctor_leads;
create policy "admins_read_doctor_leads" on doctor_leads
  for select using (sehat_is_admin());

drop policy if exists "admins_insert_doctor_leads" on doctor_leads;
create policy "admins_insert_doctor_leads" on doctor_leads
  for insert with check (sehat_is_admin());

drop policy if exists "admins_update_doctor_leads" on doctor_leads;
create policy "admins_update_doctor_leads" on doctor_leads
  for update using (sehat_is_admin()) with check (sehat_is_admin());

drop policy if exists "admins_read_doctor_lead_notes" on doctor_lead_notes;
create policy "admins_read_doctor_lead_notes" on doctor_lead_notes
  for select using (sehat_is_admin());

drop policy if exists "admins_insert_doctor_lead_notes" on doctor_lead_notes;
create policy "admins_insert_doctor_lead_notes" on doctor_lead_notes
  for insert with check (sehat_is_admin());

notify pgrst, 'reload schema';
