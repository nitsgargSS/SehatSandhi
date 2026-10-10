-- ============================================================================
-- 0224 — The clinic line: one shared number, and which clinic a patient means
-- ============================================================================
-- AFTER 0223. Safe to re-run.
--
-- Decided 9–10 Oct 2026: Sehatsandhi's main number is for finding and booking
-- anyone; a SECOND number carries everything a clinic sends its own patients
-- (documents, broadcasts) and is where those patients write back. Thousands of
-- clinics share it, so a message arriving there has to be tied to one of them:
--
--   BY ITS CODE    the clinic's QR and slip link open the chat with its
--        SS-code already typed ("Hi SS-F6S96 (Family Health Clinic) — …").
--   BY THE REPLY   the patient answered a message that clinic sent.
--   BY HISTORY     the clinics that have written to this number, or that the
--        patient has visited. One: that one. Several: the one in touch within
--        the last twelve hours if it is the only such; otherwise the bot asks.
--
-- sehat_wa_clinic_line answers that question for the bot (_shared/bot.ts).
-- Booking then runs through the same bot_*_json functions, which have taken a
-- clinic's code in place of a speciality since 0142.
--
--   wa_clinic_threads — which clinic last wrote to, or was picked by, which
--        number. Service only. Kept a year.
--   wa_bot_sessions.line — a patient may be mid-conversation on both numbers.
--   site_settings 'wa_clinic_number' — once set, clinic QR codes and slips
--        open the second number. Until then they open the main one, where the
--        bot reads the code just the same.
-- ============================================================================

-- ── A conversation per number ───────────────────────────────────────────────
alter table wa_bot_sessions add column if not exists line text not null default 'main';
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'wa_bot_sessions'::regclass and contype = 'p'
                    and pg_get_constraintdef(oid) = 'PRIMARY KEY (phone, line)') then
    alter table wa_bot_sessions drop constraint if exists wa_bot_sessions_pkey;
    alter table wa_bot_sessions add constraint wa_bot_sessions_pkey primary key (phone, line);
  end if;
end $$;
alter table wa_bot_sessions drop constraint if exists wa_bot_sessions_line_check;
alter table wa_bot_sessions add constraint wa_bot_sessions_line_check check (line in ('main', 'clinic'));

-- ── Who is in touch with whom ───────────────────────────────────────────────
create table if not exists wa_clinic_threads (
  phone text not null,                       -- 91 + ten digits
  business_id uuid not null references businesses(id) on delete cascade,
  last_at timestamptz not null default now(),
  last_message_id text,                      -- the clinic's last message, to recognise a reply to it
  primary key (phone, business_id)
);
create index if not exists wa_clinic_threads_message_idx on wa_clinic_threads (last_message_id) where last_message_id is not null;
alter table wa_clinic_threads enable row level security;
revoke all on wa_clinic_threads from anon, authenticated;

-- A clinic's message went to this number (deliver.ts, after a document is sent).
create or replace function sehat_wa_clinic_sent(p_phone text, p_business uuid, p_message_id text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' or p_business is null then return; end if;
  insert into wa_clinic_threads (phone, business_id, last_at, last_message_id)
  values (v_phone, p_business, now(), nullif(p_message_id, ''))
  on conflict (phone, business_id) do update
    set last_at = now(), last_message_id = coalesce(excluded.last_message_id, wa_clinic_threads.last_message_id);
end $$;
revoke all on function sehat_wa_clinic_sent(text, uuid, text) from public, anon, authenticated;
grant execute on function sehat_wa_clinic_sent(text, uuid, text) to service_role;

-- What the bot shows of a clinic.
create or replace function sehat_wa_clinic_card(p_business uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', b.qr_code, 'name', b.name,
    'phone', case when regexp_replace(coalesce(b.phone, ''), '\D', '', 'g') ~ '^(91)?[6-9][0-9]{9}$'
                  then '+91' || right(regexp_replace(b.phone, '\D', '', 'g'), 10) else '' end,
    'city', coalesce(nullif(btrim(b.own_city), ''), ''),
    'doctors', (select count(*) from public_practitioner_businesses v where v.business_id = b.id))
    from businesses b where b.id = p_business;
$$;
revoke all on function sehat_wa_clinic_card(uuid) from public, anon, authenticated;

-- ── Which clinic does this message mean? ────────────────────────────────────
-- Returns { by: 'code' | 'reply' | 'history' | 'none', chosen: card | null,
-- clinics: [card…] }. A clinic found by its code, or picked from the list
-- (which sends its code), is noted as in touch now.
create or replace function sehat_wa_clinic_line(p_phone text, p_code text default '', p_reply_to text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_code text := substring(upper(coalesce(p_code, '')) from 'SS-[A-Z0-9]{5}');
  v_biz uuid;
  v_ids uuid[];
  v_ats timestamptz[];
  v_chosen uuid;
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;

  if v_code is not null then
    select b.id into v_biz from businesses b where b.qr_code = v_code and b.status = 'active';
    if v_biz is null then return jsonb_build_object('by', 'code', 'chosen', null, 'clinics', '[]'::jsonb); end if;
    perform sehat_wa_clinic_sent(v_phone, v_biz, null);
    return jsonb_build_object('by', 'code', 'chosen', sehat_wa_clinic_card(v_biz), 'clinics', jsonb_build_array(sehat_wa_clinic_card(v_biz)));
  end if;

  if coalesce(p_reply_to, '') <> '' then
    select x.business_id into v_biz from (
      select t.business_id from wa_clinic_threads t where t.last_message_id = p_reply_to and t.phone = v_phone
      union all
      select w.business_id from wa_broadcast_recipients r join wa_broadcasts w on w.id = r.broadcast_id
       where r.wa_message_id = p_reply_to) x
      join businesses b on b.id = x.business_id and b.status = 'active'
     limit 1;
    if v_biz is not null then
      perform sehat_wa_clinic_sent(v_phone, v_biz, null);
      return jsonb_build_object('by', 'reply', 'chosen', sehat_wa_clinic_card(v_biz), 'clinics', jsonb_build_array(sehat_wa_clinic_card(v_biz)));
    end if;
  end if;

  select coalesce(array_agg(h.business_id order by h.at desc), '{}'), coalesce(array_agg(h.at order by h.at desc), '{}')
    into v_ids, v_ats
    from (
      select x.business_id, max(x.at) as at from (
        select t.business_id, t.last_at as at from wa_clinic_threads t where t.phone = v_phone
        union all
        select w.business_id, r.sent_at from wa_broadcast_recipients r join wa_broadcasts w on w.id = r.broadcast_id
         where regexp_replace(coalesce(r.phone, ''), '\D', '', 'g') in (v_phone, right(v_phone, 10)) and r.sent_at is not null
        union all
        select bp.business_id, coalesce(bp.last_seen_at, bp.created_at)
          from patients p join patient_members m on m.patient_id = p.id
          join business_patients bp on bp.patient_member_id = m.id
         where p.phone = v_phone) x
       join businesses b on b.id = x.business_id and b.status = 'active' and b.qr_code is not null
      where x.at > now() - interval '1 year'
      group by x.business_id
      order by max(x.at) desc limit 9) h;

  if cardinality(v_ids) = 0 then return jsonb_build_object('by', 'none', 'chosen', null, 'clinics', '[]'::jsonb); end if;
  if cardinality(v_ids) = 1
     or (v_ats[1] > now() - interval '12 hours' and v_ats[2] <= now() - interval '12 hours') then
    v_chosen := v_ids[1];
  end if;
  return jsonb_build_object('by', 'history',
    'chosen', case when v_chosen is null then null else sehat_wa_clinic_card(v_chosen) end,
    'clinics', (select jsonb_agg(sehat_wa_clinic_card(i) order by o) from unnest(v_ids) with ordinality u(i, o)));
end $$;
revoke all on function sehat_wa_clinic_line(text, text, text) from public, anon, authenticated;
grant execute on function sehat_wa_clinic_line(text, text, text) to service_role;

-- ── Housekeeping: threads go after a year, with the old sessions ────────────
create or replace function sehat_purge_wa_bot_sessions()
returns integer language sql security definer set search_path = public as $$
  with t as (delete from wa_clinic_threads where last_at < now() - interval '1 year' returning 1),
       d as (delete from wa_bot_sessions where updated_at < now() - interval '7 days' returning 1)
  select (select count(*) from d)::integer + 0 * (select count(*) from t)::integer;
$$;
revoke all on function sehat_purge_wa_bot_sessions() from public, anon, authenticated;

-- ── The number a clinic's QR opens ──────────────────────────────────────────
-- The clinic's own number if it has one live; else the shared clinic line once
-- site_settings says what it is; else the main number.
create or replace function sehat_business_wa_number(p_business uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select regexp_replace(a.whatsapp_number, '\D', '', 'g')
       from business_wa_accounts a
      where a.business_id = p_business and a.status = 'live'
        and length(regexp_replace(coalesce(a.whatsapp_number, ''), '\D', '', 'g')) >= 10),
    (select regexp_replace(s.value, '\D', '', 'g') from site_settings s
      where s.key = 'wa_clinic_number' and regexp_replace(coalesce(s.value, ''), '\D', '', 'g') ~ '^91[6-9][0-9]{9}$'),
    '917015399355')
$$;
revoke all on function sehat_business_wa_number(uuid) from public, anon;
grant execute on function sehat_business_wa_number(uuid) to authenticated;

notify pgrst, 'reload schema';
