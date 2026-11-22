-- ============================================================================
-- 0340 — 1 month is the paid trial; no 6-month term; partners see trial → yearly
-- ============================================================================
-- AFTER 0339. Safe to re-run.
--
-- Nitin, 22 Nov 2026: "1 month is paid trial, better we remove 6 months plan
-- from page, partner will get paid once doctor registers for 12 months, but
-- with the 1-month plan the Partner ID can be added too, so the partner can
-- keep track of the doctor and move them to the 12-month plan."
--
--   Terms      the 6-month row of every type's price list is switched off
--              (is_enabled = false), so the wizard, the Plan tab and renewals
--              offer 1 month (labelled as the paid trial) and 12 months. The
--              rows stay: an admin can switch one back on, and old 6-month
--              payments keep their history.
--   Partner ID already accepted on any paid term at sign-up (0334); nothing
--              to change there. Rewards stay on 12-month payments only (0335).
--   Partners   their Businesses list now says where each one is: on the paid
--              trial (until when), on the yearly plan (until when), plan
--              ended, or not paid yet — so they know whom to follow up.
-- ============================================================================

update vertical_term_prices set is_enabled = false, updated_at = now()
 where months = 6 and is_enabled;
update vertical_term_prices set label = 'Paid trial (1 month)', updated_at = now()
 where months = 1 and coalesce(label, '') in ('', 'Monthly');
update vertical_term_prices set label = 'Yearly (12 months)', updated_at = now()
 where months = 12 and coalesce(label, '') in ('', 'Yearly');

create or replace function sehat_care_business_plan(p_business uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when x.id is null then jsonb_build_object('plan', 'not_paid')
    when x.term_end < current_date then jsonb_build_object('plan', 'ended', 'until', x.term_end, 'months', x.period_months)
    when coalesce(x.period_months, 1) >= 12 then jsonb_build_object('plan', 'yearly', 'until', x.term_end, 'months', x.period_months)
    else jsonb_build_object('plan', 'trial', 'until', x.term_end, 'months', x.period_months) end
  from (select null::int) d
  left join lateral (
    select pay.id, pay.term_end, pay.period_months from payments pay
     where pay.business_id = p_business and pay.status = 'paid' and pay.type in ('listing', 'subscription')
       and coalesce(pay.subscription_amount, 1) > 0
     order by pay.term_end desc nulls last, pay.created_at desc limit 1) x on true
$$;
revoke all on function sehat_care_business_plan(uuid) from public, anon, authenticated;

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
    -- Businesses credited to this partner: name, city, and where their plan stands. Nothing else (brief §10).
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'city', coalesce(b.own_city, b.own_district),
        'since', c.care_answered_at, 'paying', exists (select 1 from payments pay where pay.business_id = b.id and pay.status = 'paid'))
        || sehat_care_business_plan(b.id)
        order by c.care_answered_at desc nulls last)
      from business_partner_credits c join businesses b on b.id = c.business_id
      where c.partner_id = p.marketing_partner_id and c.status = 'approved'), '[]'::jsonb));
end $$;
revoke all on function sehat_care_leads() from public, anon;
grant execute on function sehat_care_leads() to authenticated;

notify pgrst, 'reload schema';
