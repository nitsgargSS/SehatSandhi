-- ============================================================================
-- 0261 — A clinic's own WhatsApp number, and the Pro plan it comes with
-- ============================================================================
-- Decided 24 Oct 2026. WhatsApp comes in two plans:
--
--   basic  (₹500 a month, as today) — messages go from the number Sehatsandhi
--          keeps for clinics, sent by hand, paid from the wallet after the
--          200 free ones (0259).
--   pro    (₹1,000 a month) — the clinic connects its OWN WhatsApp number
--          through Meta's Embedded Signup (Sehatsandhi is a Tech Provider).
--          Messages go from that number, in the clinic's name, and the clinic
--          pays Meta for them directly with its own card: our wallet is not
--          touched. Until the number is connected, Pro sends from our number
--          like Basic does.
--
-- A clinic has one plan or the other, never both. The plan is a column on the
-- WhatsApp account; buying Pro (and its price) comes in a later migration.
--
-- WHAT IS KEPT, AND WHERE:
--   business_wa_accounts  the number's ids and what Meta says about it —
--                         readable by the clinic, as every other column is.
--   Vault                 the access key Meta hands over for that clinic's
--                         account. Never in a table a clinic can read; only
--                         the service role can fetch it (sehat_wa_own_sender).
--   wa_clinic_templates   our message templates in the clinic's account, and
--                         whether Meta approved each one.
--
-- Everything that talks to Meta is in the wa-connect edge function; this file
-- only keeps the state.
-- ============================================================================

alter table business_wa_accounts
  add column if not exists plan text not null default 'basic',
  add column if not exists phone_number_id text,
  add column if not exists verified_name text,
  add column if not exists name_status text,
  add column if not exists quality_rating text,
  add column if not exists messaging_limit text,
  add column if not exists coexistence boolean not null default false,
  add column if not exists own_status text not null default 'none',
  add column if not exists own_error text,
  add column if not exists own_checked_at timestamptz,
  add column if not exists connected_at timestamptz,
  add column if not exists connected_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_wa_accounts_plan_check') then
    alter table business_wa_accounts add constraint business_wa_accounts_plan_check check (plan in ('basic', 'pro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_wa_accounts_own_status_check') then
    alter table business_wa_accounts add constraint business_wa_accounts_own_status_check
      check (own_status in ('none', 'connected', 'failed', 'disconnected'));
  end if;
end $$;

-- One number belongs to one clinic.
create unique index if not exists business_wa_accounts_phone_number_id_uq
  on business_wa_accounts (phone_number_id) where phone_number_id is not null and own_status = 'connected';

-- ── Our templates in the clinic's own account ───────────────────────────────
create table if not exists wa_clinic_templates (
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  language text not null,
  category text,
  status text not null default 'PENDING',
  meta_id text,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (business_id, name, language)
);
alter table wa_clinic_templates enable row level security;
revoke all on wa_clinic_templates from anon;
grant select on wa_clinic_templates to authenticated;
drop policy if exists clinic_reads_own_templates on wa_clinic_templates;
create policy clinic_reads_own_templates on wa_clinic_templates for select to authenticated
  using (sehat_caller_owns_business(business_id) or sehat_is_admin());

-- ── The access key, in the Vault ────────────────────────────────────────────
-- One secret per clinic, named after it. Replaced on reconnect.
create or replace function sehat_wa_own_token_set(p_business uuid, p_token text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text := 'wa_clinic_token_' || p_business;
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_token, v_name, 'WhatsApp access key for one clinic''s own number (0261)');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end $$;
revoke all on function sehat_wa_own_token_set(uuid, text) from public, anon, authenticated;
grant execute on function sehat_wa_own_token_set(uuid, text) to service_role;

create or replace function sehat_wa_own_token_drop(p_business uuid)
returns void
language sql security definer set search_path = public as $$
  delete from vault.secrets where name = 'wa_clinic_token_' || p_business;
$$;
revoke all on function sehat_wa_own_token_drop(uuid) from public, anon, authenticated;
grant execute on function sehat_wa_own_token_drop(uuid) to service_role;

-- ── Which number a clinic's message goes from ───────────────────────────────
-- Its own, with the key to send from it, when the clinic is on Pro, its
-- WhatsApp is open (0218) and the number is connected. Null otherwise: the
-- message then goes from our number and is paid from the wallet, as before.
create or replace function sehat_wa_own_sender(p_business uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('phone_number_id', a.phone_number_id, 'waba_id', a.waba_id,
           'token', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_clinic_token_' || a.business_id))
    from business_wa_accounts a
   where a.business_id = p_business and a.plan = 'pro' and a.own_status = 'connected'
     and a.phone_number_id is not null
     and sehat_wa_addon_blocker(a.business_id) is null
     and exists (select 1 from vault.secrets s where s.name = 'wa_clinic_token_' || a.business_id);
$$;
revoke all on function sehat_wa_own_sender(uuid) from public, anon, authenticated;
grant execute on function sehat_wa_own_sender(uuid) to service_role;

-- A message arrived on a clinic's own number: whose is it, and the key to answer with.
create or replace function sehat_wa_own_by_phone_id(p_phone_number_id text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('business_id', a.business_id,
           'token', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_clinic_token_' || a.business_id))
    from business_wa_accounts a
   where a.phone_number_id = p_phone_number_id and a.own_status = 'connected'
   limit 1;
$$;
revoke all on function sehat_wa_own_by_phone_id(text) from public, anon, authenticated;
grant execute on function sehat_wa_own_by_phone_id(text) to service_role;

-- ── What Meta tells us later, by webhook ────────────────────────────────────
-- A template in a clinic's account was approved, rejected or paused.
create or replace function sehat_wa_own_template_update(p_waba text, p_name text, p_language text, p_status text, p_reason text)
returns void
language sql security definer set search_path = public as $$
  update wa_clinic_templates t set status = upper(coalesce(p_status, t.status)),
         reason = nullif(nullif(p_reason, ''), 'NONE'), updated_at = now()
    from business_wa_accounts a
   where a.waba_id = p_waba and t.business_id = a.business_id
     and t.name = p_name and (p_language is null or t.language = p_language);
$$;
revoke all on function sehat_wa_own_template_update(text, text, text, text, text) from public, anon, authenticated;
grant execute on function sehat_wa_own_template_update(text, text, text, text, text) to service_role;

-- The number's quality or daily limit changed.
create or replace function sehat_wa_own_quality_update(p_display_phone text, p_quality text, p_limit text)
returns void
language sql security definer set search_path = public as $$
  update business_wa_accounts
     set quality_rating = coalesce(nullif(p_quality, ''), quality_rating),
         messaging_limit = coalesce(nullif(p_limit, ''), messaging_limit),
         own_checked_at = now(), updated_at = now()
   where own_status = 'connected'
     and regexp_replace(coalesce(whatsapp_number, ''), '\D', '', 'g') = regexp_replace(coalesce(p_display_phone, ''), '\D', '', 'g');
$$;
revoke all on function sehat_wa_own_quality_update(text, text, text) from public, anon, authenticated;
grant execute on function sehat_wa_own_quality_update(text, text, text) to service_role;
