-- ============================================================================
-- Sehatsandhi — insurance: reports with reasons and deadlines; WhatsApp to
--               the people whose leads an advisor accepted
--
-- Run AFTER 0194. Safe to re-run.
--
-- Decided 4 Oct 2026 with the clinic:
--
-- 1. A LEAD THAT DID NOT CONVERT IS NOT A BAD LEAD. A report needs one of four
--    reasons — wrong or switched-off number, never asked for insurance, a lead
--    the advisor already has, not health insurance / not their area. Wrong
--    number and duplicate within 48 hours of accepting (plain at the first
--    call); the other two within 72. The record decides where it can:
--      • duplicate — refunded at once if the same number came to this advisor
--        in the 90 days before; rejected if not;
--      • wrong number — rejected if the advisor marked that they spoke to them,
--        or the person rated them;
--      • never asked — rejected if the person rated them or says they bought.
--    The rest wait for a Sehatsandhi admin, who now sees each advisor's report
--    rate (sehat_admin_advisor_report_rates; 20%+ of 5 or more leads is flagged).
--
-- 2. WHATSAPP FOR ADVISORS (₹500 a month, as for clinics — vertical_term_prices).
--    Their audience is the people whose leads they accepted in the last 90
--    days, minus anyone who sent STOP: those people asked to be contacted
--    about cover. Broadcasts still go through Sehatsandhi's approval (0155).
--    whatsapp-addon-order sells it to a listing with no paid term (advisors
--    list free) as a month on its own.
-- ============================================================================

create or replace function sehat_il_resolve(p_lead uuid, p_refund boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare l insurance_leads; v_bal integer;
begin
  select * into l from insurance_leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
  if l.fee_refunded then raise exception 'Already refunded.' using errcode = 'P0001'; end if;
  if p_refund then
    if coalesce(l.fee_paise, 0) > 0 and l.agent_business_id is not null then
      insert into business_wallets (business_id) values (l.agent_business_id) on conflict do nothing;
      update business_wallets set balance_paise = balance_paise + l.fee_paise, updated_at = now()
       where business_id = l.agent_business_id returning balance_paise into v_bal;
      insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, lead_id, note, created_by)
      values (l.agent_business_id, 'refund', l.fee_paise, v_bal, l.id, 'Lead fee refunded — ' || l.code, 'Sehatsandhi');
    end if;
    update insurance_leads set fee_refunded = true, dispute_resolution = 'refunded' || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
           status = case when status = 'disputed' then 'lost' else status end, updated_at = now() where id = l.id;
    perform sehat_il_log(l.id, l.agent_business_id, 'refunded', p_note, 'Sehatsandhi');
    return 'refunded';
  end if;
  update insurance_leads set dispute_resolution = 'rejected' || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
         status = case when status = 'disputed' then 'contacted' else status end, updated_at = now() where id = l.id;
  perform sehat_il_log(l.id, l.agent_business_id, 'dispute_rejected', p_note, 'Sehatsandhi');
  return 'rejected';
end $$;
revoke all on function sehat_il_resolve(uuid, boolean, text) from public, anon, authenticated;

create or replace function sehat_admin_resolve_lead(p_lead uuid, p_refund boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Only a Sehatsandhi admin can do this.' using errcode = '42501'; end if;
  return sehat_il_resolve(p_lead, p_refund, p_note);
end $$;

create or replace function sehat_il_act(
  p_business uuid, p_lead uuid, p_action text,
  p_note text default null, p_insurer text default null, p_plan text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := sehat_il_role(p_business);
  v_name text := sehat_mo_actor_name(p_business);
  v_fee integer := sehat_lead_fee() * 100;
  v_bal integer;
  b businesses;
  l insurance_leads;
  v_reason text; v_detail text; v_auto text; v_window interval;
begin
  select * into b from businesses where id = p_business;
  select * into l from insurance_leads where id = p_lead for update;
  if l.id is null or l.code is null then raise exception 'Lead not found.' using errcode = 'P0002'; end if;

  if p_action = 'accept' then
    if l.status <> 'open' then
      raise exception '%', case when l.agent_business_id is not null then 'Another advisor has already taken this lead.' else 'This lead is no longer open.' end using errcode = 'P0001';
    end if;
    if nullif(btrim(coalesce(b.reg_number, '')), '') is null then
      raise exception 'Add your IRDAI licence or POSP code to your listing (Business tab) before accepting leads.' using errcode = 'P0001';
    end if;
    if p_business not in (select sehat_il_advisors(l.pincode))
       or exists (select 1 from insurance_lead_declines d where d.lead_id = l.id and d.business_id = p_business) then
      raise exception 'This lead is not offered to you.' using errcode = '42501';
    end if;
    -- Pay first, from the wallet; not enough, no lead.
    if v_fee > 0 then
      insert into business_wallets (business_id) values (p_business) on conflict do nothing;
      select balance_paise into v_bal from business_wallets where business_id = p_business for update;
      if v_bal < v_fee then
        raise exception 'Your wallet has ₹% — a lead costs ₹%. Top up to accept.', round(v_bal / 100.0), v_fee / 100 using errcode = 'P0001';
      end if;
      update business_wallets set balance_paise = balance_paise - v_fee, updated_at = now() where business_id = p_business;
      insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, lead_id, note, created_by)
      values (p_business, 'lead_fee', -v_fee, v_bal - v_fee, l.id, 'Insurance lead ' || l.code, v_name);
    end if;
    update insurance_leads set status = 'accepted', agent_business_id = p_business, accepted_at = now(), accepted_by_name = v_name,
           fee_paise = v_fee, updated_at = now() where id = l.id;
    perform sehat_il_log(l.id, p_business, 'accepted', case when v_fee > 0 then 'fee ₹' || v_fee / 100 end);
    perform sehat_il_wa(l.id, b.name || ' (IRDAI ' || btrim(b.reg_number) || ') आपको जल्द कॉल करेंगे। / will call you shortly.' || coalesce(' ☎ ' || b.phone, '') || E'\n' || sehat_il_url(l.token));

  elsif p_action = 'decline' then
    if l.status <> 'open' then raise exception 'This lead is no longer open.' using errcode = 'P0001'; end if;
    insert into insurance_lead_declines (lead_id, business_id) values (l.id, p_business) on conflict do nothing;
    perform sehat_il_log(l.id, p_business, 'declined', left(p_note, 200));

  elsif p_action in ('contacted', 'won', 'lost', 'dispute') then
    if l.agent_business_id is distinct from p_business then raise exception 'This lead is not yours.' using errcode = '42501'; end if;
    if p_action = 'contacted' then
      if l.status not in ('accepted', 'contacted') then raise exception 'This lead is closed.' using errcode = 'P0001'; end if;
      update insurance_leads set status = 'contacted', contacted_at = coalesce(contacted_at, now()), updated_at = now() where id = l.id;
      perform sehat_il_log(l.id, p_business, 'contacted', left(p_note, 300));
    elsif p_action = 'won' then
      if l.status not in ('accepted', 'contacted') then raise exception 'This lead is closed.' using errcode = 'P0001'; end if;
      if nullif(btrim(coalesce(p_insurer, '')), '') is null then raise exception 'Enter the insurer.' using errcode = '22023'; end if;
      update insurance_leads set status = 'won', contacted_at = coalesce(contacted_at, now()), outcome_at = now(),
             insurer = btrim(left(p_insurer, 80)), plan_name = nullif(btrim(left(coalesce(p_plan, ''), 120)), ''), updated_at = now() where id = l.id;
      perform sehat_il_log(l.id, p_business, 'won', btrim(left(p_insurer, 80)) || coalesce(' · ' || nullif(btrim(p_plan), ''), ''));
      perform sehat_il_wa(l.id, 'आपके बीमा सलाहकार के अनुभव को रेटिंग दें / Please rate your insurance advisor:' || E'\n' || sehat_il_url(l.token));
    elsif p_action = 'lost' then
      if l.status not in ('accepted', 'contacted') then raise exception 'This lead is closed.' using errcode = 'P0001'; end if;
      update insurance_leads set status = 'lost', outcome_at = now(), lost_reason = nullif(btrim(left(coalesce(p_note, ''), 200)), ''), updated_at = now() where id = l.id;
      perform sehat_il_log(l.id, p_business, 'lost', left(p_note, 200));
    else
      -- 0195: a report needs one of four reasons. A lead that was genuine but
      -- did not convert (not interested, bought elsewhere, too costly) is the
      -- advisor's normal risk and cannot be reported.
      if l.status not in ('accepted', 'contacted') then raise exception 'Only a lead in hand can be reported.' using errcode = 'P0001'; end if;
      v_reason := lower(btrim(split_part(coalesce(p_note, ''), ':', 1)));
      v_detail := nullif(btrim(substr(coalesce(p_note, ''), length(split_part(coalesce(p_note, ''), ':', 1)) + 2)), '');
      if v_reason not in ('wrong_number', 'never_asked', 'duplicate', 'not_health_or_area') then
        raise exception 'Choose why: wrong or switched-off number, never asked for insurance, a lead you already have, or not health insurance / not your area. A lead that did not convert cannot be reported.' using errcode = '22023';
      end if;
      -- Wrong number and duplicate are plain at the first call: 48 hours. The others: 72.
      v_window := case when v_reason in ('wrong_number', 'duplicate') then interval '48 hours' else interval '72 hours' end;
      if l.accepted_at < now() - v_window then
        raise exception '%', case when v_reason in ('wrong_number', 'duplicate')
          then 'A wrong number or a duplicate must be reported within 48 hours of accepting.'
          else 'This must be reported within 72 hours of accepting.' end using errcode = 'P0001';
      end if;
      update insurance_leads set status = 'disputed', disputed_at = now(),
             dispute_reason = v_reason || coalesce(': ' || left(v_detail, 280), ''), updated_at = now() where id = l.id;
      perform sehat_il_log(l.id, p_business, 'disputed', v_reason || coalesce(': ' || left(v_detail, 280), ''));
      -- Decided at once where the record already answers it.
      v_auto := case
        when v_reason = 'duplicate' and exists (
               select 1 from insurance_leads x where x.agent_business_id = p_business and x.id <> l.id
                  and x.patient_phone = l.patient_phone and x.accepted_at < l.accepted_at and x.accepted_at > l.accepted_at - interval '90 days')
          then 'refund'
        when v_reason = 'duplicate' then 'reject: no earlier lead from this number with you'
        when v_reason = 'wrong_number' and l.contacted_at is not null then 'reject: you marked that you spoke to them'
        when v_reason in ('wrong_number', 'never_asked') and l.rating is not null then 'reject: the person rated you after the call'
        when v_reason = 'never_asked' and l.patient_bought then 'reject: the person says they bought a policy'
      end;
      if v_auto is not null then
        perform sehat_il_resolve(l.id, v_auto = 'refund', case when v_auto = 'refund' then 'automatic: an earlier lead from the same number' else 'automatic — ' || substr(v_auto, 9) end);
      end if;
    end if;
  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;

  select * into l from insurance_leads where id = p_lead;
  return sehat_il_row(l, p_business);
end $$;

create or replace function sehat_marketing_audience(p_business uuid, p_pins text[] default null)
returns table (patient_member_id uuid, full_name text, phone text, pin_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()
          or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the clinic''s owner or manager can do this.' using errcode = '42501';
  end if;
  return query
  select distinct on (x.phone) x.member, x.name, x.phone, x.pin from (
    select m.id as member, m.full_name as name, p.phone, p.pin_code as pin, 0 as pri, m.is_self as self_first
      from business_patients bp
      join patient_members m on m.id = bp.patient_member_id
      join patients p on p.id = m.patient_id
     where bp.business_id = p_business
       and bp.status = 'active'
       and coalesce(m.status, 'active') = 'active'
       and p.phone ~ '^91[6-9][0-9]{9}$'
       and sehat_has_consent(m.id, 'marketing', p_business)
    union all
    -- 0195: an insurance advisor reaches the people whose leads they accepted
    -- in the last 90 days — they asked to be contacted about cover.
    select null::uuid, l.patient_name, l.patient_phone, l.pincode, 1, true
      from insurance_leads l
     where l.agent_business_id = p_business and l.code is not null
       and l.status in ('accepted', 'contacted', 'won', 'lost')
       and l.accepted_at > now() - interval '90 days'
       and l.patient_phone ~ '^91[6-9][0-9]{9}$'
  ) x
   where not exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(x.phone))
     and (p_pins is null or cardinality(p_pins) = 0 or x.pin = any(p_pins))
   order by x.phone, x.pri, x.self_first desc nulls last, x.name;
end $$;

create or replace function sehat_admin_advisor_report_rates(p_days integer default 30)
returns table (business_id uuid, advisor text, accepted integer, reported integer, refunded integer, rejected integer,
               report_rate numeric, flagged boolean)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, s.accepted, s.reported, s.refunded, s.rejected,
         round(case when s.accepted > 0 then s.reported::numeric / s.accepted else 0 end, 2),
         s.accepted >= 5 and s.reported::numeric / greatest(s.accepted, 1) >= 0.2
    from businesses b
    join lateral (
      select count(*)::integer accepted,
             count(*) filter (where l.disputed_at is not null)::integer reported,
             count(*) filter (where l.fee_refunded)::integer refunded,
             count(*) filter (where l.dispute_resolution like 'rejected%')::integer rejected
        from insurance_leads l
       where l.agent_business_id = b.id and l.accepted_at > now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
    ) s on true
   where sehat_is_staff() and b.vertical = 'insurance' and s.accepted > 0
   order by 8 desc, 7 desc, 2;
$$;
revoke all on function sehat_admin_advisor_report_rates(integer) from public, anon;
grant execute on function sehat_admin_advisor_report_rates(integer) to authenticated;

notify pgrst, 'reload schema';
