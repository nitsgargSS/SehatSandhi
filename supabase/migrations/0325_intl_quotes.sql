-- ============================================================================
-- 0325 — International: hospital requests inbox and written quotes
-- ============================================================================
-- AFTER 0324. Safe to re-run.
--
-- Asked 4 Nov 2026. Every quote goes through Sehatsandhi:
--
--   1. Admin sends a patient's request to hospitals (usually the patient's
--      shortlist), with a case note and the patient's reports. Hospitals never
--      see the patient's phone or email.
--   2. The hospital answers in Dashboard → International → Patient requests:
--      the doctor's opinion, the plan, its own price and what it includes —
--      or declines.
--   3. Admin adds Sehatsandhi's travel and stay lines (pickup, hotel nights,
--      cab, interpreter, visa help …), each marked "pay Sehatsandhi" or
--      "pay directly", and shares the quote with the patient.
--   4. The patient's tracking page shows each shared quote in three parts:
--        A. Treatment at the hospital — the hospital's price, paid to the
--           hospital;
--        B. Sehatsandhi service fee — the fee % of A (rounded up to ₹100),
--           the advance that books the treatment;
--        C. Travel and stay — Sehatsandhi's lines;
--      and an estimated total. The patient chooses one.
--
--   intl_quotes          one row per (request, hospital).
--   intl-reports bucket  private, <enquiry id>/<file>; admin uploads, and a
--                        hospital the request was sent to can read.
-- The fee % is fixed on the quote when it is shared, so a later change of
-- the fee does not change a quote the patient already has.
-- ============================================================================

create table if not exists intl_quotes (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references intl_enquiries(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  state text not null default 'asked' check (state in ('asked', 'quoted', 'declined', 'withdrawn')),
  case_note text,
  asked_at timestamptz not null default now(),
  asked_by uuid,
  -- The hospital's answer.
  opinion text,
  plan text,
  doctor_name text,
  price integer check (price is null or price > 0),
  room_type text,
  hospital_days integer check (hospital_days between 0 and 120),
  india_days integer check (india_days between 0 and 180),
  fly_after_days integer check (fly_after_days between 0 and 120),
  included text,
  excluded text,
  valid_until date,
  decline_reason text,
  quoted_at timestamptz,
  quoted_by uuid,
  -- Sehatsandhi's part: [{ "label", "amount" (₹), "pay": "sehatsandhi" | "direct", "note" }]
  travel jsonb not null default '[]'::jsonb,
  admin_note text,
  fee_pct numeric,
  shared_at timestamptz,
  chosen_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (enquiry_id, business_id)
);
create index if not exists intl_quotes_business_idx on intl_quotes (business_id, asked_at desc);

alter table intl_quotes enable row level security;
drop policy if exists intl_quotes_read on intl_quotes;
create policy intl_quotes_read on intl_quotes for select to authenticated
  using (sehat_is_admin() or sehat_is_staff());
revoke all on intl_quotes from anon;
revoke insert, update, delete on intl_quotes from authenticated;
grant select on intl_quotes to authenticated;

-- ── Reports ─────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('intl-reports', 'intl-reports', false)
on conflict (id) do nothing;

create or replace function sehat_intl_report_reader(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  if sehat_is_admin() or sehat_is_staff() then return true; end if;
  begin v_id := nullif(split_part(p_name, '/', 1), '')::uuid; exception when others then return false; end;
  return exists (select 1 from intl_quotes q where q.enquiry_id = v_id and q.state <> 'withdrawn'
                   and sehat_caller_is_business(q.business_id));
end $$;
revoke all on function sehat_intl_report_reader(text) from public, anon;
grant execute on function sehat_intl_report_reader(text) to authenticated;

drop policy if exists intl_reports_read on storage.objects;
create policy intl_reports_read on storage.objects for select to authenticated
  using (bucket_id = 'intl-reports' and sehat_intl_report_reader(name));
drop policy if exists intl_reports_write on storage.objects;
create policy intl_reports_write on storage.objects for insert to authenticated
  with check (bucket_id = 'intl-reports' and (sehat_is_admin() or sehat_is_staff()));
drop policy if exists intl_reports_delete on storage.objects;
create policy intl_reports_delete on storage.objects for delete to authenticated
  using (bucket_id = 'intl-reports' and (sehat_is_admin() or sehat_is_staff()));

-- The fee on a hospital price: fee % of it, rounded up to ₹100.
create or replace function sehat_intl_fee_on(p_price integer, p_pct numeric)
returns integer language sql immutable as $$
  select case when p_price is null then null else (ceil(p_price * coalesce(p_pct, 10) / 100.0 / 100.0) * 100)::integer end
$$;

-- ── Admin: send a request to hospitals ──────────────────────────────────────
create or replace function sehat_intl_admin_ask_quotes(p_enquiry uuid, p_hospitals uuid[], p_note text default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare e intl_enquiries; v_b uuid; v_n integer := 0; v_proc text;
begin
  if not (sehat_is_admin() or sehat_is_staff()) then raise exception 'Sehatsandhi team only.' using errcode = '42501'; end if;
  select * into e from intl_enquiries where id = p_enquiry;
  if e.id is null then raise exception 'No such request.' using errcode = 'P0002'; end if;
  if not e.consent_share then raise exception 'The patient has not agreed to share their reports.' using errcode = 'P0001'; end if;
  if coalesce(cardinality(p_hospitals), 0) = 0 then raise exception 'Choose at least one hospital.' using errcode = '22023'; end if;
  if cardinality(p_hospitals) > 5 then raise exception 'Up to 5 hospitals per request.' using errcode = '22023'; end if;
  select name into v_proc from intl_procedures where code = e.procedure_code;
  foreach v_b in array p_hospitals loop
    if not exists (select 1 from intl_hospitals where business_id = v_b and status = 'listed') then
      raise exception 'Only listed hospitals can be asked for a quote.' using errcode = 'P0001';
    end if;
    insert into intl_quotes (enquiry_id, business_id, case_note, asked_by)
    values (p_enquiry, v_b, nullif(left(btrim(coalesce(p_note, '')), 3000), ''), auth.uid())
    on conflict (enquiry_id, business_id) do update set
      state = case when intl_quotes.state = 'withdrawn' then 'asked' else intl_quotes.state end,
      case_note = coalesce(excluded.case_note, intl_quotes.case_note),
      asked_at = case when intl_quotes.state = 'withdrawn' then now() else intl_quotes.asked_at end,
      updated_at = now();
    insert into email_outbox (kind, business_id, payload)
    values ('intl_notice', v_b, jsonb_build_object('to', 'hospital',
      'subject', 'New patient from abroad asks for your quote — ' || coalesce(v_proc, 'opinion needed'),
      'lines', jsonb_build_array(
        'A patient' || coalesce(' from ' || e.country, '') || ' asks for your doctor''s opinion and a written quote' || coalesce(' for ' || v_proc, '') || '.',
        'Their details and reports are in your dashboard under International → Patient requests.',
        'Please reply within 48 hours. Every quote goes through Sehatsandhi; please do not contact the patient directly.')));
    v_n := v_n + 1;
  end loop;
  update intl_enquiries set status = 'reports', updated_at = now() where id = p_enquiry and status = 'new';
  return v_n;
end $$;

create or replace function sehat_intl_admin_withdraw_quote(p_quote uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_is_staff()) then raise exception 'Sehatsandhi team only.' using errcode = '42501'; end if;
  update intl_quotes set state = 'withdrawn', shared_at = null, updated_at = now() where id = p_quote;
end $$;

-- ── Hospital: the inbox ─────────────────────────────────────────────────────
-- What a hospital sees of each request sent to it: no phone, no email, first
-- name only.
create or replace function sehat_intl_hospital_requests(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_is_business(p_business)) then
    raise exception 'Only the owner or a manager can do this.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'enquiry_id', e.id, 'state', q.state, 'asked_at', q.asked_at, 'case_note', q.case_note,
      'patient', split_part(e.name, ' ', 1), 'country', e.country,
      'procedure_code', e.procedure_code, 'procedure', (select name from intl_procedures where code = e.procedure_code),
      'problem', e.problem, 'urgency', e.urgency, 'travel_when', e.travel_when, 'companions', e.companions,
      'language', e.prefs->>'language', 'legal_ack', e.legal_ack,
      'opinion', q.opinion, 'plan', q.plan, 'doctor_name', q.doctor_name, 'price', q.price, 'room_type', q.room_type,
      'hospital_days', q.hospital_days, 'india_days', q.india_days, 'fly_after_days', q.fly_after_days,
      'included', q.included, 'excluded', q.excluded, 'valid_until', q.valid_until, 'decline_reason', q.decline_reason,
      'quoted_at', q.quoted_at, 'shared', q.shared_at is not null,
      'chosen', e.chosen_hospital = q.business_id and q.chosen_at is not null,
      'closed', e.status in ('closed', 'cancelled') or (e.chosen_hospital is not null and e.chosen_hospital <> q.business_id))
      order by q.asked_at desc)
    from intl_quotes q join intl_enquiries e on e.id = q.enquiry_id
    where q.business_id = p_business and q.state <> 'withdrawn'), '[]'::jsonb);
end $$;

-- The hospital's answer: a quote, or { "decline": "reason" }. It can change a
-- quote until Sehatsandhi has shared it with the patient.
create or replace function sehat_intl_hospital_quote(p_business uuid, p_quote uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare q intl_quotes; v_price integer; v_valid date; v_proc text; v_name text; v_patient text;
begin
  if not sehat_caller_is_business(p_business) then
    raise exception 'Only the owner or a manager can do this.' using errcode = '42501';
  end if;
  select * into q from intl_quotes where id = p_quote and business_id = p_business;
  if q.id is null or q.state = 'withdrawn' then raise exception 'This request is no longer open.' using errcode = 'P0002'; end if;
  if q.shared_at is not null then
    raise exception 'Sehatsandhi has already shared this quote with the patient. Message Sehatsandhi to change it.' using errcode = 'P0001';
  end if;
  select b.name, split_part(e.name, ' ', 1), pr.name into v_name, v_patient, v_proc
    from intl_enquiries e join businesses b on b.id = p_business left join intl_procedures pr on pr.code = e.procedure_code
   where e.id = q.enquiry_id;

  if length(btrim(coalesce(p->>'decline', ''))) > 0 then
    update intl_quotes set state = 'declined', decline_reason = left(btrim(p->>'decline'), 1000),
      quoted_at = now(), quoted_by = auth.uid(), updated_at = now() where id = p_quote;
    insert into email_outbox (kind, business_id, payload)
    values ('intl_notice', null, jsonb_build_object('to', 'admin',
      'subject', v_name || ' declined — ' || v_patient,
      'lines', jsonb_build_array(v_name || ' declined the request from ' || v_patient || coalesce(' (' || v_proc || ')', '') || '.',
                                 'Reason: ' || left(btrim(p->>'decline'), 1000))));
    return;
  end if;

  v_price := nullif(regexp_replace(coalesce(p->>'price', ''), '[^0-9]', '', 'g'), '')::integer;
  if v_price is null or v_price < 1000 then raise exception 'Enter your price in rupees.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p->>'opinion', ''))) < 10 then
    raise exception 'Add the doctor''s opinion on the reports.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p->>'doctor_name', ''))) < 3 then raise exception 'Add the treating doctor''s name.' using errcode = '22023'; end if;
  v_valid := least(coalesce(nullif(p->>'valid_until', '')::date, current_date + 60), current_date + 365);
  if v_valid < current_date then raise exception 'The valid-until date has passed.' using errcode = '22023'; end if;

  update intl_quotes set
    state = 'quoted',
    opinion = left(btrim(p->>'opinion'), 3000),
    plan = nullif(left(btrim(coalesce(p->>'plan', '')), 3000), ''),
    doctor_name = left(btrim(p->>'doctor_name'), 120),
    price = v_price,
    room_type = nullif(left(btrim(coalesce(p->>'room_type', '')), 80), ''),
    hospital_days = nullif(p->>'hospital_days', '')::integer,
    india_days = nullif(p->>'india_days', '')::integer,
    fly_after_days = nullif(p->>'fly_after_days', '')::integer,
    included = nullif(left(btrim(coalesce(p->>'included', '')), 1500), ''),
    excluded = nullif(left(btrim(coalesce(p->>'excluded', '')), 1500), ''),
    valid_until = v_valid,
    decline_reason = null,
    quoted_at = now(), quoted_by = auth.uid(), updated_at = now()
  where id = p_quote;

  insert into email_outbox (kind, business_id, payload)
  values ('intl_notice', null, jsonb_build_object('to', 'admin',
    'subject', 'Quote in from ' || v_name || ' — ' || v_patient,
    'lines', jsonb_build_array(
      v_name || ' sent a quote for ' || v_patient || coalesce(' (' || v_proc || ')', '') || ': ₹' || to_char(v_price, 'FM99,99,99,999') || '.',
      'Add the travel and stay lines and share it with the patient: Admin → International → Patient requests.')));
end $$;

-- ── Admin: Sehatsandhi's lines, and sharing with the patient ────────────────
create or replace function sehat_intl_admin_quote(p_quote uuid, p_travel jsonb, p_note text default null, p_share boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare q intl_quotes; v_travel jsonb;
begin
  if not (sehat_is_admin() or sehat_is_staff()) then raise exception 'Sehatsandhi team only.' using errcode = '42501'; end if;
  select * into q from intl_quotes where id = p_quote;
  if q.id is null then raise exception 'No such quote.' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_travel, '[]'::jsonb)) <> 'array' then raise exception 'Travel lines must be a list.' using errcode = '22023'; end if;
  v_travel := coalesce((select jsonb_agg(jsonb_build_object(
      'label', left(btrim(x->>'label'), 120),
      'amount', greatest(coalesce(nullif(regexp_replace(coalesce(x->>'amount', ''), '[^0-9]', '', 'g'), '')::integer, 0), 0),
      'pay', case when x->>'pay' = 'direct' then 'direct' else 'sehatsandhi' end,
      'note', nullif(left(btrim(coalesce(x->>'note', '')), 300), '')))
    from jsonb_array_elements(coalesce(p_travel, '[]'::jsonb)) x
    where length(btrim(coalesce(x->>'label', ''))) > 0), '[]'::jsonb);
  if jsonb_array_length(v_travel) > 15 then raise exception 'Up to 15 travel and stay lines.' using errcode = '22023'; end if;
  if p_share and q.state <> 'quoted' then raise exception 'Only a quote the hospital has sent can be shared.' using errcode = 'P0001'; end if;
  if p_share and q.valid_until < current_date then raise exception 'This quote has expired; ask the hospital to renew it.' using errcode = 'P0001'; end if;

  update intl_quotes set
    travel = v_travel,
    admin_note = case when p_note is null then admin_note else nullif(left(btrim(p_note), 1500), '') end,
    shared_at = case when p_share then coalesce(shared_at, now()) else shared_at end,
    fee_pct = case when p_share then coalesce(fee_pct, sehat_intl_fee_pct()) else fee_pct end,
    updated_at = now()
  where id = p_quote;
  -- The first shared quote moves the request on; 0323 tells the patient.
  if p_share then
    update intl_enquiries set status = 'quotes', updated_at = now()
     where id = q.enquiry_id and status in ('new', 'reports');
  end if;
end $$;

create or replace function sehat_intl_admin_unshare(p_quote uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_is_staff()) then raise exception 'Sehatsandhi team only.' using errcode = '42501'; end if;
  update intl_quotes set shared_at = null, updated_at = now() where id = p_quote and chosen_at is null;
end $$;

-- ── Patient: the tracking page, and choosing ────────────────────────────────
create or replace function sehat_intl_track(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', split_part(e.name, ' ', 1),
    'status', e.status,
    'procedure', (select name from intl_procedures where code = e.procedure_code),
    'problem', e.problem,
    'coordinator', e.coordinator,
    'created_at', e.created_at,
    'updated_at', e.updated_at,
    'hospitals', coalesce((select jsonb_agg(b.name) from businesses b where b.id = any(e.shortlist)), '[]'::jsonb),
    'chosen', (select name from businesses where id = e.chosen_hospital),
    'fx', coalesce((select value::jsonb from site_settings where key = 'intl_fx'), '{}'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'hospital', b.name,
        'city', coalesce(nullif(b.own_city, ''), nullif(b.own_district, '')),
        'opinion', q.opinion, 'plan', q.plan, 'doctor_name', q.doctor_name,
        'room_type', q.room_type, 'hospital_days', q.hospital_days, 'india_days', q.india_days, 'fly_after_days', q.fly_after_days,
        'included', q.included, 'excluded', q.excluded, 'valid_until', q.valid_until,
        'treatment', q.price,
        'fee_pct', q.fee_pct,
        'fee', sehat_intl_fee_on(q.price, q.fee_pct),
        'travel', q.travel,
        'note', q.admin_note,
        'chosen', q.chosen_at is not null)
        order by q.price)
      from intl_quotes q join businesses b on b.id = q.business_id
      where q.enquiry_id = e.id and q.shared_at is not null and q.state = 'quoted'), '[]'::jsonb))
  from intl_enquiries e where e.token = p_token and length(coalesce(p_token, '')) >= 16
$$;

create or replace function sehat_intl_choose(p_token text, p_quote uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare e intl_enquiries; q intl_quotes; v_name text;
begin
  select * into e from intl_enquiries where token = p_token and length(coalesce(p_token, '')) >= 16;
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'We could not find this request.'); end if;
  if e.status in ('closed', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'This request is closed. Message us on WhatsApp.'); end if;
  select * into q from intl_quotes where id = p_quote and enquiry_id = e.id and shared_at is not null and state = 'quoted';
  if q.id is null then return jsonb_build_object('ok', false, 'error', 'This quote is no longer available.'); end if;
  if q.valid_until < current_date then return jsonb_build_object('ok', false, 'error', 'This quote has expired. Message your coordinator for a new one.'); end if;
  if e.status not in ('new', 'reports', 'quotes') and e.chosen_hospital is not null and e.chosen_hospital <> q.business_id then
    return jsonb_build_object('ok', false, 'error', 'Your visa and travel are already in progress. Please message your coordinator to change hospital.');
  end if;
  update intl_quotes set chosen_at = null, updated_at = now() where enquiry_id = e.id and id <> q.id and chosen_at is not null;
  update intl_quotes set chosen_at = now(), updated_at = now() where id = q.id;
  update intl_enquiries set chosen_hospital = q.business_id, updated_at = now() where id = e.id;
  select name into v_name from businesses where id = q.business_id;
  insert into email_outbox (kind, business_id, payload)
  values ('intl_notice', null, jsonb_build_object('to', 'admin',
    'subject', e.name || ' chose ' || v_name,
    'lines', jsonb_build_array(
      e.name || coalesce(' (' || e.country || ')', '') || ' chose ' || v_name || ' — hospital price ₹' || to_char(q.price, 'FM99,99,99,999')
        || ', Sehatsandhi fee ₹' || to_char(sehat_intl_fee_on(q.price, q.fee_pct), 'FM99,99,99,999') || '.',
      'Send the advance payment link and the visa letter steps.',
      coalesce('WhatsApp: ' || e.phone, '') || coalesce('  Email: ' || e.email, ''))));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function sehat_intl_fee_on(integer, numeric) from public;
revoke all on function sehat_intl_admin_ask_quotes(uuid, uuid[], text) from public, anon;
revoke all on function sehat_intl_admin_withdraw_quote(uuid) from public, anon;
revoke all on function sehat_intl_hospital_requests(uuid) from public, anon;
revoke all on function sehat_intl_hospital_quote(uuid, uuid, jsonb) from public, anon;
revoke all on function sehat_intl_admin_quote(uuid, jsonb, text, boolean) from public, anon;
revoke all on function sehat_intl_admin_unshare(uuid) from public, anon;
revoke all on function sehat_intl_track(text) from public;
revoke all on function sehat_intl_choose(text, uuid) from public;
grant execute on function sehat_intl_fee_on(integer, numeric), sehat_intl_track(text), sehat_intl_choose(text, uuid) to anon, authenticated;
grant execute on function sehat_intl_admin_ask_quotes(uuid, uuid[], text), sehat_intl_admin_withdraw_quote(uuid),
  sehat_intl_hospital_requests(uuid), sehat_intl_hospital_quote(uuid, uuid, jsonb),
  sehat_intl_admin_quote(uuid, jsonb, text, boolean), sehat_intl_admin_unshare(uuid) to authenticated;

notify pgrst, 'reload schema';
