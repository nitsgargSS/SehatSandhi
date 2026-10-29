-- ============================================================================
-- 0291 — Hospital and lab settle up: agreed terms, one ledger, statements
-- ============================================================================
-- Decided 29 Oct 2026 — phase 4, the last, of "the full hospital flow" (plan
-- doc). Money between a hospital and a lab is business to business only: the
-- lab bills the hospital for tests the hospital pays for, at an agreed rate,
-- or pays the hospital a disclosed service fee on tests the patient paid the
-- lab for. Nothing is paid to a doctor; which doctor sent each test is shown
-- for the record only.
--
--   lab_partnerships   one per hospital–lab pair. Either side proposes the
--        terms, the other accepts; changing them is a new proposal. Terms:
--          b2b_discount_pct  off the lab's price, on tests the hospital pays for
--          service_fee_pct   of the lab's price, paid to the hospital, on tests
--                            the patient paid the lab for (0 = none)
--          cycle             weekly or monthly statements
--   lab_ledger         one line per referred test, made when its report is
--        signed, with the terms of that moment: the hospital owes the lab
--        (hospital paid), or the lab owes the hospital (service fee). Without
--        an agreement a hospital-paid test is owed at the lab's full price.
--   lab_statements     the lines up to a date, netted: who pays whom. Made by
--        either side whenever they like, and by itself each week or month
--        for an agreed pair. The side that receives the money marks it paid,
--        with the payment reference. Both sides see the same lines.
--
-- Owner and manager — the money people (sehat_caller_is_business) — on both
-- sides.
-- ============================================================================

create table if not exists lab_partnerships (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references businesses(id) on delete cascade,
  lab_id uuid not null references businesses(id) on delete cascade,
  b2b_discount_pct numeric(5,2) not null default 0 check (b2b_discount_pct between 0 and 60),
  service_fee_pct numeric(5,2) not null default 0 check (service_fee_pct between 0 and 40),
  cycle text not null default 'monthly' check (cycle in ('weekly', 'monthly')),
  notes text,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'ended')),
  proposed_by uuid not null references businesses(id),
  proposed_at timestamptz not null default now(),
  -- The terms in force while a change is proposed (null before the first agreement).
  agreed_b2b_pct numeric(5,2),
  agreed_fee_pct numeric(5,2),
  agreed_cycle text,
  agreed_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (hospital_id, lab_id),
  check (hospital_id <> lab_id)
);

create table if not exists lab_statements (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references businesses(id) on delete cascade,
  lab_id uuid not null references businesses(id) on delete cascade,
  statement_no text not null,
  period_from date not null,
  period_to date not null,
  hospital_owes numeric(12,2) not null default 0,
  lab_owes numeric(12,2) not null default 0,
  -- Positive: the hospital pays the lab. Negative: the lab pays the hospital.
  net numeric(12,2) not null default 0,
  lines integer not null default 0,
  status text not null default 'open' check (status in ('open', 'paid')),
  paid_at timestamptz,
  paid_ref text,
  paid_by_name text,
  made_by_name text,
  created_at timestamptz not null default now(),
  unique (lab_id, statement_no)
);
create index if not exists lab_statements_pair_idx on lab_statements (hospital_id, lab_id, period_to desc);

create table if not exists lab_ledger (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references businesses(id) on delete cascade,
  lab_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null unique references lab_orders(id) on delete cascade,
  entry_date date not null,
  kind text not null check (kind in ('hospital_owes', 'lab_owes')),
  gross numeric(12,2) not null,
  pct numeric(5,2) not null default 0,
  amount numeric(12,2) not null,
  statement_id uuid references lab_statements(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lab_ledger_pair_idx on lab_ledger (hospital_id, lab_id, entry_date) where statement_id is null;

alter table lab_partnerships enable row level security;
alter table lab_statements enable row level security;
alter table lab_ledger enable row level security;
drop policy if exists lab_partnerships_read on lab_partnerships;
create policy lab_partnerships_read on lab_partnerships for select to authenticated
  using (sehat_is_admin() or sehat_caller_is_business(hospital_id) or sehat_caller_is_business(lab_id));
drop policy if exists lab_statements_read on lab_statements;
create policy lab_statements_read on lab_statements for select to authenticated
  using (sehat_is_admin() or sehat_caller_is_business(hospital_id) or sehat_caller_is_business(lab_id));
drop policy if exists lab_ledger_read on lab_ledger;
create policy lab_ledger_read on lab_ledger for select to authenticated
  using (sehat_is_admin() or sehat_caller_is_business(hospital_id) or sehat_caller_is_business(lab_id));
revoke all on lab_partnerships, lab_statements, lab_ledger from anon;
revoke insert, update, delete on lab_partnerships, lab_statements, lab_ledger from authenticated;
grant select on lab_partnerships, lab_statements, lab_ledger to authenticated;

create or replace function sehat_partner_money_check(p_business uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_is_business(p_business)) then
    raise exception 'Only the owner or a manager handles money with partners.' using errcode = '42501';
  end if;
end $$;
revoke all on function sehat_partner_money_check(uuid) from public, anon, authenticated;


-- ── Agreements ──────────────────────────────────────────────────────────────
-- p_business proposes to p_other. A lab proposing is the lab side; anyone
-- else proposes as the hospital, to a lab.
create or replace function sehat_lab_partner_propose(p_business uuid, p_other uuid, p_b2b_pct numeric, p_fee_pct numeric,
                                                     p_cycle text, p_notes text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_lab uuid; v_hosp uuid; v_id uuid; me businesses;
begin
  perform sehat_partner_money_check(p_business);
  select * into me from businesses where id = p_business;
  if me.vertical = 'lab' then v_lab := p_business; v_hosp := p_other;
  else v_hosp := p_business; v_lab := p_other; end if;
  if v_hosp = v_lab or not exists (select 1 from businesses where id = p_other and status = 'active') then
    raise exception 'Choose another business on Sehatsandhi.' using errcode = 'P0002';
  end if;
  if not sehat_lab_on(v_lab) then raise exception 'That business does not run a lab.' using errcode = 'P0001'; end if;
  if coalesce(p_b2b_pct, 0) not between 0 and 60 then raise exception 'The discount is 0 to 60%%.' using errcode = '22023'; end if;
  if coalesce(p_fee_pct, 0) not between 0 and 40 then raise exception 'The service fee is 0 to 40%%.' using errcode = '22023'; end if;
  if coalesce(p_cycle, '') not in ('weekly', 'monthly') then raise exception 'Statements are weekly or monthly.' using errcode = '22023'; end if;

  insert into lab_partnerships (hospital_id, lab_id, b2b_discount_pct, service_fee_pct, cycle, notes, status, proposed_by, proposed_at)
  values (v_hosp, v_lab, coalesce(p_b2b_pct, 0), coalesce(p_fee_pct, 0), p_cycle, nullif(btrim(coalesce(p_notes, '')), ''), 'proposed', p_business, now())
  on conflict (hospital_id, lab_id) do update set
    b2b_discount_pct = excluded.b2b_discount_pct, service_fee_pct = excluded.service_fee_pct, cycle = excluded.cycle,
    notes = excluded.notes, status = 'proposed', proposed_by = excluded.proposed_by, proposed_at = now(), ended_at = null
  returning id into v_id;
  return v_id;
end $$;
revoke all on function sehat_lab_partner_propose(uuid, uuid, numeric, numeric, text, text) from public, anon;
grant execute on function sehat_lab_partner_propose(uuid, uuid, numeric, numeric, text, text) to authenticated;

-- The other side agrees: the proposed terms are now the agreed ones.
create or replace function sehat_lab_partner_accept(p_partnership uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p lab_partnerships; v_me uuid;
begin
  select * into p from lab_partnerships where id = p_partnership for update;
  if p.id is null or p.status <> 'proposed' then raise exception 'Nothing to accept.' using errcode = 'P0002'; end if;
  v_me := case when p.proposed_by = p.hospital_id then p.lab_id else p.hospital_id end;
  if not (sehat_is_admin() or sehat_caller_is_business(v_me)) then
    raise exception 'Waiting for % to accept.', (select name from businesses where id = v_me) using errcode = '42501';
  end if;
  update lab_partnerships set status = 'active', agreed_b2b_pct = b2b_discount_pct, agreed_fee_pct = service_fee_pct,
         agreed_cycle = cycle, agreed_at = now()
   where id = p_partnership;
end $$;
revoke all on function sehat_lab_partner_accept(uuid) from public, anon;
grant execute on function sehat_lab_partner_accept(uuid) to authenticated;

-- Either side ends it (or withdraws a proposal). What is on the ledger stays.
create or replace function sehat_lab_partner_end(p_partnership uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p lab_partnerships;
begin
  select * into p from lab_partnerships where id = p_partnership for update;
  if p.id is null then return; end if;
  if not (sehat_is_admin() or sehat_caller_is_business(p.hospital_id) or sehat_caller_is_business(p.lab_id)) then
    raise exception 'Only the owner or a manager handles money with partners.' using errcode = '42501';
  end if;
  update lab_partnerships set status = 'ended', ended_at = now(), agreed_b2b_pct = null, agreed_fee_pct = null, agreed_cycle = null
   where id = p_partnership;
end $$;
revoke all on function sehat_lab_partner_end(uuid) from public, anon;
grant execute on function sehat_lab_partner_end(uuid) to authenticated;

-- Who can be proposed to: labs, for a hospital; for a lab, the clinics and
-- hospitals — those that have sent it tests first.
create or replace function sehat_partner_candidates(p_business uuid, p_query text default null)
returns table (id uuid, name text, city text, sent integer)
language plpgsql stable security definer set search_path = public as $$
declare me businesses;
begin
  perform sehat_partner_money_check(p_business);
  select * into me from businesses bb where bb.id = p_business;
  return query
    select b.id, b.name, coalesce(b.own_city, b.own_district),
           (select count(*)::integer from lab_orders o
             where (o.business_id = p_business and o.referral_from_business = b.id)
                or (o.business_id = b.id and o.referral_from_business = p_business))
      from businesses b
     where b.id <> p_business and b.status = 'active'
       and (case when me.vertical = 'lab' then b.vertical in ('clinic', 'hospital') else sehat_lab_on(b.id) end)
       and (coalesce(btrim(p_query), '') = '' or b.name ilike '%' || btrim(p_query) || '%' or coalesce(b.own_city, '') ilike '%' || btrim(p_query) || '%')
     order by 4 desc, (b.own_city is not distinct from me.own_city) desc, b.name
     limit 30;
end $$;
revoke all on function sehat_partner_candidates(uuid, text) from public, anon;
grant execute on function sehat_partner_candidates(uuid, text) to authenticated;


-- ── The ledger ──────────────────────────────────────────────────────────────
-- A referred test is on the ledger once its report is signed, at the terms
-- agreed then.
create or replace function sehat_lab_ledger_add(p_order uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o lab_orders; p lab_partnerships; v_day date; v_pct numeric;
begin
  select * into o from lab_orders where id = p_order;
  if o.id is null or o.source <> 'referral' or o.referral_from_business is null or o.status = 'cancelled'
     or coalesce(o.referral_amount, 0) <= 0 then return; end if;
  if exists (select 1 from lab_ledger where order_id = o.id) then return; end if;
  select * into p from lab_partnerships where hospital_id = o.referral_from_business and lab_id = o.business_id
     and agreed_at is not null and status <> 'ended';
  v_day := coalesce((select (min(r.approved_at) at time zone 'Asia/Kolkata')::date from lab_reports r where r.order_id = o.id),
                    (now() at time zone 'Asia/Kolkata')::date);
  if o.referral_payer = 'hospital' then
    v_pct := coalesce(p.agreed_b2b_pct, 0);
    insert into lab_ledger (hospital_id, lab_id, order_id, entry_date, kind, gross, pct, amount)
    values (o.referral_from_business, o.business_id, o.id, v_day, 'hospital_owes', o.referral_amount, v_pct,
            round(o.referral_amount * (100 - v_pct) / 100, 2));
  elsif o.referral_payer = 'patient' and coalesce(p.agreed_fee_pct, 0) > 0 then
    insert into lab_ledger (hospital_id, lab_id, order_id, entry_date, kind, gross, pct, amount)
    values (o.referral_from_business, o.business_id, o.id, v_day, 'lab_owes', o.referral_amount, p.agreed_fee_pct,
            round(o.referral_amount * p.agreed_fee_pct / 100, 2));
  end if;
end $$;
revoke all on function sehat_lab_ledger_add(uuid) from public, anon, authenticated;

create or replace function sehat_lab_ledger_on_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sehat_lab_ledger_add(new.order_id);
  return null;
end $$;
drop trigger if exists lab_ledger_on_report on lab_reports;
create trigger lab_ledger_on_report after insert on lab_reports
  for each row execute function sehat_lab_ledger_on_report();

-- Referred tests already reported go on the ledger.
do $$
declare r record;
begin
  for r in select o.id from lab_orders o where o.source = 'referral' and exists (select 1 from lab_reports x where x.order_id = o.id) loop
    perform sehat_lab_ledger_add(r.id);
  end loop;
end $$;


-- ── Partners at a glance ────────────────────────────────────────────────────
-- Every pair this business has an agreement or a ledger with: the terms, and
-- what has built up since the last statement.
create or replace function sehat_lab_partners(p_business uuid)
returns table (partnership_id uuid, other_id uuid, other_name text, other_phone text, i_am text,
               status text, proposed_by_me boolean,
               b2b_pct numeric, fee_pct numeric, cycle text, notes text,
               agreed_b2b_pct numeric, agreed_fee_pct numeric, agreed_cycle text, agreed_at timestamptz,
               open_hospital_owes numeric, open_lab_owes numeric, open_lines integer,
               unpaid_statements integer, unpaid_net numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_partner_money_check(p_business);
  return query
    with pairs as (
      select hospital_id h, lab_id l from lab_partnerships where hospital_id = p_business or lab_id = p_business
      union
      select hospital_id, lab_id from lab_ledger where hospital_id = p_business or lab_id = p_business
    )
    select lp.id, case when x.h = p_business then x.l else x.h end, ob.name, ob.phone,
           case when x.h = p_business then 'hospital' else 'lab' end,
           coalesce(lp.status, 'none'), lp.proposed_by = p_business,
           lp.b2b_discount_pct, lp.service_fee_pct, lp.cycle, lp.notes,
           lp.agreed_b2b_pct, lp.agreed_fee_pct, lp.agreed_cycle, lp.agreed_at,
           coalesce((select sum(e.amount) from lab_ledger e where e.hospital_id = x.h and e.lab_id = x.l and e.statement_id is null and e.kind = 'hospital_owes'), 0),
           coalesce((select sum(e.amount) from lab_ledger e where e.hospital_id = x.h and e.lab_id = x.l and e.statement_id is null and e.kind = 'lab_owes'), 0),
           (select count(*)::integer from lab_ledger e where e.hospital_id = x.h and e.lab_id = x.l and e.statement_id is null),
           (select count(*)::integer from lab_statements s where s.hospital_id = x.h and s.lab_id = x.l and s.status = 'open' and s.net <> 0),
           coalesce((select sum(s.net) from lab_statements s where s.hospital_id = x.h and s.lab_id = x.l and s.status = 'open'), 0)
      from pairs x
      join businesses ob on ob.id = case when x.h = p_business then x.l else x.h end
      left join lab_partnerships lp on lp.hospital_id = x.h and lp.lab_id = x.l
     order by (lp.status = 'proposed' and lp.proposed_by <> p_business) desc nulls last, ob.name;
end $$;
revoke all on function sehat_lab_partners(uuid) from public, anon;
grant execute on function sehat_lab_partners(uuid) to authenticated;

-- The lines between this business and one partner: not yet on a statement,
-- or on one statement.
create or replace function sehat_lab_ledger_lines(p_business uuid, p_other uuid, p_statement uuid default null)
returns table (entry_date date, order_no text, patient_name text, tests text, ordered_by_name text, payer text,
               kind text, gross numeric, pct numeric, amount numeric, statement_no text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_partner_money_check(p_business);
  return query
    select e.entry_date, o.order_no, m.full_name,
           (select string_agg(i.name, ', ' order by i.sort_order) from lab_order_items i where i.order_id = o.id),
           o.ordered_by_name, o.referral_payer, e.kind, e.gross, e.pct, e.amount, s.statement_no
      from lab_ledger e
      join lab_orders o on o.id = e.order_id
      join patient_members m on m.id = o.patient_member_id
      left join lab_statements s on s.id = e.statement_id
     where ((e.hospital_id = p_business and e.lab_id = p_other) or (e.lab_id = p_business and e.hospital_id = p_other))
       and (case when p_statement is null then e.statement_id is null else e.statement_id = p_statement end)
     order by e.entry_date, o.order_no;
end $$;
revoke all on function sehat_lab_ledger_lines(uuid, uuid, uuid) from public, anon;
grant execute on function sehat_lab_ledger_lines(uuid, uuid, uuid) to authenticated;


-- ── Statements ──────────────────────────────────────────────────────────────
-- Everything on the ledger for a pair up to a day, in one statement.
create or replace function sehat_lab_statement_build(p_hospital uuid, p_lab uuid, p_to date, p_by text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_from date; v_h numeric; v_l numeric; v_n integer; v_no text;
begin
  select min(entry_date), coalesce(sum(amount) filter (where kind = 'hospital_owes'), 0),
         coalesce(sum(amount) filter (where kind = 'lab_owes'), 0), count(*)
    into v_from, v_h, v_l, v_n
    from lab_ledger where hospital_id = p_hospital and lab_id = p_lab and statement_id is null and entry_date <= p_to;
  if v_n = 0 then return null; end if;
  v_no := 'ST/' || to_char(p_to, 'YYYY-MM') || '/' || lpad(((select count(*) from lab_statements where lab_id = p_lab) + 1)::text, 4, '0');
  insert into lab_statements (hospital_id, lab_id, statement_no, period_from, period_to, hospital_owes, lab_owes, net, lines,
                              status, paid_at, made_by_name)
  values (p_hospital, p_lab, v_no, v_from, p_to, v_h, v_l, v_h - v_l, v_n,
          case when v_h - v_l = 0 then 'paid' else 'open' end, case when v_h - v_l = 0 then now() end, p_by)
  returning id into v_id;
  update lab_ledger set statement_id = v_id
   where hospital_id = p_hospital and lab_id = p_lab and statement_id is null and entry_date <= p_to;
  return v_id;
end $$;
revoke all on function sehat_lab_statement_build(uuid, uuid, date, text) from public, anon, authenticated;

-- Either side makes a statement now, up to a day (today by default).
create or replace function sehat_lab_statement_make(p_business uuid, p_other uuid, p_to date default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_h uuid; v_l uuid; v_id uuid;
begin
  perform sehat_partner_money_check(p_business);
  if exists (select 1 from lab_ledger where hospital_id = p_business and lab_id = p_other) then v_h := p_business; v_l := p_other;
  elsif exists (select 1 from lab_ledger where lab_id = p_business and hospital_id = p_other) then v_h := p_other; v_l := p_business;
  else raise exception 'Nothing on the ledger with them yet.' using errcode = 'P0002'; end if;
  v_id := sehat_lab_statement_build(v_h, v_l, coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date), sehat_mo_actor_name(p_business));
  if v_id is null then raise exception 'Nothing new since the last statement.' using errcode = 'P0001'; end if;
  return v_id;
end $$;
revoke all on function sehat_lab_statement_make(uuid, uuid, date) from public, anon;
grant execute on function sehat_lab_statement_make(uuid, uuid, date) to authenticated;

create or replace function sehat_lab_statements(p_business uuid, p_other uuid)
returns setof lab_statements language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_partner_money_check(p_business);
  return query select * from lab_statements
    where (hospital_id = p_business and lab_id = p_other) or (lab_id = p_business and hospital_id = p_other)
    order by period_to desc, created_at desc limit 60;
end $$;
revoke all on function sehat_lab_statements(uuid, uuid) from public, anon;
grant execute on function sehat_lab_statements(uuid, uuid) to authenticated;

-- Paid: marked by the side that received the money.
create or replace function sehat_lab_statement_paid(p_statement uuid, p_ref text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s lab_statements; v_receiver uuid;
begin
  select * into s from lab_statements where id = p_statement for update;
  if s.id is null then raise exception 'No such statement.' using errcode = 'P0002'; end if;
  if s.status = 'paid' then return; end if;
  v_receiver := case when s.net > 0 then s.lab_id else s.hospital_id end;
  if not (sehat_is_admin() or sehat_caller_is_business(v_receiver)) then
    raise exception 'The side that received the money marks it paid.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_ref, ''))) < 3 then raise exception 'Give the payment reference (UTR, cheque or cash receipt).' using errcode = '22023'; end if;
  update lab_statements set status = 'paid', paid_at = now(), paid_ref = btrim(p_ref), paid_by_name = sehat_mo_actor_name(v_receiver)
   where id = p_statement;
end $$;
revoke all on function sehat_lab_statement_paid(uuid, text) from public, anon;
grant execute on function sehat_lab_statement_paid(uuid, text) to authenticated;

-- Each night: agreed pairs get their statement once a week (Monday to Sunday)
-- or a month has closed.
create or replace function sehat_lab_statements_close_due()
returns integer language plpgsql security definer set search_path = public as $$
declare
  p lab_partnerships;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_to date;
  n integer := 0;
begin
  for p in select * from lab_partnerships where status <> 'ended' and agreed_at is not null loop
    v_to := case when p.agreed_cycle = 'weekly' then date_trunc('week', v_today)::date - 1
                 else date_trunc('month', v_today)::date - 1 end;
    if sehat_lab_statement_build(p.hospital_id, p.lab_id, v_to, 'Automatic (' || p.agreed_cycle || ')') is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function sehat_lab_statements_close_due() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'lab-statements';
  -- 20:00 UTC is 01:30 in India.
  perform cron.schedule('lab-statements', '0 20 * * *', $job$ select sehat_lab_statements_close_due() $job$);
end $$;

notify pgrst, 'reload schema';
