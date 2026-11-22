-- ============================================================================
-- 0334 — Care Partner Program, Phase 4: which partner introduced a business
-- ============================================================================
-- AFTER 0333. Safe to re-run. Plan: docs/2026-11-partner-program-plan.md, brief §3.
--
-- The platform never sends anything to a doctor. Attribution is confirmed by
-- the business itself, inside the app:
--
--   1. Partner ID typed at sign-up (or on the dashboard before any payment) —
--      typing it is the confirmation.
--   2. Lead lock: an active partner reserves a doctor's number for
--      partner_lead_lock_days (90). When a business registers with that number
--      its credit becomes 'care_pending' and the owner is asked "Referred by
--      <first name>, <city>? Yes / No" before paying (and on the dashboard).
--      Yes → approved to the Care Partner (automatic; admin can override in
--      Partners). No, or the lock running out unanswered → back to exactly the
--      0255 rule: proposed to the online agency of the day, or direct.
--   3. Claim: within partner_claim_days of a business's first payment the admin
--      can propose a partner; the business confirms with the same Yes / No.
--
-- One partner per business is 0255's primary key. A confirmed Care Partner
-- beats the agency; while a Care lock is unanswered the agency is not proposed.
--
-- Lock data is personal data of a doctor who has not signed up: only a keyed
-- hash of the number (key in Vault), the name and the last two digits are kept,
-- and the name and digits are wiped when the lock ends (DPDP). A number already
-- on Sehatsandhi (business, doctor, staff, another partner) cannot be locked,
-- and the partner is never told why.
--
-- Lead cap (partner_lead_cap_new, 10) until the first closed business, then
-- 25, then 50 from three closed, none at Senior level and above.
--
-- Businesses can report a partner (care_partner_reports) — admin sees it in
-- Care Partners and can pause the partner.
-- ============================================================================

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'care_lead_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'care_lead_pepper',
      'Key for care_partner_leads.phone_hash (0334). Changing it unlinks every open lock.');
  end if;
end $$;

create or replace function sehat_care_phone_hash(p_phone text)
returns text language sql stable security definer set search_path = public as $$
  select case when sehat_normalise_phone(p_phone) is null then null else
    encode(sha256(convert_to((select decrypted_secret from vault.decrypted_secrets where name = 'care_lead_pepper') || ':' || sehat_normalise_phone(p_phone), 'UTF8')), 'hex') end
$$;
revoke all on function sehat_care_phone_hash(text) from public, anon, authenticated;

-- ── Leads (locks) ───────────────────────────────────────────────────────────
create table if not exists care_partner_leads (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references care_partners(id) on delete cascade,
  phone_hash    text,                     -- wiped when the lock ends
  doctor_name   text,                     -- wiped when the lock ends
  phone_last2   text,                     -- wiped when the lock ends
  status        text not null default 'locked' check (status in ('locked', 'matched', 'confirmed', 'declined', 'expired', 'released')),
  locked_until  timestamptz not null,
  business_id   uuid references businesses(id) on delete set null,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create unique index if not exists care_partner_leads_one_lock on care_partner_leads (phone_hash) where status in ('locked', 'matched');
create index if not exists care_partner_leads_partner_idx on care_partner_leads (partner_id, status);
alter table care_partner_leads enable row level security;
revoke all on care_partner_leads from anon, authenticated;   -- only through the functions below

-- ── Credits learn about Care Partners ───────────────────────────────────────
alter table business_partner_credits drop constraint if exists business_partner_credits_status_check;
alter table business_partner_credits add constraint business_partner_credits_status_check
  check (status in ('proposed', 'approved', 'direct', 'care_pending'));
alter table business_partner_credits add column if not exists care_method text check (care_method is null or care_method in ('lead_lock', 'partner_id', 'claim'));
alter table business_partner_credits add column if not exists care_lead_id uuid references care_partner_leads(id) on delete set null;
alter table business_partner_credits add column if not exists care_asked_at timestamptz;
alter table business_partner_credits add column if not exists care_answered_at timestamptz;
alter table business_partner_credits add column if not exists care_declined_partner_id uuid references marketing_partners(id) on delete set null;

create table if not exists care_partner_reports (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  partner_id   uuid not null references care_partners(id) on delete cascade,
  reason       text not null,
  status       text not null default 'open' check (status in ('open', 'closed')),
  admin_note   text,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);
alter table care_partner_reports enable row level security;
revoke all on care_partner_reports from anon;
drop policy if exists care_partner_reports_read on care_partner_reports;
create policy care_partner_reports_read on care_partner_reports for select to authenticated using (sehat_is_admin());

-- The agency fallback for a business (0255's rule, on the day it registered).
create or replace function sehat_care_agency_fallback(p_business uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v uuid;
begin
  select sehat_online_partner((b.created_at at time zone 'Asia/Kolkata')::date) into v from businesses b where b.id = p_business;
  update business_partner_credits
     set partner_id = null, proposed_partner_id = v, status = case when v is null then 'direct' else 'proposed' end,
         care_answered_at = coalesce(care_answered_at, now())
   where business_id = p_business;
end $$;
revoke all on function sehat_care_agency_fallback(uuid) from public, anon, authenticated;

-- End a lock: status, and the doctor's personal data wiped.
create or replace function sehat_care_lead_end(p_lead uuid, p_status text, p_business uuid default null)
returns void language sql volatile security definer set search_path = public as $$
  update care_partner_leads set status = p_status, ended_at = now(), business_id = coalesce(p_business, business_id),
         phone_hash = null, doctor_name = case when p_status = 'confirmed' then doctor_name end, phone_last2 = null
   where id = p_lead
$$;
revoke all on function sehat_care_lead_end(uuid, text, uuid) from public, anon, authenticated;

-- ── New business: an active lock on its number makes it care_pending ────────
create or replace function sehat_business_partner_proposed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid := sehat_online_partner((now() at time zone 'Asia/Kolkata')::date); l care_partner_leads; mp uuid;
begin
  select k.* into l from care_partner_leads k join care_partners p on p.id = k.partner_id
   where k.status = 'locked' and k.locked_until > now() and k.phone_hash = sehat_care_phone_hash(new.phone)
     and p.status = 'active' and p.marketing_partner_id is not null
   limit 1;
  if l.id is not null then
    select marketing_partner_id into mp from care_partners where id = l.partner_id;
    insert into business_partner_credits (business_id, proposed_partner_id, partner_id, status, care_method, care_lead_id)
    values (new.id, v, mp, 'care_pending', 'lead_lock', l.id)
    on conflict do nothing;
    update care_partner_leads set status = 'matched', business_id = new.id where id = l.id;
  else
    insert into business_partner_credits (business_id, proposed_partner_id, status)
    values (new.id, v, case when v is null then 'direct' else 'proposed' end)
    on conflict do nothing;
  end if;
  return new;
exception when others then return new;   -- never in the way of a registration
end $$;

-- ── Partner: reserve a doctor, list, release ────────────────────────────────
create or replace function sehat_care_lead_cap(p care_partners)
returns int language sql stable security definer set search_path = public as $$
  select case when p.level in ('senior', 'elite') then 100000 else
    (select case when n = 0 then sehat_care_setting_int('lead_cap_new', 10) when n < 3 then 25 else 50 end
       from (select count(*) n from business_partner_credits c
              where c.partner_id = p.marketing_partner_id and c.status = 'approved'
                and exists (select 1 from payments pay where pay.business_id = c.business_id and pay.status = 'paid')) x) end
$$;
revoke all on function sehat_care_lead_cap(care_partners) from public, anon, authenticated;

create or replace function sehat_care_can_work(p care_partners)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  if p.status <> 'active' then raise exception 'Your Partner ID must be active to do this.' using errcode = 'P0001'; end if;
  if p.valid_until is not null and p.valid_until < current_date then raise exception 'Your Partner ID has expired. Renew it first.' using errcode = 'P0001'; end if;
  if exists (select 1 from care_partner_contracts c where c.is_current
              and not exists (select 1 from care_partner_acceptances a where a.contract_id = c.id and a.partner_id = p.id)) then
    raise exception 'Accept the updated agreement first.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function sehat_care_can_work(care_partners) from public, anon, authenticated;

create or replace function sehat_care_lead_add(p_name text, p_phone text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; v_phone text := sehat_normalise_phone(p_phone); v_hash text; v_cap int; v_open int; v_id uuid;
begin
  if not sehat_partner_program_enabled() then raise exception 'The Partner Program is not open.' using errcode = 'P0001'; end if;
  p := sehat_care_me_row();
  perform sehat_care_can_work(p);
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'Enter the doctor''s name.' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'Enter a 10-digit mobile number.' using errcode = '22023'; end if;
  if v_phone = p.phone then raise exception 'This number can''t be locked.' using errcode = 'P0001'; end if;
  v_cap := sehat_care_lead_cap(p);
  select count(*) into v_open from care_partner_leads where partner_id = p.id and status in ('locked', 'matched') and locked_until > now();
  if v_open >= v_cap then raise exception 'You have reached your limit of % reserved doctors. Close or release some first.', v_cap using errcode = 'P0001'; end if;
  v_hash := sehat_care_phone_hash(v_phone);
  -- Already on Sehatsandhi in any role, or already reserved: one answer, no reason given.
  if exists (select 1 from businesses b where sehat_normalise_phone(b.phone) = v_phone)
     or exists (select 1 from practitioners pr where sehat_normalise_phone(pr.phone) = v_phone)
     or exists (select 1 from care_partners cp where cp.phone = v_phone)
     or exists (select 1 from care_partner_leads k where k.phone_hash = v_hash and k.status in ('locked', 'matched') and k.locked_until > now()) then
    raise exception 'This number can''t be locked.' using errcode = 'P0001';
  end if;
  -- A lock that ran out still holds the unique slot until the nightly job; end it now.
  update care_partner_leads set status = 'expired', ended_at = now(), phone_hash = null, doctor_name = null, phone_last2 = null
   where phone_hash = v_hash and status in ('locked', 'matched') and locked_until <= now();
  insert into care_partner_leads (partner_id, phone_hash, doctor_name, phone_last2, locked_until)
  values (p.id, v_hash, left(btrim(p_name), 80), right(v_phone, 2), now() + make_interval(days => sehat_care_setting_int('lead_lock_days', 90)))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'open', v_open + 1, 'cap', v_cap);
end $$;
revoke all on function sehat_care_lead_add(text, text) from public, anon;
grant execute on function sehat_care_lead_add(text, text) to authenticated;

create or replace function sehat_care_leads()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p care_partners;
begin
  p := sehat_care_me_row();
  if p.id is null then return jsonb_build_object('leads', '[]'::jsonb, 'cap', 0, 'open', 0); end if;
  return jsonb_build_object(
    'cap', sehat_care_lead_cap(p),
    'open', (select count(*) from care_partner_leads where partner_id = p.id and status in ('locked', 'matched') and locked_until > now()),
    'leads', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'doctor_name', k.doctor_name, 'phone_last2', k.phone_last2, 'locked_until', k.locked_until,
        'status', case when k.status in ('locked', 'matched') and k.locked_until <= now() then 'expired' else k.status end,
        'business_name', case when k.status in ('matched', 'confirmed') then b.name end, 'created_at', k.created_at) order by k.created_at desc)
      from care_partner_leads k left join businesses b on b.id = k.business_id where k.partner_id = p.id), '[]'::jsonb),
    -- Businesses credited to this partner: name, city, whether paying. Nothing else (brief §10).
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'city', coalesce(b.own_city, b.own_district),
        'since', c.care_answered_at, 'paying', exists (select 1 from payments pay where pay.business_id = b.id and pay.status = 'paid'))
        order by c.care_answered_at desc nulls last)
      from business_partner_credits c join businesses b on b.id = c.business_id
      where c.partner_id = p.marketing_partner_id and c.status = 'approved'), '[]'::jsonb));
end $$;
revoke all on function sehat_care_leads() from public, anon;
grant execute on function sehat_care_leads() to authenticated;

create or replace function sehat_care_lead_release(p_lead uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; l care_partner_leads;
begin
  p := sehat_care_me_row();
  select * into l from care_partner_leads where id = p_lead and partner_id = p.id;
  if l.id is null then raise exception 'No such lead.' using errcode = 'P0002'; end if;
  if l.status <> 'locked' then raise exception 'Only a reserved number that has not signed up can be released.' using errcode = 'P0001'; end if;
  perform sehat_care_lead_end(l.id, 'released');
end $$;
revoke all on function sehat_care_lead_release(uuid) from public, anon;
grant execute on function sehat_care_lead_release(uuid) to authenticated;

-- ── Business: lookup, the pending question, answering, typing a Partner ID ──
-- Public lookup for the sign-up field: first name and city of an active partner.
create or replace function sehat_care_partner_lookup(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('first_name', split_part(p.full_name, ' ', 1), 'city', p.city, 'partner_code', p.partner_code)
    from care_partners p
   where p.partner_code = upper(btrim(coalesce(p_code, ''))) and p.status = 'active'
     and (p.valid_until is null or p.valid_until >= current_date)
$$;
revoke all on function sehat_care_partner_lookup(text) from public;
grant execute on function sehat_care_partner_lookup(text) to anon, authenticated;

create or replace function sehat_care_owner_only(p_business uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  -- coalesce: sehat_caller_role is null for a stranger, and not(false or null) is null — which would let them through.
  if not coalesce(sehat_is_admin() or sehat_caller_role(p_business) = 'owner', false) then
    raise exception 'Only the owner can answer this.' using errcode = '42501';
  end if;
end $$;
revoke all on function sehat_care_owner_only(uuid) from public, anon, authenticated;

-- What the business sees: a pending question, or the partner already credited.
create or replace function sehat_care_referral(p_business uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c business_partner_credits; p care_partners;
begin
  perform sehat_care_owner_only(p_business);
  select * into c from business_partner_credits where business_id = p_business;
  if c.business_id is null or c.partner_id is null then return jsonb_build_object('state', 'none'); end if;
  select * into p from care_partners where marketing_partner_id = c.partner_id;
  if p.id is null then return jsonb_build_object('state', 'none'); end if;   -- an agency or field partner: not shown here
  if c.status = 'care_pending' then
    update business_partner_credits set care_asked_at = coalesce(care_asked_at, now()) where business_id = p_business;
    return jsonb_build_object('state', 'pending', 'first_name', split_part(p.full_name, ' ', 1), 'city', p.city, 'partner_code', p.partner_code);
  end if;
  if c.status = 'approved' then
    return jsonb_build_object('state', 'confirmed', 'first_name', split_part(p.full_name, ' ', 1), 'city', p.city, 'partner_code', p.partner_code);
  end if;
  return jsonb_build_object('state', 'none');
end $$;
revoke all on function sehat_care_referral(uuid) from public, anon;
grant execute on function sehat_care_referral(uuid) to authenticated;

create or replace function sehat_care_referral_answer(p_business uuid, p_yes boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c business_partner_credits;
begin
  perform sehat_care_owner_only(p_business);
  select * into c from business_partner_credits where business_id = p_business for update;
  if c.status is distinct from 'care_pending' then raise exception 'There is nothing to answer.' using errcode = 'P0001'; end if;
  if p_yes then
    update business_partner_credits set status = 'approved', care_answered_at = now(), decided_at = now(), decided_by_name = 'Confirmed by the business'
     where business_id = p_business;
    if c.care_lead_id is not null then perform sehat_care_lead_end(c.care_lead_id, 'confirmed', p_business); end if;
  else
    update business_partner_credits set care_declined_partner_id = c.partner_id where business_id = p_business;
    if c.care_lead_id is not null then perform sehat_care_lead_end(c.care_lead_id, 'declined', p_business); end if;
    perform sehat_care_agency_fallback(p_business);
  end if;
  return sehat_care_referral(p_business);
end $$;
revoke all on function sehat_care_referral_answer(uuid, boolean) from public, anon;
grant execute on function sehat_care_referral_answer(uuid, boolean) to authenticated;

-- Typed Partner ID (sign-up or dashboard), before the business has paid anything.
create or replace function sehat_care_attribute_by_code(p_business uuid, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b businesses; p care_partners; c business_partner_credits;
begin
  perform sehat_care_owner_only(p_business);
  select * into b from businesses where id = p_business;
  select * into p from care_partners where partner_code = upper(btrim(coalesce(p_code, ''))) and status = 'active'
     and (valid_until is null or valid_until >= current_date);
  if p.id is null or p.marketing_partner_id is null then raise exception 'That Partner ID is not valid.' using errcode = 'P0001'; end if;
  if exists (select 1 from payments where business_id = p_business and status = 'paid') then
    raise exception 'A Partner ID can only be added before the first payment. Ask the partner to raise a claim.' using errcode = 'P0001';
  end if;
  -- Self-referral: the partner's own number or email.
  if sehat_normalise_phone(b.phone) = p.phone or (p.email is not null and lower(b.email) = lower(p.email)) then
    raise exception 'A partner cannot refer their own business.' using errcode = 'P0001';
  end if;
  insert into business_partner_credits (business_id, status) values (p_business, 'direct') on conflict do nothing;
  select * into c from business_partner_credits where business_id = p_business for update;
  if c.status = 'care_pending' and c.partner_id is distinct from p.marketing_partner_id then
    raise exception 'Please answer the referral question first.' using errcode = 'P0001';
  end if;
  if c.status = 'approved' and c.partner_id is distinct from p.marketing_partner_id then
    raise exception 'This business is already credited to a partner.' using errcode = 'P0001';
  end if;
  update business_partner_credits set partner_id = p.marketing_partner_id, status = 'approved', care_method = coalesce(care_method, 'partner_id'),
         care_answered_at = now(), decided_at = now(), decided_by_name = 'Partner ID typed by the business'
   where business_id = p_business;
  if c.care_lead_id is not null then perform sehat_care_lead_end(c.care_lead_id, 'confirmed', p_business); end if;
  return sehat_care_referral(p_business);
end $$;
revoke all on function sehat_care_attribute_by_code(uuid, text) from public, anon;
grant execute on function sehat_care_attribute_by_code(uuid, text) to authenticated;

create or replace function sehat_care_report_partner(p_business uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c business_partner_credits; p care_partners;
begin
  perform sehat_care_owner_only(p_business);
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Please say what happened.' using errcode = '22023'; end if;
  select * into c from business_partner_credits where business_id = p_business;
  select * into p from care_partners where marketing_partner_id = coalesce(c.partner_id, c.care_declined_partner_id);
  if p.id is null then raise exception 'No partner is linked to your business.' using errcode = 'P0001'; end if;
  insert into care_partner_reports (business_id, partner_id, reason) values (p_business, p.id, left(btrim(p_reason), 2000));
end $$;
revoke all on function sehat_care_report_partner(uuid, text) from public, anon;
grant execute on function sehat_care_report_partner(uuid, text) to authenticated;

-- ── Admin: claim after the fact, reports ────────────────────────────────────
create or replace function sehat_admin_care_claim(p_business uuid, p_partner_code text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; c business_partner_credits; v_first timestamptz;
begin
  perform sehat_care_admin_only();
  select * into p from care_partners where partner_code = upper(btrim(coalesce(p_partner_code, '')));
  if p.id is null or p.marketing_partner_id is null then raise exception 'No such Partner ID.' using errcode = 'P0002'; end if;
  select min(created_at) into v_first from payments where business_id = p_business and status = 'paid';
  if v_first is null or v_first < now() - make_interval(days => sehat_care_setting_int('claim_days', 7)) then
    raise exception 'A claim must be made within % days of the business''s first payment.', sehat_care_setting_int('claim_days', 7) using errcode = 'P0001';
  end if;
  insert into business_partner_credits (business_id, status) values (p_business, 'direct') on conflict do nothing;
  select * into c from business_partner_credits where business_id = p_business for update;
  if c.status = 'approved' then raise exception 'This business is already credited to a partner.' using errcode = 'P0001'; end if;
  update business_partner_credits set partner_id = p.marketing_partner_id, status = 'care_pending', care_method = 'claim',
         care_asked_at = null, care_answered_at = null
   where business_id = p_business;
  perform sehat_log_staff_action('care_claim', 'business', p_business, p.partner_code, null);
end $$;
revoke all on function sehat_admin_care_claim(uuid, text) from public, anon;
grant execute on function sehat_admin_care_claim(uuid, text) to authenticated;

create or replace function sehat_admin_care_reports(p_status text default 'open')
returns table (id uuid, business_name text, business_phone text, partner_name text, partner_code text, partner_status text,
               reason text, status text, admin_note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_care_admin_only();
  return query select r.id, b.name, b.phone, p.full_name, p.partner_code, p.status, r.reason, r.status, r.admin_note, r.created_at
    from care_partner_reports r join businesses b on b.id = r.business_id join care_partners p on p.id = r.partner_id
   where p_status is null or r.status = p_status order by r.created_at desc limit 500;
end $$;
revoke all on function sehat_admin_care_reports(text) from public, anon;
grant execute on function sehat_admin_care_reports(text) to authenticated;

create or replace function sehat_admin_care_report_close(p_report uuid, p_note text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform sehat_care_admin_only();
  update care_partner_reports set status = 'closed', admin_note = nullif(btrim(coalesce(p_note, '')), ''), closed_at = now() where id = p_report;
  if not found then raise exception 'No such report.' using errcode = 'P0002'; end if;
  perform sehat_log_staff_action('care_report_close', 'care_report', p_report, null, jsonb_build_object('note', p_note));
end $$;
revoke all on function sehat_admin_care_report_close(uuid, text) from public, anon;
grant execute on function sehat_admin_care_report_close(uuid, text) to authenticated;

-- ── Nightly: locks that ran out ─────────────────────────────────────────────
create or replace function sehat_care_leads_expire()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare l care_partner_leads; n int := 0;
begin
  for l in select * from care_partner_leads where status in ('locked', 'matched') and locked_until <= now() for update skip locked loop
    if l.status = 'matched' and l.business_id is not null
       and exists (select 1 from business_partner_credits where business_id = l.business_id and status = 'care_pending' and care_lead_id = l.id) then
      perform sehat_care_agency_fallback(l.business_id);
    end if;
    perform sehat_care_lead_end(l.id, 'expired');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_care_leads_expire() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'care-leads-expiry';
    perform cron.schedule('care-leads-expiry', '25 21 * * *', 'select sehat_care_leads_expire()');   -- 02:55 IST
  end if;
end $$;

-- ── Next step: active partners now add doctors ──────────────────────────────
create or replace function sehat_care_next_step(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_done int; v_next care_partner_modules; v_np care_partner_progress; v_pending int;
begin
  if p.id is null then
    return jsonb_build_object('key', 'register', 'path', '/partner/register',
      'en', 'Fill in your details to start the free training.', 'hi', 'मुफ़्त ट्रेनिंग शुरू करने के लिए अपनी जानकारी भरें।');
  end if;
  if p.status in ('paused', 'suspended', 'terminated') then
    return jsonb_build_object('key', p.status, 'path', '/partner/help',
      'en', case p.status when 'paused' then 'Your Partner ID is paused. See Help to find out why and what to do.'
                          when 'suspended' then 'Your account is suspended. Write to us from the Help page.'
                          else 'Your partnership has ended.' end,
      'hi', case p.status when 'paused' then 'आपका Partner ID रोका गया है। कारण और आगे का कदम जानने के लिए Help देखें।'
                          when 'suspended' then 'आपका खाता निलंबित है। Help पेज से हमें लिखें।'
                          else 'आपकी साझेदारी समाप्त हो गई है।' end);
  end if;
  if p.status = 'quiz_passed' then
    return jsonb_build_object('key', 'pay', 'path', '/partner/certify',
      'en', 'You passed! Pay the certification fee to get your Partner ID.', 'hi', 'आप पास हो गए! अपना Partner ID पाने के लिए सर्टिफ़िकेशन फ़ीस दें।');
  end if;
  if p.status in ('fee_paid', 'active') then
    v_pending := (select count(*) from care_partner_contracts c where c.is_current
                   and not exists (select 1 from care_partner_acceptances a where a.contract_id = c.id and a.partner_id = p.id));
    if p.status = 'fee_paid' or v_pending > 0 then
      return jsonb_build_object('key', 'agreement', 'path', '/partner/agreement',
        'en', case when p.status = 'fee_paid' then 'Read and accept the Partner Agreement to activate your Partner ID.'
                   else 'An updated agreement or policy needs your acceptance.' end,
        'hi', case when p.status = 'fee_paid' then 'अपना Partner ID चालू करने के लिए पार्टनर एग्रीमेंट पढ़ें और स्वीकार करें।'
                   else 'एक नया एग्रीमेंट या नीति आपकी स्वीकृति के लिए है।' end);
    end if;
    if not exists (select 1 from care_partner_leads where partner_id = p.id) then
      return jsonb_build_object('key', 'first_lead', 'path', '/partner/dashboard#leads',
        'en', 'You are active. Reserve the first doctor you will talk to.', 'hi', 'आप सक्रिय हैं। जिस पहले डॉक्टर से बात करेंगे, उन्हें रिज़र्व करें।');
    end if;
    return jsonb_build_object('key', 'active', 'path', '/partner/dashboard',
      'en', 'See your reserved doctors and businesses.', 'hi', 'अपने रिज़र्व डॉक्टर और व्यवसाय देखें।');
  end if;
  select count(*), count(*) filter (where pr.quiz_passed_at is not null) into v_total, v_done
    from care_partner_modules m left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
   where m.is_published;
  select m.* into v_next from care_partner_modules m
    left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
   where m.is_published and pr.quiz_passed_at is null
   order by m.sort_order limit 1;
  if v_next.id is not null then
    select * into v_np from care_partner_progress where partner_id = p.id and module_id = v_next.id;
    if v_np.video_completed_at is not null and v_np.doc_read_at is not null then
      return jsonb_build_object('key', 'module_quiz', 'path', '/partner/quiz/' || v_next.slug, 'done', v_done, 'total', v_total,
        'en', format('Next: the quiz for "%s".', v_next.title_en), 'hi', format('अगला: "%s" का क्विज़।', v_next.title_hi));
    end if;
    return jsonb_build_object('key', 'module', 'path', '/partner/learn#' || v_next.slug, 'done', v_done, 'total', v_total,
      'en', format('Next: %s — watch the video and read the PDF.', v_next.title_en),
      'hi', format('अगला: %s — वीडियो देखें और PDF पढ़ें।', v_next.title_hi));
  end if;
  if v_total > 0 then
    return jsonb_build_object('key', 'final', 'path', '/partner/exam', 'done', v_done, 'total', v_total,
      'en', 'All modules done. Take the final exam.', 'hi', 'सभी मॉड्यूल पूरे। फ़ाइनल परीक्षा दें।');
  end if;
  return jsonb_build_object('key', 'waiting', 'path', '/partner/learn',
    'en', 'The modules are being prepared. Please check back soon.', 'hi', 'मॉड्यूल तैयार हो रहे हैं। कृपया जल्द फिर देखें।');
end $$;
revoke all on function sehat_care_next_step(care_partners) from public, anon, authenticated;

notify pgrst, 'reload schema';
