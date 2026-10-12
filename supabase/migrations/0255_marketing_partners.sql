-- ============================================================================
-- 0255 — Marketing partners: who brought a business, and what they are owed
-- ============================================================================
-- AFTER 0254. Safe to re-run.
--
-- Sehatsandhi pays the firm (or person) that markets it a monthly incentive on
-- the business they bring, for as long as they are associated with it.
--
--   • A partner is 'online' (the firm doing online marketing — one at a time;
--     every business that registers itself while it is active is PROPOSED for
--     it) or 'field' (brings businesses in person; assigned by the admin).
--   • Nothing is credited until an admin approves it. The business is asked
--     how it heard of Sehatsandhi, which is what the admin has to go on.
--   • The incentive is a percentage of what the business pays for its plan —
--     the taxable value, never GST, never a WhatsApp wallet top-up — on money
--     actually received, on the day it was received, while the partner was
--     active. It stops at the partner's end date; a later partner earns
--     nothing on an earlier one's businesses. A refund is taken back in the
--     month it is made.
--   • The percentage has a history: a change applies from a date, so earlier
--     months stay as they were.
--   • A month's statement is a draft (recalculated each time, with lines the
--     admin may leave out, saying why) until it is finalised; then it is a
--     fixed record, and is marked paid with the date and reference.
-- Everything here is the admin's; nobody else can read or change it.
-- ============================================================================

create table if not exists marketing_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  code text not null unique check (code ~ '^[A-Z0-9-]{3,20}$'),
  kind text not null check (kind in ('online', 'field')),
  contact_name text, phone text, email text, notes text,
  active_from date not null,
  active_to date check (active_to is null or active_to >= active_from),
  created_at timestamptz not null default now()
);
create table if not exists marketing_partner_rates (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references marketing_partners(id) on delete cascade,
  percent numeric(5,2) not null check (percent >= 0 and percent <= 100),
  effective_from date not null,
  set_by_name text,
  created_at timestamptz not null default now(),
  unique (partner_id, effective_from)
);
create table if not exists business_partner_credits (
  business_id uuid primary key references businesses(id) on delete cascade,
  proposed_partner_id uuid references marketing_partners(id) on delete set null,
  partner_id uuid references marketing_partners(id) on delete set null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'direct')),
  heard_from text, heard_detail text,
  decided_by_name text, decided_at timestamptz, note text,
  created_at timestamptz not null default now(),
  check (status <> 'approved' or partner_id is not null)
);
create table if not exists marketing_statements (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references marketing_partners(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status text not null check (status in ('final', 'paid')),
  total numeric(12,2) not null,
  lines jsonb not null,
  finalised_by_name text, finalised_at timestamptz not null default now(),
  paid_on date, paid_reference text,
  unique (partner_id, month)
);
create table if not exists marketing_statement_exclusions (
  partner_id uuid not null references marketing_partners(id) on delete cascade,
  month date not null,
  ref text not null,
  reason text not null,
  by_name text, created_at timestamptz not null default now(),
  primary key (partner_id, month, ref)
);
do $$ declare t text; begin
  foreach t in array array['marketing_partners', 'marketing_partner_rates', 'business_partner_credits', 'marketing_statements', 'marketing_statement_exclusions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

create or replace function sehat_admin_label() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(full_name, ''), email) from admin_users where auth_uid = auth.uid()), 'Sehatsandhi');
$$;
create or replace function sehat_partner_only() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
end $$;

-- The online partner on a day, if there is one.
create or replace function sehat_online_partner(p_on date)
returns uuid language sql stable security definer set search_path = public as $$
  select id from marketing_partners
   where kind = 'online' and active_from <= p_on and (active_to is null or active_to >= p_on)
   order by active_from desc limit 1;
$$;
-- The percentage a partner earns on a day.
create or replace function sehat_partner_rate(p_partner uuid, p_on date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select percent from marketing_partner_rates
                    where partner_id = p_partner and effective_from <= p_on order by effective_from desc limit 1), 0);
$$;

-- Every new business gets a row: proposed for the online partner of the day, or direct.
create or replace function sehat_business_partner_proposed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid := sehat_online_partner((now() at time zone 'Asia/Kolkata')::date);
begin
  insert into business_partner_credits (business_id, proposed_partner_id, status)
  values (new.id, v, case when v is null then 'direct' else 'proposed' end)
  on conflict do nothing;
  return new;
exception when others then return new;   -- never in the way of a registration
end $$;
drop trigger if exists businesses_partner_proposed on businesses;
create trigger businesses_partner_proposed after insert on businesses
  for each row execute function sehat_business_partner_proposed();
-- Businesses from before this: nobody's, unless the admin says otherwise.
insert into business_partner_credits (business_id, status)
select b.id, 'direct' from businesses b on conflict do nothing;

-- Registration: how they heard of Sehatsandhi. The same narrow door as the category (0126).
create or replace function sehat_signup_heard_from(p_business uuid, p_answer text, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  a text := nullif(btrim(coalesce(p_answer, '')), '');
begin
  if a is null or a not in ('online_search', 'online_ad', 'social_media', 'another_doctor', 'sehatsandhi_person', 'patient', 'other') then return; end if;
  update business_partner_credits c
     set heard_from = a, heard_detail = nullif(left(btrim(coalesce(p_detail, '')), 120), '')
    from businesses b
   where c.business_id = p_business and b.id = c.business_id and c.heard_from is null
     and b.status = 'pending' and b.created_at > now() - interval '1 day';
end $$;

-- ── Admin: partners and their percentage ────────────────────────────────────
create or replace function sehat_partners() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_partner_only();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'code', p.code, 'kind', p.kind, 'contact_name', p.contact_name, 'phone', p.phone, 'email', p.email,
      'notes', p.notes, 'active_from', p.active_from, 'active_to', p.active_to,
      'active', p.active_from <= current_date and (p.active_to is null or p.active_to >= current_date),
      'percent', sehat_partner_rate(p.id, current_date),
      'rates', (select coalesce(jsonb_agg(jsonb_build_object('percent', r.percent, 'effective_from', r.effective_from, 'set_by', r.set_by_name) order by r.effective_from desc), '[]')
                  from marketing_partner_rates r where r.partner_id = p.id),
      'businesses', (select count(*) from business_partner_credits c where c.partner_id = p.id and c.status = 'approved'),
      'waiting', (select count(*) from business_partner_credits c where c.proposed_partner_id = p.id and c.status = 'proposed'))
    order by (p.active_to is null) desc, p.active_from desc) from marketing_partners p), '[]'::jsonb);
end $$;

create or replace function sehat_partner_save(
  p_id uuid, p_name text, p_code text, p_kind text, p_contact_name text, p_phone text, p_email text, p_notes text, p_from date, p_to date
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
  v_other text;
begin
  perform sehat_partner_only();
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Give the partner a name.' using errcode = 'P0001'; end if;
  if v_code !~ '^[A-Z0-9-]{3,20}$' then raise exception 'The code is 3 to 20 letters or numbers.' using errcode = 'P0001'; end if;
  if p_kind not in ('online', 'field') then raise exception 'Choose online or field.' using errcode = 'P0001'; end if;
  if p_from is null then raise exception 'Give the date the association starts.' using errcode = 'P0001'; end if;
  if p_to is not null and p_to < p_from then raise exception 'The end date is before the start date.' using errcode = 'P0001'; end if;
  if exists (select 1 from marketing_partners where code = v_code and id is distinct from v_id) then
    raise exception 'Another partner already has the code %.', v_code using errcode = 'P0001';
  end if;
  if p_kind = 'online' then
    select name into v_other from marketing_partners o
     where o.kind = 'online' and o.id is distinct from v_id
       and o.active_from <= coalesce(p_to, date '9999-12-31') and coalesce(o.active_to, date '9999-12-31') >= p_from
     limit 1;
    if v_other is not null then
      raise exception 'There is one online partner at a time: % is active in that period. Give it an end date first.', v_other using errcode = 'P0001';
    end if;
  end if;
  if v_id is null then
    insert into marketing_partners (name, code, kind, contact_name, phone, email, notes, active_from, active_to)
    values (btrim(p_name), v_code, p_kind, nullif(btrim(coalesce(p_contact_name, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
            nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), p_from, p_to)
    returning id into v_id;
  else
    update marketing_partners
       set name = btrim(p_name), code = v_code, kind = p_kind, contact_name = nullif(btrim(coalesce(p_contact_name, '')), ''),
           phone = nullif(btrim(coalesce(p_phone, '')), ''), email = nullif(btrim(coalesce(p_email, '')), ''),
           notes = nullif(btrim(coalesce(p_notes, '')), ''), active_from = p_from, active_to = p_to
     where id = v_id;
    if not found then raise exception 'That partner was not found.' using errcode = 'P0002'; end if;
  end if;
  perform sehat_log_staff_action('marketing_partner_saved', 'partner', v_id, btrim(p_name),
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to));
  return v_id;
end $$;

create or replace function sehat_partner_set_rate(p_partner uuid, p_percent numeric, p_from date)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  perform sehat_partner_only();
  select name into v_name from marketing_partners where id = p_partner;
  if v_name is null then raise exception 'That partner was not found.' using errcode = 'P0002'; end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then raise exception 'The percentage is between 0 and 100.' using errcode = 'P0001'; end if;
  if p_from is null then raise exception 'Give the date the percentage applies from.' using errcode = 'P0001'; end if;
  if exists (select 1 from marketing_statements s where s.partner_id = p_partner and s.month >= date_trunc('month', p_from)::date) then
    raise exception 'A statement for that month or later is already final. Choose a later date.' using errcode = 'P0001';
  end if;
  insert into marketing_partner_rates (partner_id, percent, effective_from, set_by_name)
  values (p_partner, p_percent, p_from, sehat_admin_label())
  on conflict (partner_id, effective_from) do update set percent = excluded.percent, set_by_name = excluded.set_by_name, created_at = now();
  perform sehat_log_staff_action('marketing_partner_rate', 'partner', p_partner, v_name, jsonb_build_object('percent', p_percent, 'from', p_from));
end $$;

-- ── Admin: who brought each business ────────────────────────────────────────
create or replace function sehat_partner_credits(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_partner_only();
  return coalesce((select jsonb_agg(x order by (x ->> 'registered_at') desc) from (
    select jsonb_build_object(
      'business_id', b.id, 'name', b.name, 'vertical', b.vertical, 'city', nullif(btrim(b.own_city), ''), 'business_status', b.status,
      'registered_at', b.created_at, 'status', c.status, 'heard_from', c.heard_from, 'heard_detail', c.heard_detail,
      'proposed_id', c.proposed_partner_id, 'proposed', (select name from marketing_partners where id = c.proposed_partner_id),
      'partner_id', c.partner_id, 'partner', (select name from marketing_partners where id = c.partner_id),
      'decided_by', c.decided_by_name, 'decided_at', c.decided_at, 'note', c.note,
      'paid', (select coalesce(sum(p.taxable_value), 0) from payments p where p.business_id = b.id and p.status = 'paid' and p.type in ('listing', 'subscription'))
              + (select coalesce(sum(o.amount_inr - coalesce(o.refunded_amount, 0)), 0) from offline_payments o where o.business_id = b.id and o.purpose in ('pilot_registration', 'subscription'))) x
      from business_partner_credits c join businesses b on b.id = c.business_id
     where p_status is null or c.status = p_status) q), '[]'::jsonb);
end $$;

-- Approve for a partner (any partner), or say it is nobody's (p_partner null).
create or replace function sehat_partner_credit_decide(p_business uuid, p_partner uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_biz text; v_partner text;
begin
  perform sehat_partner_only();
  select name into v_biz from businesses where id = p_business;
  if v_biz is null then raise exception 'That business was not found.' using errcode = 'P0002'; end if;
  if p_partner is not null then
    select name into v_partner from marketing_partners where id = p_partner;
    if v_partner is null then raise exception 'That partner was not found.' using errcode = 'P0002'; end if;
  end if;
  insert into business_partner_credits (business_id, status) values (p_business, 'direct') on conflict do nothing;
  update business_partner_credits
     set partner_id = p_partner, status = case when p_partner is null then 'direct' else 'approved' end,
         decided_by_name = sehat_admin_label(), decided_at = now(), note = nullif(btrim(coalesce(p_note, '')), '')
   where business_id = p_business;
  perform sehat_log_staff_action('marketing_credit_decided', 'business', p_business, v_biz,
    jsonb_build_object('partner', coalesce(v_partner, 'direct'), 'note', p_note));
end $$;

-- ── The month's lines: money received from a partner's businesses ───────────
create or replace function sehat_partner_lines(p_partner uuid, p_month date)
returns table (ref text, business_id uuid, business text, kind text, paid_on date, base numeric, percent numeric, incentive numeric, detail text)
language sql stable security definer set search_path = public as $$
  with p as (select * from marketing_partners where id = p_partner),
  m as (select date_trunc('month', p_month)::date as a, (date_trunc('month', p_month) + interval '1 month')::date as z),
  mine as (select c.business_id, b.name from business_partner_credits c join businesses b on b.id = c.business_id
            where c.partner_id = p_partner and c.status = 'approved'),
  online as (
    select 'pay:' || pay.id as ref, mine.business_id, mine.name, 'payment'::text as kind,
           coalesce(i.invoice_date, (pay.created_at at time zone 'Asia/Kolkata')::date) as d,
           pay.taxable_value as base,
           'Plan' || coalesce(' · ' || pay.period_months || ' months', '') || coalesce(' · invoice ' || i.invoice_number, '') as detail
      from payments pay join mine on mine.business_id = pay.business_id
      left join invoices i on i.payment_id = pay.id and i.status is distinct from 'cancelled'
     where pay.status = 'paid' and pay.type in ('listing', 'subscription') and coalesce(pay.taxable_value, 0) > 0
  ),
  offline as (
    select 'off:' || o.id, mine.business_id, mine.name, 'payment', o.paid_at, o.amount_inr,
           'Received by ' || upper(coalesce(o.method, 'other')) || coalesce(' · ' || o.reference_no, '')
      from offline_payments o join mine on mine.business_id = o.business_id
     where o.purpose in ('pilot_registration', 'subscription') and coalesce(o.amount_inr, 0) > 0
  ),
  -- A refund takes back what was earned on that payment, at the percentage of the day it was paid.
  refunds as (
    select 'ref:' || o.id, mine.business_id, mine.name, 'refund', o.refunded_at, -o.refunded_amount,
           'Refund of the payment of ' || to_char(o.paid_at, 'DD Mon YYYY'), o.paid_at as earned_on
      from offline_payments o join mine on mine.business_id = o.business_id
     where o.purpose in ('pilot_registration', 'subscription') and coalesce(o.refunded_amount, 0) > 0 and o.refunded_at is not null
  ),
  everything as (
    select ref, business_id, name, kind, d, base, detail, d as earned_on from online
    union all select *, paid_at from offline
    union all select * from refunds
  )
  select e.ref, e.business_id, e.name, e.kind, e.d, e.base,
         sehat_partner_rate(p_partner, e.earned_on), round(e.base * sehat_partner_rate(p_partner, e.earned_on) / 100, 2), e.detail
    from everything e, p, m
   where e.d >= m.a and e.d < m.z
     -- Earned only on money that came in while the partner was with us.
     and e.earned_on >= p.active_from and (p.active_to is null or e.earned_on <= p.active_to)
   order by e.d, e.name;
$$;

-- The statement for a month: the fixed record if it is final, else today's draft.
create or replace function sehat_partner_statement(p_partner uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  s marketing_statements;
  v_lines jsonb;
begin
  perform sehat_partner_only();
  select * into s from marketing_statements where partner_id = p_partner and month = v_month;
  if s.id is not null then
    return jsonb_build_object('status', s.status, 'month', v_month, 'total', s.total, 'lines', s.lines,
      'finalised_by', s.finalised_by_name, 'finalised_at', s.finalised_at, 'paid_on', s.paid_on, 'paid_reference', s.paid_reference);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('ref', l.ref, 'business_id', l.business_id, 'business', l.business, 'kind', l.kind,
           'paid_on', l.paid_on, 'base', l.base, 'percent', l.percent, 'incentive', l.incentive, 'detail', l.detail,
           'excluded', x.ref is not null, 'reason', x.reason) order by l.paid_on, l.business), '[]'::jsonb)
    into v_lines
    from sehat_partner_lines(p_partner, v_month) l
    left join marketing_statement_exclusions x on x.partner_id = p_partner and x.month = v_month and x.ref = l.ref;
  return jsonb_build_object('status', 'draft', 'month', v_month, 'lines', v_lines,
    'total', coalesce((select sum((e ->> 'incentive')::numeric) from jsonb_array_elements(v_lines) e where not (e ->> 'excluded')::boolean), 0));
end $$;

create or replace function sehat_partner_statement_exclude(p_partner uuid, p_month date, p_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform sehat_partner_only();
  if exists (select 1 from marketing_statements where partner_id = p_partner and month = v_month) then
    raise exception 'This statement is final and cannot be changed.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    delete from marketing_statement_exclusions where partner_id = p_partner and month = v_month and ref = p_ref;   -- put it back
  else
    insert into marketing_statement_exclusions (partner_id, month, ref, reason, by_name)
    values (p_partner, v_month, p_ref, left(v_reason, 200), sehat_admin_label())
    on conflict (partner_id, month, ref) do update set reason = excluded.reason, by_name = excluded.by_name, created_at = now();
  end if;
end $$;

create or replace function sehat_partner_statement_finalise(p_partner uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  d jsonb; v_name text;
begin
  perform sehat_partner_only();
  select name into v_name from marketing_partners where id = p_partner;
  if v_name is null then raise exception 'That partner was not found.' using errcode = 'P0002'; end if;
  if v_month >= date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date then
    raise exception 'A month is finalised after it has ended.' using errcode = 'P0001';
  end if;
  if exists (select 1 from marketing_statements where partner_id = p_partner and month = v_month) then
    raise exception 'This statement is already final.' using errcode = 'P0001';
  end if;
  d := sehat_partner_statement(p_partner, v_month);
  insert into marketing_statements (partner_id, month, status, total, lines, finalised_by_name)
  values (p_partner, v_month, 'final', (d ->> 'total')::numeric, d -> 'lines', sehat_admin_label());
  perform sehat_log_staff_action('marketing_statement_final', 'partner', p_partner, v_name, jsonb_build_object('month', v_month, 'total', d -> 'total'));
  return sehat_partner_statement(p_partner, v_month);
end $$;

create or replace function sehat_partner_statement_paid(p_partner uuid, p_month date, p_paid_on date, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_name text;
begin
  perform sehat_partner_only();
  if p_paid_on is null then raise exception 'Give the date it was paid.' using errcode = 'P0001'; end if;
  update marketing_statements set status = 'paid', paid_on = p_paid_on, paid_reference = nullif(btrim(coalesce(p_reference, '')), '')
   where partner_id = p_partner and month = v_month;
  if not found then raise exception 'Finalise the statement first.' using errcode = 'P0001'; end if;
  select name into v_name from marketing_partners where id = p_partner;
  perform sehat_log_staff_action('marketing_statement_paid', 'partner', p_partner, v_name, jsonb_build_object('month', v_month, 'paid_on', p_paid_on, 'reference', p_reference));
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'sehat_admin_label()', 'sehat_partner_only()', 'sehat_online_partner(date)', 'sehat_partner_rate(uuid, date)',
    'sehat_partners()', 'sehat_partner_save(uuid, text, text, text, text, text, text, text, date, date)', 'sehat_partner_set_rate(uuid, numeric, date)',
    'sehat_partner_credits(text)', 'sehat_partner_credit_decide(uuid, uuid, text)', 'sehat_partner_lines(uuid, date)',
    'sehat_partner_statement(uuid, date)', 'sehat_partner_statement_exclude(uuid, date, text, text)',
    'sehat_partner_statement_finalise(uuid, date)', 'sehat_partner_statement_paid(uuid, date, date, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function sehat_partner_lines(uuid, date) from authenticated;   -- read through sehat_partner_statement only
revoke all on function sehat_signup_heard_from(uuid, text, text) from public;
grant execute on function sehat_signup_heard_from(uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
