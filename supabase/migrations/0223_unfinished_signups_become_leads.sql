-- ============================================================================
-- 0223 — A registration left at the payment screen becomes a lead
-- ============================================================================
-- AFTER 0222. Safe to re-run.
--
-- The wizard saves a business as 'pending' just before the payment screen —
-- the payment needs something to attach to, and "register now, pay later" is
-- offered. So someone who stops at the last screen leaves a pending business
-- behind, with a name, a mobile number and an email. It was visible only among
-- the pending listings; nobody was told to ring them, and nothing wrote to
-- them again. Decided 10 Oct 2026:
--
--   A LEAD   half an hour after registering, a business still unpaid is put
--        into the doctor leads (0115, 0154) — source "Unfinished
--        registration", stage "Registered", follow-up today — or joined to
--        the lead already open for that number. It stays until someone at
--        Sehatsandhi closes it. If the business pays, the lead closes itself
--        as won.
--
--   TWO REMINDERS   by email, a day after and five days after, saying what
--        joining gives them (email-send's 'signup_reminder'). Not sent once
--        the lead is closed, the business has paid, or it has been removed.
--        Each is noted on the lead's timeline. Only for registrations begun
--        after this migration: the ones already lying there become leads,
--        but are not written to out of the blue (site_settings
--        'signup_reminders_from').
--
--   REMOVING IT   an admin can delete an unfinished registration from the
--        lead — the business, its payment attempts, and the doctor and login
--        that exist only because of it — so the same number and email can
--        register afresh. Never a business that has paid, has patients, or
--        whose people belong anywhere else.
-- ============================================================================

alter table doctor_leads add column if not exists business_id uuid references businesses(id) on delete set null;
create index if not exists doctor_leads_business_idx on doctor_leads (business_id) where business_id is not null;

-- They gave their number by registering.
alter table doctor_leads drop constraint if exists doctor_leads_consent_check;
alter table doctor_leads add constraint doctor_leads_consent_check
  check (consent_type is null or consent_type in ('called_us', 'messaged_us', 'ad_optin', 'registered'));

alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check
  check (kind in ('business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite',
                  'nurse_unassigned', 'wa_broadcast_rejected', 'signup_reminder'));

-- Reminders start with registrations made from now on.
insert into site_settings (key, value) values ('signup_reminders_from', now()::text) on conflict (key) do nothing;

-- Has this business ever paid?
create or replace function sehat_business_has_paid(p_business uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from payments p where p.business_id = p_business and p.status = 'paid');
$$;
revoke all on function sehat_business_has_paid(uuid) from public, anon, authenticated;

-- ── Unfinished registrations → leads, and their reminders ───────────────────
-- Run by pg_cron every fifteen minutes. Returns how many leads it made or
-- joined, and how many reminders it queued.
create or replace function sehat_follow_unfinished_signups()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b record;
  v_phone text;
  v_lead uuid;
  v_leads integer := 0;
  v_mails integer := 0;
  v_n integer;
begin
  -- 1. Leads.
  for b in
    select x.* from businesses x
     where x.status = 'pending'
       and x.created_at < now() - interval '30 minutes'
       and x.created_at > now() - interval '60 days'
       and not sehat_business_has_paid(x.id)
       and not exists (select 1 from doctor_leads l where l.business_id = x.id)
  loop
    v_phone := sehat_norm_phone(coalesce(b.phone, ''));
    if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then continue; end if;
    v_phone := '91' || v_phone;

    select l.id into v_lead from doctor_leads l
     where l.phone = v_phone and l.closed_at is null order by l.created_at desc limit 1;
    if v_lead is not null then
      update doctor_leads set business_id = b.id, stage = 'registered',
             registered_at = coalesce(registered_at, b.created_at),
             email = coalesce(email, nullif(btrim(b.email), '')), city = coalesce(city, nullif(btrim(b.own_city), '')),
             next_followup = least(coalesce(next_followup, current_date), current_date)
       where id = v_lead;
    else
      insert into doctor_leads (name, phone, email, city, source, consent_type, stage, registered_at, next_followup, business_id)
      values (b.name, v_phone, nullif(btrim(b.email), ''), nullif(btrim(b.own_city), ''),
              'signup_unfinished', 'registered', 'registered', b.created_at, current_date, b.id)
      returning id into v_lead;
    end if;
    insert into doctor_lead_notes (lead_id, kind, note, author_label)
    values (v_lead, 'note',
            'Started registering "' || b.name || '" (' || coalesce(b.vertical, 'business') || ') on '
            || to_char(b.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
            || ' and stopped before paying.'
            || case when b.renewal_term_months is not null
                    then ' Plan picked: ' || b.renewal_term_months || ' month' || case when b.renewal_term_months = 1 then '' else 's' end
                         || case when coalesce(b.renewal_whatsapp, false) then ', with WhatsApp.' else ', without WhatsApp.' end
                    else '' end
            || ' Doctors entered: ' || (select count(*) from business_practitioners bp where bp.business_id = b.id) || '.',
            'Sehatsandhi');
    v_leads := v_leads + 1;
  end loop;

  -- 2. Reminders: the first a day on, the second five days on. Only while the
  --    lead is open — closing it is how someone says "leave them be".
  for b in
    select x.id, x.created_at, l.id as lead_id
      from businesses x
      join doctor_leads l on l.business_id = x.id and l.closed_at is null and l.stage <> 'not_interested'
     where x.status = 'pending'
       and x.created_at < now() - interval '1 day'
       and x.created_at > now() - interval '30 days'
       and x.created_at >= coalesce((select value::timestamptz from site_settings where key = 'signup_reminders_from'), now())
       and coalesce(btrim(x.email), '') like '%@%'
       and not sehat_business_has_paid(x.id)
  loop
    v_n := case when b.created_at < now() - interval '5 days' then 2 else 1 end;
    -- The first is not sent late beside the second: one reminder at a time,
    -- and never the same one twice.
    if exists (select 1 from email_outbox o where o.business_id = b.id and o.kind = 'signup_reminder'
                  and ((o.payload ->> 'n')::int >= v_n or o.created_at > now() - interval '2 days')) then
      continue;
    end if;
    insert into email_outbox (kind, business_id, payload) values ('signup_reminder', b.id, jsonb_build_object('n', v_n));
    insert into doctor_lead_notes (lead_id, kind, note, author_label)
    values (b.lead_id, 'email', case v_n when 1 then 'First' else 'Second' end || ' reminder email queued: what joining Sehatsandhi gives them, and the link to finish.', 'Sehatsandhi');
    v_mails := v_mails + 1;
  end loop;

  return jsonb_build_object('leads', v_leads, 'reminders', v_mails);
end $$;
revoke all on function sehat_follow_unfinished_signups() from public, anon, authenticated;
grant execute on function sehat_follow_unfinished_signups() to service_role;

-- ── Paid: the lead is won ───────────────────────────────────────────────────
create or replace function sehat_lead_won_when_active()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    update doctor_leads set stage = 'active', closed_at = now(), close_reason = 'registered'
     where business_id = new.id and closed_at is null;
  end if;
  return new;
end $$;
drop trigger if exists businesses_lead_won on businesses;
create trigger businesses_lead_won after update of status on businesses
  for each row execute function sehat_lead_won_when_active();

-- ── Removing an unfinished registration ─────────────────────────────────────
-- What may go: a pending business that never paid and never saw a patient; the
-- doctors attached to it and to nothing else, who have written nothing; and
-- the login made for it, if that login is nobody else's. The lead stays, with
-- a note of what was removed — it is the record that they tried.
create or replace function sehat_admin_delete_unfinished_signup(p_business uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b businesses;
  v_docs uuid[];
  v_removed_docs integer := 0;
  v_login boolean := false;
  v_uids uuid[];
  u uuid;
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into b from businesses where id = p_business for update;
  if b.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  if b.status <> 'pending' then raise exception 'Only a registration that is still pending can be removed.' using errcode = 'P0001'; end if;
  if sehat_business_has_paid(b.id) then raise exception 'This business has paid. It cannot be removed here.' using errcode = 'P0001'; end if;
  if exists (select 1 from appointments where business_id = b.id)
     or exists (select 1 from business_patients where business_id = b.id)
     or exists (select 1 from prescriptions where business_id = b.id) then
    raise exception 'This business already has patients or appointments. It cannot be removed here.' using errcode = 'P0001';
  end if;

  -- Its people, before the links go.
  select coalesce(array_agg(bp.practitioner_id), '{}') into v_docs from business_practitioners bp where bp.business_id = b.id;
  select coalesce(array_agg(distinct x), '{}') into v_uids from (
    select b.auth_uid as x where b.auth_uid is not null
    union select p.auth_uid from practitioners p where p.id = any(v_docs) and p.auth_uid is not null) t;

  delete from payments where business_id = b.id;
  delete from discount_code_usage where business_id = b.id;
  delete from email_outbox where business_id = b.id and status = 'pending';
  delete from businesses where id = b.id;          -- its links, hours and settings go with it

  with gone as (
    delete from practitioners p
     where p.id = any(v_docs)
       and not exists (select 1 from business_practitioners bp where bp.practitioner_id = p.id)
       and not exists (select 1 from prescriptions r where r.practitioner_id = p.id)
       and not exists (select 1 from discharge_summaries s where s.practitioner_id = p.id)
    returning 1)
  select count(*) into v_removed_docs from gone;

  -- The login, only if it is nobody else's.
  foreach u in array v_uids loop
    if not exists (select 1 from businesses where auth_uid = u)
       and not exists (select 1 from practitioners where auth_uid = u)
       and not exists (select 1 from admin_users where auth_uid = u)
       and not exists (select 1 from patient_app_accounts where auth_uid = u) then
      delete from auth_password_state where auth_uid = u;
      delete from phone_verifications where auth_uid = u;
      delete from auth.users where id = u;
      v_login := true;
    end if;
  end loop;

  insert into doctor_lead_notes (lead_id, kind, note)
  select l.id, 'note', 'The unfinished registration "' || b.name || '" was removed, so this number and email can register afresh.'
    from doctor_leads l where l.phone = '91' || sehat_norm_phone(coalesce(b.phone, ''));

  perform sehat_log_staff_action('unfinished_signup_deleted', 'business', b.id, b.name,
    jsonb_build_object('doctors_removed', v_removed_docs, 'login_removed', v_login));
  return jsonb_build_object('name', b.name, 'doctors_removed', v_removed_docs, 'login_removed', v_login);
end $$;
revoke all on function sehat_admin_delete_unfinished_signup(uuid) from public, anon;
grant execute on function sehat_admin_delete_unfinished_signup(uuid) to authenticated;

-- ── Every fifteen minutes ───────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'follow-unfinished-signups';
  perform cron.schedule('follow-unfinished-signups', '*/15 * * * *', 'select public.sehat_follow_unfinished_signups()');
end $$;

notify pgrst, 'reload schema';
