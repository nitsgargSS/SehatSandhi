-- ============================================================================
-- 0333 — Care Partner Program, Phase 3: certification, Partner ID, agreement, tickets
-- ============================================================================
-- AFTER 0332. Safe to re-run. Independent of 0330 (EMI invoices).
-- Plan: docs/2026-11-partner-program-plan.md
--
--   Certification fee   payments.type 'partner_fee' (care_partner_id set, no
--                       business). Amount = partner_cert_fee, all taxes
--                       included: the GST is backed out of it (CGST+SGST in our
--                       state, IGST elsewhere), only while tax_settings has GST on.
--                       Order: Edge Function partner-fee-order; verification:
--                       razorpay-verify / razorpay-webhook → fulfilPayment →
--                       sehat_care_fee_paid.
--   Partner ID          SP- + 6 characters (no 0/O/1/I), issued once on payment.
--                       The partner also becomes a marketing_partners row of kind
--                       'care' (0255), so rewards and payouts (Phase 5) use the one
--                       money system. Status → fee_paid, valid 12 months.
--   Fee invoice         an ordinary invoice in the same number series and GST
--                       export: B2C, to the partner. SAC and wording are settings
--                       (partner_fee_sac, CHECK with the CA).
--   /verify/<ID>        public: name, city, status, valid until. Nothing else.
--   Agreement           every current contract, accepted together with a WhatsApp
--                       code (partner-otp, same codes table). fee_paid → active.
--                       A new current version is asked again (pending contracts).
--   Tickets             partner ↔ admin threads (training, payment, technical,
--                       complaint, other).
--
-- Also: sehat_care_quiz_wait orders attempts by when they started (robustness).
-- ============================================================================

insert into site_settings (key, value) values
  ('partner_fee_sac', '999293'),
  ('partner_id_valid_months', '12')
on conflict (key) do nothing;
insert into site_settings (key, value) values
  ('partner_fee_description', 'Care Partner certification (training, assessment and Partner ID)')
on conflict (key) do nothing;

-- ── Money tables learn about partners ───────────────────────────────────────
alter table payments drop constraint if exists payments_type_check;
alter table payments add constraint payments_type_check
  check (type = any (array['subscription', 'premium_slot', 'listing', 'wallet_topup', 'partner_fee']));
alter table payments add column if not exists care_partner_id uuid references care_partners(id) on delete set null;
create index if not exists payments_care_partner_idx on payments (care_partner_id) where care_partner_id is not null;

alter table marketing_partners drop constraint if exists marketing_partners_kind_check;
alter table marketing_partners add constraint marketing_partners_kind_check check (kind in ('online', 'field', 'care'));

alter table care_partners add column if not exists fee_payment_id uuid references payments(id) on delete set null;
alter table care_partners add column if not exists fee_invoice_id uuid references invoices(id) on delete set null;

-- ── Quiz wait: the latest attempt by start time ─────────────────────────────
create or replace function sehat_care_quiz_wait(p_partner uuid, p_kind text, p_module uuid)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare a care_partner_attempts; v_fails int; v_last care_partner_attempts;
        v_hours int := sehat_care_setting_int('retake_hours', 48);
        v_after int := sehat_care_setting_int('fail_lock_after', 3);
        v_days int := sehat_care_setting_int('fail_lock_days', 7);
begin
  for a in select * from care_partner_attempts
            where partner_id = p_partner and kind = p_kind and module_id is not distinct from p_module
              and submitted_at is null and expires_at < now() for update loop
    select count(*) + 1 into v_fails from care_partner_attempts
     where partner_id = p_partner and kind = p_kind and module_id is not distinct from p_module and passed = false;
    update care_partner_attempts set submitted_at = expires_at, passed = false, abandoned = true, correct_count = 0, score_pct = 0,
           next_allowed_at = expires_at + case when v_after > 0 and v_fails % v_after = 0 then make_interval(days => v_days) else make_interval(hours => v_hours) end
     where id = a.id;
  end loop;
  select * into v_last from care_partner_attempts
   where partner_id = p_partner and kind = p_kind and module_id is not distinct from p_module and submitted_at is not null
   order by started_at desc limit 1;
  if v_last.id is not null and v_last.passed = false and v_last.next_allowed_at > now() then return v_last.next_allowed_at; end if;
  return null;
end $$;
revoke all on function sehat_care_quiz_wait(uuid, text, uuid) from public, anon, authenticated;

-- ── State name → GST state code (the names the registration form offers) ────
create or replace function sehat_state_code_of(p_name text)
returns text language sql immutable as $$
  select case lower(btrim(coalesce(p_name, '')))
    when 'jammu and kashmir' then '01' when 'himachal pradesh' then '02' when 'punjab' then '03' when 'chandigarh' then '04'
    when 'uttarakhand' then '05' when 'haryana' then '06' when 'delhi' then '07' when 'rajasthan' then '08'
    when 'uttar pradesh' then '09' when 'bihar' then '10' when 'sikkim' then '11' when 'arunachal pradesh' then '12'
    when 'nagaland' then '13' when 'manipur' then '14' when 'mizoram' then '15' when 'tripura' then '16'
    when 'meghalaya' then '17' when 'assam' then '18' when 'west bengal' then '19' when 'jharkhand' then '20'
    when 'odisha' then '21' when 'chhattisgarh' then '22' when 'madhya pradesh' then '23' when 'gujarat' then '24'
    when 'dadra and nagar haveli and daman and diu' then '26' when 'maharashtra' then '27' when 'karnataka' then '29'
    when 'goa' then '30' when 'lakshadweep' then '31' when 'kerala' then '32' when 'tamil nadu' then '33'
    when 'puducherry' then '34' when 'andaman and nicobar islands' then '35' when 'telangana' then '36'
    when 'andhra pradesh' then '37' when 'ladakh' then '38' end
$$;

-- ── Fee: prepare the payment row (the partner, through partner-fee-order) ───
create or replace function sehat_care_fee_prepare()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; ts tax_settings; v_fee numeric(12,2); v_rate numeric(5,2) := 0; v_taxable numeric(12,2);
        v_tax numeric(12,2) := 0; v_cgst numeric(12,2) := 0; v_sgst numeric(12,2) := 0; v_igst numeric(12,2) := 0;
        v_state text; v_id uuid;
begin
  if not sehat_partner_program_enabled() then raise exception 'The Partner Program is not open.' using errcode = 'P0001'; end if;
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  if p.status <> 'quiz_passed' then
    raise exception '%', case when p.partner_code is not null then 'Your Partner ID is already issued.' else 'Pass the final exam first.' end using errcode = 'P0001';
  end if;
  v_fee := sehat_care_setting_int('cert_fee', 100);
  if v_fee <= 0 then raise exception 'The certification fee is not set.' using errcode = 'P0001'; end if;

  select * into ts from tax_settings where id;
  v_state := sehat_state_code_of(p.state);
  v_taxable := v_fee;
  if coalesce(ts.gst_enabled, false) and coalesce(ts.gstin, '') <> '' then
    v_rate := coalesce(ts.gst_rate, 18);
    v_taxable := round(v_fee * 100 / (100 + v_rate), 2);   -- all taxes included: back the GST out
    v_tax := v_fee - v_taxable;
    if v_state is not null and v_state <> ts.state_code then v_igst := v_tax;
    else v_cgst := round(v_tax / 2, 2); v_sgst := v_tax - v_cgst; end if;
  end if;

  insert into payments (type, care_partner_id, amount, status, taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount,
                        tax_total, place_of_supply, line_items)
  values ('partner_fee', p.id, v_fee, 'pending', v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_tax, coalesce(v_state, ts.state_code),
          jsonb_build_array(jsonb_build_object('label', coalesce((select value from site_settings where key = 'partner_fee_description'), 'Care Partner certification'), 'amount', v_taxable)))
  returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount', v_fee, 'amount_paise', (v_fee * 100)::bigint,
                            'name', p.full_name, 'phone', p.phone, 'email', p.email);
end $$;
revoke all on function sehat_care_fee_prepare() from public, anon;
grant execute on function sehat_care_fee_prepare() to authenticated;

-- ── Fee paid: Partner ID, money-system row, invoice (service role, idempotent) ─
create or replace function sehat_care_fee_paid(p_payment uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare pay payments; p care_partners; ts tax_settings; inv invoices; v_code text; v_mp uuid; i int;
        cs constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  select * into pay from payments where id = p_payment for update;
  if pay.id is null or pay.type <> 'partner_fee' or pay.status <> 'paid' then
    raise exception 'Not a paid partner fee.' using errcode = 'P0001';
  end if;
  select * into p from care_partners where id = pay.care_partner_id for update;
  if p.id is null then raise exception 'The partner for this payment is gone.' using errcode = 'P0002'; end if;

  -- Already issued (verify and webhook both arrive): return what exists.
  if p.partner_code is not null then
    select * into inv from invoices where id = p.fee_invoice_id;
    return jsonb_build_object('partner_code', p.partner_code, 'already', true, 'invoice_number', inv.invoice_number,
                              'invoice_token', inv.public_token, 'email', p.email, 'name', p.full_name);
  end if;

  loop
    v_code := 'SP-';
    for i in 1..6 loop v_code := v_code || substr(cs, 1 + floor(random() * length(cs))::int, 1); end loop;
    exit when not exists (select 1 from care_partners where partner_code = v_code)
          and not exists (select 1 from marketing_partners where code = v_code);
  end loop;

  insert into marketing_partners (name, code, kind, contact_name, phone, email, notes, active_from)
  values (p.full_name, v_code, 'care', p.full_name, p.phone, p.email, 'Care Partner (0333)', current_date)
  returning id into v_mp;

  select * into ts from tax_settings where id;
  insert into invoices (
    invoice_number, invoice_date, fy, business_id, payment_id,
    supplier_legal_name, supplier_trade_name, supplier_gstin, supplier_state_code, supplier_address,
    recipient_name, recipient_gstin, recipient_state_code, recipient_address, recipient_phone, recipient_email,
    sac_code, description, taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, tax_total, total_amount,
    place_of_supply, reverse_charge, line_items
  ) values (
    sehat_next_invoice_number(current_date), current_date, sehat_financial_year(current_date), null, pay.id,
    ts.legal_name, ts.trade_name, case when coalesce(pay.tax_total, 0) > 0 then ts.gstin end, ts.state_code,
    concat_ws(', ', ts.registered_address, ts.city, ts.pin_code),
    p.full_name, null, sehat_state_code_of(p.state), concat_ws(', ', p.city, p.state), p.phone, p.email,
    coalesce((select value from site_settings where key = 'partner_fee_sac'), '999293'),
    coalesce((select value from site_settings where key = 'partner_fee_description'), 'Care Partner certification'),
    coalesce(pay.taxable_value, pay.amount), coalesce(pay.gst_rate, 0), coalesce(pay.cgst_amount, 0), coalesce(pay.sgst_amount, 0),
    coalesce(pay.igst_amount, 0), coalesce(pay.tax_total, 0), pay.amount, pay.place_of_supply, false, pay.line_items
  ) returning * into inv;

  update care_partners set partner_code = v_code, marketing_partner_id = v_mp, fee_payment_id = pay.id, fee_invoice_id = inv.id,
         certified_at = now(), valid_until = (current_date + make_interval(months => sehat_care_setting_int('id_valid_months', 12)))::date,
         status = 'fee_paid', status_reason = null, status_changed_at = now(), updated_at = now()
   where id = p.id;
  return jsonb_build_object('partner_code', v_code, 'already', false, 'invoice_number', inv.invoice_number,
                            'invoice_token', inv.public_token, 'email', p.email, 'name', p.full_name);
end $$;
revoke all on function sehat_care_fee_paid(uuid) from public, anon, authenticated;
grant execute on function sehat_care_fee_paid(uuid) to service_role;

-- The partner's own fee invoice link (their dashboard).
create or replace function sehat_care_my_fee_invoice()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('invoice_number', i.invoice_number, 'invoice_token', i.public_token, 'total', i.total_amount, 'date', i.invoice_date)
    from care_partners p join invoices i on i.id = p.fee_invoice_id where p.user_id = auth.uid()
$$;
revoke all on function sehat_care_my_fee_invoice() from public, anon;
grant execute on function sehat_care_my_fee_invoice() to authenticated;

-- ── /verify/<Partner ID> (public) ───────────────────────────────────────────
create or replace function sehat_care_verify(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('partner_code', p.partner_code, 'full_name', p.full_name, 'city', p.city, 'state', p.state,
           'certified_at', p.certified_at, 'valid_until', p.valid_until,
           'status', case when p.status in ('fee_paid', 'active') and p.valid_until < current_date then 'expired'
                          when p.status = 'fee_paid' then 'certified' else p.status end)
    from care_partners p
   where p.partner_code = upper(btrim(coalesce(p_code, ''))) and p.partner_code is not null
$$;
revoke all on function sehat_care_verify(text) from public;
grant execute on function sehat_care_verify(text) to anon, authenticated;

-- ── Agreement acceptance ────────────────────────────────────────────────────
create table if not exists care_partner_acceptances (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references care_partners(id) on delete cascade,
  contract_id  uuid not null references care_partner_contracts(id) on delete restrict,
  accepted_at  timestamptz not null default now(),
  ip           text,
  user_agent   text,
  code_verified boolean not null default true,
  unique (partner_id, contract_id)
);
alter table care_partner_acceptances enable row level security;
revoke all on care_partner_acceptances from anon;
drop policy if exists care_partner_acceptances_read on care_partner_acceptances;
create policy care_partner_acceptances_read on care_partner_acceptances for select to authenticated
  using (sehat_is_admin() or exists (select 1 from care_partners p where p.id = partner_id and p.user_id = auth.uid()));

-- Current contracts this partner has not accepted yet.
create or replace function sehat_care_pending_contracts()
returns setof care_partner_contracts language sql stable security definer set search_path = public as $$
  select c.* from care_partner_contracts c
   where c.is_current
     and not exists (select 1 from care_partner_acceptances a join care_partners p on p.id = a.partner_id
                      where a.contract_id = c.id and p.user_id = auth.uid())
   order by case c.kind when 'partner_agreement' then 1 when 'code_of_conduct' then 2 when 'reward_policy' then 3
                        when 'fee_terms' then 4 else 5 end
$$;
revoke all on function sehat_care_pending_contracts() from public, anon;
grant execute on function sehat_care_pending_contracts() to authenticated;

-- Accept every pending current contract, confirmed by the WhatsApp code just
-- sent to the partner's own number (partner-otp 'request').
create or replace function sehat_care_accept(p_code text, p_user_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; lc care_partner_login_codes; v_ip text; v_n int := 0; c care_partner_contracts; v_ver text;
begin
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  if p.status not in ('fee_paid', 'active') then
    raise exception '%', case when p.status in ('paused', 'suspended', 'terminated') then 'Your account cannot do this right now.' else 'Get your Partner ID first.' end using errcode = 'P0001';
  end if;
  if not exists (select 1 from care_partner_contracts where kind = 'partner_agreement' and is_current) then
    raise exception 'The Partner Agreement is not published yet.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sehat_care_pending_contracts()) then raise exception 'Nothing left to accept.' using errcode = 'P0001'; end if;

  select * into lc from care_partner_login_codes where phone = p.phone and consumed_at is null order by created_at desc limit 1 for update;
  if lc.id is null or lc.expires_at < now() then raise exception 'That code has expired. Ask for a new one.' using errcode = 'P0001'; end if;
  if lc.attempts >= 5 then
    update care_partner_login_codes set consumed_at = now() where id = lc.id;
    raise exception 'Too many wrong tries. Ask for a new code.' using errcode = 'P0001';
  end if;
  if encode(sha256(convert_to(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'UTF8')), 'hex') <> lc.code_hash then
    update care_partner_login_codes set attempts = attempts + 1 where id = lc.id;
    raise exception 'That code is not right.' using errcode = 'P0001';
  end if;
  update care_partner_login_codes set consumed_at = now() where id = lc.id;

  begin v_ip := split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1); exception when others then v_ip := null; end;
  for c in select * from sehat_care_pending_contracts() loop
    insert into care_partner_acceptances (partner_id, contract_id, ip, user_agent) values (p.id, c.id, nullif(v_ip, ''), left(p_user_agent, 300))
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  select version into v_ver from care_partner_contracts where kind = 'partner_agreement' and is_current;
  update care_partners set agreement_version = v_ver, agreement_signed_at = now(), updated_at = now() where id = p.id;
  if p.status = 'fee_paid' then perform sehat_care_set_status(p.id, 'active'); end if;
  return jsonb_build_object('accepted', v_n, 'status', (select status from care_partners where id = p.id));
end $$;
revoke all on function sehat_care_accept(text, text) from public, anon;
grant execute on function sehat_care_accept(text, text) to authenticated;

-- ── Tickets ─────────────────────────────────────────────────────────────────
create table if not exists care_partner_tickets (
  id           uuid primary key default gen_random_uuid(),
  ticket_no    text not null unique default ('PT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  partner_id   uuid not null references care_partners(id) on delete cascade,
  category     text not null check (category in ('training', 'payment', 'technical', 'complaint', 'other')),
  subject      text not null,
  status       text not null default 'open' check (status in ('open', 'answered', 'closed')),
  priority     text not null default 'normal' check (priority in ('normal', 'high')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz
);
create table if not exists care_partner_ticket_messages (
  id          bigserial primary key,
  ticket_id   uuid not null references care_partner_tickets(id) on delete cascade,
  author      text not null check (author in ('partner', 'admin')),
  author_name text,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists care_partner_tickets_idx on care_partner_tickets (status, updated_at desc);
alter table care_partner_tickets enable row level security;
alter table care_partner_ticket_messages enable row level security;
revoke all on care_partner_tickets, care_partner_ticket_messages from anon;
drop policy if exists care_partner_tickets_read on care_partner_tickets;
create policy care_partner_tickets_read on care_partner_tickets for select to authenticated
  using (sehat_is_admin() or exists (select 1 from care_partners p where p.id = partner_id and p.user_id = auth.uid()));
drop policy if exists care_partner_ticket_messages_read on care_partner_ticket_messages;
create policy care_partner_ticket_messages_read on care_partner_ticket_messages for select to authenticated
  using (sehat_is_admin() or exists (select 1 from care_partner_tickets t join care_partners p on p.id = t.partner_id
                                      where t.id = ticket_id and p.user_id = auth.uid()));

create or replace function sehat_care_ticket_create(p_category text, p_subject text, p_body text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; v_id uuid;
begin
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_subject, ''))) < 3 or length(btrim(coalesce(p_body, ''))) < 5 then
    raise exception 'Please write a subject and describe the problem.' using errcode = '22023';
  end if;
  if (select count(*) from care_partner_tickets where partner_id = p.id and status <> 'closed') >= 5 then
    raise exception 'You already have 5 open tickets. Please wait for a reply.' using errcode = 'P0001';
  end if;
  insert into care_partner_tickets (partner_id, category, subject, priority)
  values (p.id, coalesce(nullif(p_category, ''), 'other'), left(btrim(p_subject), 150), case when p_category = 'complaint' then 'high' else 'normal' end)
  returning id into v_id;
  insert into care_partner_ticket_messages (ticket_id, author, author_name, body) values (v_id, 'partner', p.full_name, left(btrim(p_body), 4000));
  return v_id;
end $$;
revoke all on function sehat_care_ticket_create(text, text, text) from public, anon;
grant execute on function sehat_care_ticket_create(text, text, text) to authenticated;

create or replace function sehat_care_ticket_reply(p_ticket uuid, p_body text, p_close boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; t care_partner_tickets; v_admin boolean := sehat_is_admin(); v_name text;
begin
  select * into t from care_partner_tickets where id = p_ticket for update;
  if t.id is null then raise exception 'No such ticket.' using errcode = 'P0002'; end if;
  if not v_admin then
    p := sehat_care_me_row();
    if p.id is null or p.id <> t.partner_id then raise exception 'No such ticket.' using errcode = 'P0002'; end if;
  end if;
  if btrim(coalesce(p_body, '')) <> '' then
    if t.status = 'closed' and not v_admin then raise exception 'This ticket is closed. Open a new one.' using errcode = 'P0001'; end if;
    v_name := case when v_admin then 'Sehatsandhi' else p.full_name end;
    insert into care_partner_ticket_messages (ticket_id, author, author_name, body)
    values (t.id, case when v_admin then 'admin' else 'partner' end, v_name, left(btrim(p_body), 4000));
  end if;
  update care_partner_tickets set
    status = case when p_close then 'closed' when btrim(coalesce(p_body, '')) = '' then status when v_admin then 'answered' else 'open' end,
    closed_at = case when p_close then now() else closed_at end, updated_at = now()
   where id = t.id;
  if v_admin then
    perform sehat_log_staff_action(case when p_close then 'care_ticket_close' else 'care_ticket_reply' end, 'care_ticket', t.id, t.ticket_no, null);
  end if;
end $$;
revoke all on function sehat_care_ticket_reply(uuid, text, boolean) from public, anon;
grant execute on function sehat_care_ticket_reply(uuid, text, boolean) to authenticated;

create or replace function sehat_admin_care_tickets(p_status text default null)
returns table (id uuid, ticket_no text, partner_id uuid, partner_name text, partner_code text, partner_phone text,
               category text, subject text, status text, priority text, created_at timestamptz, updated_at timestamptz,
               last_author text, messages integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_care_admin_only();
  return query
    select t.id, t.ticket_no, p.id, p.full_name, p.partner_code, p.phone, t.category, t.subject, t.status, t.priority,
           t.created_at, t.updated_at,
           (select m.author from care_partner_ticket_messages m where m.ticket_id = t.id order by m.created_at desc limit 1),
           (select count(*)::int from care_partner_ticket_messages m where m.ticket_id = t.id)
      from care_partner_tickets t join care_partners p on p.id = t.partner_id
     where p_status is null or t.status = p_status
     order by (t.status = 'closed'), t.priority = 'high' desc, t.updated_at
     limit 500;
end $$;
revoke all on function sehat_admin_care_tickets(text) from public, anon;
grant execute on function sehat_admin_care_tickets(text) to authenticated;

-- ── Me and next step, now through certification ─────────────────────────────
create or replace function sehat_care_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p care_partners; v_phone text := sehat_care_my_phone();
begin
  if v_phone is null then return jsonb_build_object('signed_in', false); end if;
  p := sehat_care_me_row();
  return jsonb_build_object(
    'signed_in', true, 'phone', v_phone, 'registered', p.id is not null,
    'program_enabled', sehat_partner_program_enabled(),
    'partner', case when p.id is null then null else jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'city', p.city, 'state', p.state, 'language', p.language, 'email', p.email,
      'status', p.status, 'status_reason', p.status_reason, 'level', p.level, 'partner_code', p.partner_code,
      'certified_at', p.certified_at, 'valid_until', p.valid_until, 'agreement_signed_at', p.agreement_signed_at,
      'created_at', p.created_at) end,
    'pending_contracts', case when p.id is null then 0 else (select count(*) from sehat_care_pending_contracts()) end,
    'next', sehat_care_next_step(p));
end $$;
revoke all on function sehat_care_me() from public, anon;
grant execute on function sehat_care_me() to authenticated;

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
    return jsonb_build_object('key', 'active', 'path', '/partner/dashboard',
      'en', 'Your Partner ID is active. Adding doctors opens soon.', 'hi', 'आपका Partner ID चालू है। डॉक्टर जोड़ना जल्द शुरू होगा।');
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
