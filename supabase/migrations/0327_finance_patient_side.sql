-- ============================================================================
-- 0327 — Treatment on EMI: the patient asks (My Sehatsandhi + WhatsApp bot)
-- ============================================================================
-- AFTER 0326. Safe to re-run. Plan: docs/2026-11-finance-emi-phase1.md (step 3).
--
-- Two read functions; the request itself is 0326's sehat_finance_case_request.
--
--   sehat_finance_hospitals(q)  hospitals and clinics that offer EMI (active,
--                               opted in), optionally matched by name or town.
--                               Only public listing facts: name, town, address.
--   sehat_finance_my_cases()    the signed-in patient's own cases, matched by
--                               their verified phone, with the link to each.
--
-- Both refuse while the site switch finance_enabled is off (admins excepted),
-- like every other EMI function.
-- ============================================================================

create or replace function sehat_finance_hospitals(p_query text default null)
returns table (id uuid, name text, vertical text, town text, address text)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform sehat_finance_check_on();
  return query
    select b.id, b.name, b.vertical, coalesce(b.own_city, b.own_district) as town, b.address
      from businesses b
     where b.status = 'active' and b.vertical in ('clinic', 'hospital') and b.finance_module
       and (v_q is null
            or b.name ilike '%' || v_q || '%'
            or coalesce(b.own_city, '') ilike '%' || v_q || '%'
            or coalesce(b.own_district, '') ilike '%' || v_q || '%')
     order by (b.vertical = 'hospital') desc, b.name
     limit 30;
end $$;
revoke all on function sehat_finance_hospitals(text) from public, anon;
grant execute on function sehat_finance_hospitals(text) to authenticated, service_role;

create or replace function sehat_finance_my_cases()
returns table (case_no text, status text, treatment text, hospital text, requested_amount numeric,
               planned_on date, public_token text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_phone text;
begin
  perform sehat_finance_check_on();
  v_phone := sehat_my_phone();   -- raises 'Please sign in…' when not a patient login
  return query
    select c.case_no, c.status, c.treatment, b.name, c.requested_amount, c.planned_on, c.public_token, c.created_at, c.updated_at
      from finance_cases c join businesses b on b.id = c.business_id
     where right(regexp_replace(c.patient_phone, '\D', '', 'g'), 10) = right(regexp_replace(v_phone, '\D', '', 'g'), 10)
     order by c.updated_at desc
     limit 50;
end $$;
revoke all on function sehat_finance_my_cases() from public, anon;
grant execute on function sehat_finance_my_cases() to authenticated;
