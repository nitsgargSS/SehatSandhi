-- ============================================================================
-- 0337 — Care Partner Program: yearly renewal; the fee is ₹100 + GST
-- ============================================================================
-- AFTER 0336. Safe to re-run.
--
-- Nitin, 22 Nov 2026: "renewal fee is yearly, they need to retake quiz and
-- renew with the same 100 rs plus gst … to keep genuine partners and remove
-- not genuine partners." And the first fee is also ₹100 + GST.
--
--   Fee            partner_cert_fee is now the price BEFORE GST; GST is added
--                  on top (CGST+SGST in our state, IGST elsewhere) while
--                  tax_settings has GST on. Same for the first fee and renewal.
--   Renewal        opens partner_renew_window_days (30) before valid_until.
--                  Step 1: a refresher quiz (kind 'refresher', questions from
--                  every published module, partner_refresher_questions, same
--                  pass mark and retake waits). Step 2: pay the fee. The ID
--                  then runs 12 more months from the old expiry (or from today
--                  if it had already expired). Same Partner ID, new invoice.
--   Expired        valid_until passed: no reserving doctors, no attribution, no
--                  rewards on payments made while expired (0334/0335 already
--                  check valid_until); /verify shows "expired".
--   Removed        not renewed within partner_id_grace_days (30) after expiry:
--                  nightly job sets status 'terminated' ("Partner ID not
--                  renewed"). Rewards already approved are still paid.
-- ============================================================================

insert into site_settings (key, value) values
  ('partner_renew_window_days', '30'),
  ('partner_id_grace_days', '30'),
  ('partner_refresher_questions', '10')
on conflict (key) do nothing;

-- ── The fee with GST, for pages and the Help Center ({{cert_fee_total}}) ────
create or replace function sehat_care_fee_parts(p_state text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ts tax_settings; v_fee numeric(12,2) := sehat_care_setting_int('cert_fee', 100); v_rate numeric(5,2) := 0;
        v_tax numeric(12,2) := 0; v_state text := sehat_state_code_of(p_state);
begin
  select * into ts from tax_settings where id;
  if coalesce(ts.gst_enabled, false) and coalesce(ts.gstin, '') <> '' then
    v_rate := coalesce(ts.gst_rate, 18);
    v_tax := round(v_fee * v_rate / 100, 2);
  end if;
  return jsonb_build_object('fee', v_fee, 'gst_rate', v_rate, 'gst', v_tax, 'total', v_fee + v_tax,
                            'interstate', v_state is not null and v_state <> ts.state_code,
                            'place', coalesce(v_state, ts.state_code));
end $$;
revoke all on function sehat_care_fee_parts(text) from public, anon, authenticated;

create or replace function sehat_care_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(substr(key, 9), value), '{}'::jsonb)
           || jsonb_build_object('site', sehat_site_url(),
                'reward_window_days', (select value from site_settings where key = 'partner_refund_window_days'),
                'cert_fee_gst_rate', (sehat_care_fee_parts() ->> 'gst_rate'),
                'cert_fee_total', trim(to_char((sehat_care_fee_parts() ->> 'total')::numeric, 'FM999999990.##'), '.'))
    from site_settings where key like 'partner\_%' escape '\'
$$;
revoke all on function sehat_care_settings() from public;
grant execute on function sehat_care_settings() to anon, authenticated, service_role;

-- ── Where the partner stands with renewal ───────────────────────────────────
create or replace function sehat_care_renewal(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_window int := sehat_care_setting_int('renew_window_days', 30); v_grace int := sehat_care_setting_int('id_grace_days', 30);
        v_opens date; v_passed boolean;
begin
  if p.id is null or p.partner_code is null or p.valid_until is null or p.status not in ('fee_paid', 'active') then
    return jsonb_build_object('open', false);
  end if;
  v_opens := p.valid_until - v_window;
  v_passed := exists (select 1 from care_partner_attempts a where a.partner_id = p.id and a.kind = 'refresher' and a.passed
                        and a.submitted_at >= v_opens::timestamp at time zone 'Asia/Kolkata');
  return jsonb_build_object(
    'open', current_date >= v_opens and current_date <= p.valid_until + v_grace,
    'opens_on', v_opens, 'valid_until', p.valid_until, 'expired', p.valid_until < current_date,
    'last_day', p.valid_until + v_grace, 'refresher_passed', v_passed);
end $$;
revoke all on function sehat_care_renewal(care_partners) from public, anon, authenticated;

-- ── Refresher quiz ──────────────────────────────────────────────────────────
create or replace function sehat_care_refresher_start()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; r jsonb; a care_partner_attempts; v_wait timestamptz; v_ids uuid[]; v_orders jsonb := '{}'::jsonb; q record;
begin
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  r := sehat_care_renewal(p);
  if not coalesce((r ->> 'open')::boolean, false) then
    raise exception '%', case when r ? 'opens_on' and current_date < (r ->> 'opens_on')::date
                              then format('Renewal opens on %s.', to_char((r ->> 'opens_on')::date, 'DD Mon YYYY'))
                              else 'Renewal is not open for your account.' end using errcode = 'P0001';
  end if;
  if (r ->> 'refresher_passed')::boolean then raise exception 'You have already passed the refresher quiz. Pay the renewal fee next.' using errcode = 'P0001'; end if;

  v_wait := sehat_care_quiz_wait(p.id, 'refresher', null);
  if v_wait is not null then
    raise exception 'You can try again after %.', to_char(v_wait at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') using errcode = 'P0001';
  end if;
  select * into a from care_partner_attempts
   where partner_id = p.id and kind = 'refresher' and submitted_at is null and expires_at > now()
   order by started_at desc limit 1;
  if a.id is not null then return sehat_care_attempt_view(a); end if;

  select array_agg(id) into v_ids from (
    select qq.id from care_partner_questions qq
     where qq.is_active and (qq.module_id is null or qq.module_id in (select id from care_partner_modules where is_published))
     order by random() limit sehat_care_setting_int('refresher_questions', 10)) s;
  if v_ids is null then raise exception 'The refresher quiz has no questions yet.' using errcode = 'P0001'; end if;
  for q in select id, options from care_partner_questions where id = any(v_ids) loop
    v_orders := v_orders || jsonb_build_object(q.id::text,
      (select jsonb_agg(o->>'id' order by random()) from jsonb_array_elements(q.options) o));
  end loop;
  insert into care_partner_attempts (partner_id, module_id, kind, question_ids, option_orders, expires_at)
  values (p.id, null, 'refresher', v_ids, v_orders, now() + make_interval(mins => sehat_care_setting_int('attempt_minutes', 60)))
  returning * into a;
  return sehat_care_attempt_view(a);
end $$;
revoke all on function sehat_care_refresher_start() from public, anon;
grant execute on function sehat_care_refresher_start() to authenticated;

create or replace function sehat_care_quiz_state()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; v jsonb := '{}'::jsonb; m record; v_wait timestamptz;
begin
  p := sehat_care_me_row();
  if p.id is null then return v; end if;
  for m in select mm.id from care_partner_modules mm where mm.is_published loop
    v_wait := sehat_care_quiz_wait(p.id, 'module', m.id);
    v := v || jsonb_build_object(m.id::text, jsonb_build_object('wait_until', v_wait,
           'open', exists (select 1 from care_partner_attempts where partner_id = p.id and module_id = m.id and kind = 'module' and submitted_at is null and expires_at > now())));
  end loop;
  v_wait := sehat_care_quiz_wait(p.id, 'final', null);
  v := v || jsonb_build_object('final', jsonb_build_object('wait_until', v_wait, 'passed', p.status not in ('registered', 'learning'),
         'open', exists (select 1 from care_partner_attempts where partner_id = p.id and kind = 'final' and submitted_at is null and expires_at > now())));
  return v || jsonb_build_object('refresher', jsonb_build_object('wait_until', sehat_care_quiz_wait(p.id, 'refresher', null),
         'passed', coalesce((sehat_care_renewal(p) ->> 'refresher_passed')::boolean, false),
         'open', exists (select 1 from care_partner_attempts where partner_id = p.id and kind = 'refresher' and submitted_at is null and expires_at > now())));
end $$;
revoke all on function sehat_care_quiz_state() from public, anon;
grant execute on function sehat_care_quiz_state() to authenticated;

-- ── Fee: first certification or yearly renewal, GST on top ──────────────────
create or replace function sehat_care_fee_prepare()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; ts tax_settings; f jsonb; r jsonb; v_fee numeric(12,2); v_total numeric(12,2); v_tax numeric(12,2);
        v_cgst numeric(12,2) := 0; v_sgst numeric(12,2) := 0; v_igst numeric(12,2) := 0; v_id uuid; v_renew boolean := false; v_label text;
begin
  if not sehat_partner_program_enabled() then raise exception 'The Partner Program is not open.' using errcode = 'P0001'; end if;
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  if p.partner_code is not null then
    r := sehat_care_renewal(p);
    if not coalesce((r ->> 'open')::boolean, false) then raise exception 'Your Partner ID is already issued.' using errcode = 'P0001'; end if;
    if not (r ->> 'refresher_passed')::boolean then raise exception 'Pass the refresher quiz first.' using errcode = 'P0001'; end if;
    v_renew := true;
  elsif p.status <> 'quiz_passed' then
    raise exception 'Pass the final exam first.' using errcode = 'P0001';
  end if;

  f := sehat_care_fee_parts(p.state);
  v_fee := (f ->> 'fee')::numeric; v_tax := (f ->> 'gst')::numeric; v_total := (f ->> 'total')::numeric;
  if v_fee <= 0 then raise exception 'The certification fee is not set.' using errcode = 'P0001'; end if;
  if (f ->> 'interstate')::boolean then v_igst := v_tax; else v_cgst := round(v_tax / 2, 2); v_sgst := v_tax - v_cgst; end if;
  select * into ts from tax_settings where id;
  v_label := coalesce((select value from site_settings where key = 'partner_fee_description'), 'Care Partner certification')
             || case when v_renew then ' — yearly renewal' else '' end;

  insert into payments (type, care_partner_id, amount, status, taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount,
                        tax_total, place_of_supply, line_items)
  values ('partner_fee', p.id, v_total, 'pending', v_fee, (f ->> 'gst_rate')::numeric, v_cgst, v_sgst, v_igst, v_tax, f ->> 'place',
          jsonb_build_array(jsonb_build_object('label', v_label, 'amount', v_fee)))
  returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount', v_total, 'amount_paise', (v_total * 100)::bigint, 'renewal', v_renew,
                            'name', p.full_name, 'phone', p.phone, 'email', p.email);
end $$;
revoke all on function sehat_care_fee_prepare() from public, anon;
grant execute on function sehat_care_fee_prepare() to authenticated;

-- ── Fee paid: issue the ID, or renew it (service role, idempotent) ──────────
create or replace function sehat_care_fee_paid(p_payment uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare pay payments; p care_partners; ts tax_settings; inv invoices; v_code text; v_mp uuid; i int; v_renew boolean; v_until date;
        cs constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  select * into pay from payments where id = p_payment for update;
  if pay.id is null or pay.type <> 'partner_fee' or pay.status <> 'paid' then
    raise exception 'Not a paid partner fee.' using errcode = 'P0001';
  end if;
  select * into p from care_partners where id = pay.care_partner_id for update;
  if p.id is null then raise exception 'The partner for this payment is gone.' using errcode = 'P0002'; end if;

  -- Already handled (verify and webhook both arrive): return what exists.
  select * into inv from invoices where payment_id = pay.id limit 1;
  if inv.id is not null or (p.partner_code is not null and p.fee_payment_id = pay.id) then
    if inv.id is null then select * into inv from invoices where id = p.fee_invoice_id; end if;
    return jsonb_build_object('partner_code', p.partner_code, 'already', true, 'renewed', p.fee_payment_id <> pay.id,
                              'valid_until', p.valid_until, 'invoice_number', inv.invoice_number,
                              'invoice_token', inv.public_token, 'email', p.email, 'name', p.full_name);
  end if;
  v_renew := p.partner_code is not null;

  if not v_renew then
    loop
      v_code := 'SP-';
      for i in 1..6 loop v_code := v_code || substr(cs, 1 + floor(random() * length(cs))::int, 1); end loop;
      exit when not exists (select 1 from care_partners where partner_code = v_code)
            and not exists (select 1 from marketing_partners where code = v_code);
    end loop;
    insert into marketing_partners (name, code, kind, contact_name, phone, email, notes, active_from)
    values (p.full_name, v_code, 'care', p.full_name, p.phone, p.email, 'Care Partner (0333)', current_date)
    returning id into v_mp;
  end if;

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
    coalesce(pay.line_items -> 0 ->> 'label', (select value from site_settings where key = 'partner_fee_description'), 'Care Partner certification'),
    coalesce(pay.taxable_value, pay.amount), coalesce(pay.gst_rate, 0), coalesce(pay.cgst_amount, 0), coalesce(pay.sgst_amount, 0),
    coalesce(pay.igst_amount, 0), coalesce(pay.tax_total, 0), pay.amount, pay.place_of_supply, false, pay.line_items
  ) returning * into inv;

  if v_renew then
    v_until := (greatest(p.valid_until, current_date - 1) + make_interval(months => sehat_care_setting_int('id_valid_months', 12)))::date;
    update care_partners set valid_until = v_until, updated_at = now() where id = p.id;
    v_code := p.partner_code;
  else
    v_until := (current_date + make_interval(months => sehat_care_setting_int('id_valid_months', 12)))::date;
    update care_partners set partner_code = v_code, marketing_partner_id = v_mp, fee_payment_id = pay.id, fee_invoice_id = inv.id,
           certified_at = now(), valid_until = v_until,
           status = 'fee_paid', status_reason = null, status_changed_at = now(), updated_at = now()
     where id = p.id;
  end if;
  return jsonb_build_object('partner_code', v_code, 'already', false, 'renewed', v_renew, 'valid_until', v_until,
                            'invoice_number', inv.invoice_number, 'invoice_token', inv.public_token, 'email', p.email, 'name', p.full_name);
end $$;
revoke all on function sehat_care_fee_paid(uuid) from public, anon, authenticated;
grant execute on function sehat_care_fee_paid(uuid) to service_role;

-- The partner's fee invoices, newest first (first fee and renewals).
create or replace function sehat_care_my_fee_invoices()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('invoice_number', i.invoice_number, 'invoice_token', i.public_token,
                    'total', i.total_amount, 'date', i.invoice_date, 'renewal', pay.id <> p.fee_payment_id) order by i.invoice_date desc, i.created_at desc), '[]'::jsonb)
    from care_partners p join payments pay on pay.care_partner_id = p.id and pay.type = 'partner_fee' and pay.status = 'paid'
    join invoices i on i.payment_id = pay.id
   where p.user_id = auth.uid()
$$;
revoke all on function sehat_care_my_fee_invoices() from public, anon;
grant execute on function sehat_care_my_fee_invoices() to authenticated;

-- ── Me: with the renewal state ──────────────────────────────────────────────
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
    'renewal', sehat_care_renewal(p),
    'pending_contracts', case when p.id is null then 0 else (select count(*) from sehat_care_pending_contracts()) end,
    'next', sehat_care_next_step(p));
end $$;
revoke all on function sehat_care_me() from public, anon;
grant execute on function sehat_care_me() to authenticated;

-- ── Next step: renewal comes first once the ID has expired ──────────────────
create or replace function sehat_care_next_step(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_done int; v_next care_partner_modules; v_np care_partner_progress; v_pending int; r jsonb; v_fee text;
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
    r := sehat_care_renewal(p);
    v_fee := '₹' || sehat_care_setting_int('cert_fee', 100) || ' + GST';
    if coalesce((r ->> 'expired')::boolean, false) then
      return jsonb_build_object('key', 'renew', 'path', '/partner/renew',
        'en', format('Your Partner ID expired on %s. Renew by %s — pass the refresher quiz and pay %s — or your partnership ends.',
                     to_char(p.valid_until, 'DD Mon YYYY'), to_char((r ->> 'last_day')::date, 'DD Mon YYYY'), v_fee),
        'hi', format('आपका Partner ID %s को खत्म हो गया। %s तक रिन्यू करें — रिफ़्रेशर क्विज़ पास करें और %s दें — नहीं तो साझेदारी समाप्त हो जाएगी।',
                     to_char(p.valid_until, 'DD Mon YYYY'), to_char((r ->> 'last_day')::date, 'DD Mon YYYY'), v_fee));
    end if;
    v_pending := (select count(*) from care_partner_contracts c where c.is_current
                   and not exists (select 1 from care_partner_acceptances a where a.contract_id = c.id and a.partner_id = p.id));
    if p.status = 'fee_paid' or v_pending > 0 then
      return jsonb_build_object('key', 'agreement', 'path', '/partner/agreement',
        'en', case when p.status = 'fee_paid' then 'Read and accept the Partner Agreement to activate your Partner ID.'
                   else 'An updated agreement or policy needs your acceptance.' end,
        'hi', case when p.status = 'fee_paid' then 'अपना Partner ID चालू करने के लिए पार्टनर एग्रीमेंट पढ़ें और स्वीकार करें।'
                   else 'एक नया एग्रीमेंट या नीति आपकी स्वीकृति के लिए है।' end);
    end if;
    if coalesce((r ->> 'open')::boolean, false) then
      return jsonb_build_object('key', 'renew', 'path', '/partner/renew',
        'en', format('Your Partner ID is valid until %s. Renew now: pass the refresher quiz and pay %s.', to_char(p.valid_until, 'DD Mon YYYY'), v_fee),
        'hi', format('आपका Partner ID %s तक मान्य है। अभी रिन्यू करें: रिफ़्रेशर क्विज़ पास करें और %s दें।', to_char(p.valid_until, 'DD Mon YYYY'), v_fee));
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
    if coalesce(sehat_care_module_ready(v_next, v_np), false) then
      return jsonb_build_object('key', 'module_quiz', 'path', '/partner/quiz/' || v_next.slug, 'done', v_done, 'total', v_total,
        'en', format('Next: the quiz for "%s".', v_next.title_en), 'hi', format('अगला: "%s" का क्विज़।', v_next.title_hi));
    end if;
    return jsonb_build_object('key', 'module', 'path', '/partner/learn#' || v_next.slug, 'done', v_done, 'total', v_total,
      'en', case when coalesce(v_next.youtube_id_hi, v_next.youtube_id_en) is null
                 then format('Next: %s — read the PDF.', v_next.title_en)
                 else format('Next: %s — watch the video and read the PDF.', v_next.title_en) end,
      'hi', case when coalesce(v_next.youtube_id_hi, v_next.youtube_id_en) is null
                 then format('अगला: %s — PDF पढ़ें।', v_next.title_hi)
                 else format('अगला: %s — वीडियो देखें और PDF पढ़ें।', v_next.title_hi) end);
  end if;
  if v_total > 0 then
    return jsonb_build_object('key', 'final', 'path', '/partner/exam', 'done', v_done, 'total', v_total,
      'en', 'All modules done. Take the final exam.', 'hi', 'सभी मॉड्यूल पूरे। फ़ाइनल परीक्षा दें।');
  end if;
  return jsonb_build_object('key', 'waiting', 'path', '/partner/learn',
    'en', 'The modules are being prepared. Please check back soon.', 'hi', 'मॉड्यूल तैयार हो रहे हैं। कृपया जल्द फिर देखें।');
end $$;
revoke all on function sehat_care_next_step(care_partners) from public, anon, authenticated;

-- ── Nightly: end partnerships not renewed within the grace days ─────────────
create or replace function sehat_care_renewals_nightly()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  update care_partners set status = 'terminated', status_reason = 'Partner ID not renewed.', status_changed_at = now(), updated_at = now()
   where partner_code is not null and status in ('fee_paid', 'active', 'paused')
     and valid_until is not null and valid_until + sehat_care_setting_int('id_grace_days', 30) < current_date;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ended', v_n);
end $$;
revoke all on function sehat_care_renewals_nightly() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'care-renewals-nightly';
    perform cron.schedule('care-renewals-nightly', '40 21 * * *', 'select sehat_care_renewals_nightly()');   -- 03:10 IST
  end if;
end $$;

-- ── Help Center: the fee and renewal answers ────────────────────────────────
update care_partner_faq set
  answer_en = 'Training and the exam are free. After you pass the exam there is a Partner Certification Fee of Rs {{cert_fee}} + GST (Rs {{cert_fee_total}} in all) for your Partner ID and badge, valid for 12 months. It is non-refundable once the ID is issued. Details: {{site}}/partner/pay',
  answer_hi = 'ट्रेनिंग और परीक्षा मुफ़्त हैं। परीक्षा पास करने के बाद आपके पार्टनर ID और बैज के लिए ₹{{cert_fee}} + GST (कुल ₹{{cert_fee_total}}) की पार्टनर सर्टिफ़िकेशन फ़ीस है, जो 12 महीने के लिए मान्य है। ID जारी होने के बाद यह वापस नहीं होती। विवरण: {{site}}/partner/pay'
 where id = 'fee';
update care_partner_faq set
  answer_en = 'Your Partner ID is valid for 12 months. From {{renew_window_days}} days before it ends, renew it in the app: pass a short refresher quiz, then pay Rs {{cert_fee}} + GST (Rs {{cert_fee_total}}). If it is not renewed within {{id_grace_days}} days after it ends, your partnership ends. This keeps every Partner ID current and genuine. {{site}}/partner/renew',
  answer_hi = 'आपका पार्टनर ID 12 महीने के लिए मान्य है। खत्म होने से {{renew_window_days}} दिन पहले से ऐप में रिन्यू करें: एक छोटी रिफ़्रेशर क्विज़ पास करें, फिर ₹{{cert_fee}} + GST (₹{{cert_fee_total}}) दें। खत्म होने के {{id_grace_days}} दिन के अंदर रिन्यू न होने पर साझेदारी समाप्त हो जाती है। इससे हर पार्टनर ID सही और असली रहता है। {{site}}/partner/renew',
  link_path = '/partner/renew'
 where id = 'renewal';

notify pgrst, 'reload schema';
