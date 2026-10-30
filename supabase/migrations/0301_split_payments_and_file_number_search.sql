-- ============================================================================
-- 0301 — A bill paid two ways, and a patient found by part of the file number
-- ============================================================================
-- AFTER 0300. Safe to re-run.
--
-- Reported 30 Oct 2026 from the pharmacy counter:
--
-- 1. A patient paid half by net banking and half in cash. The new bill took
--    one payment, so the second half could only be added afterwards from the
--    bill. The pharmacy bill and the counter invoice now take any number of
--    payments in one step. Each is written as its own payment row, so the
--    day's collections still show every method and who took it.
--    The two original functions are unchanged: the *_split versions call
--    them, then record the rest, in the same transaction — if the payments
--    come to more than the bill, nothing is saved.
--
-- 2. Staff type the file (MRD) number they see on the patient's card, often
--    only its number part ("1023" for "SN-1023"). Only the whole number
--    matched, and a number on its own was taken for a phone search. Part of
--    a file number now matches too, and those patients come first.
-- ============================================================================

-- ── 1a. Pharmacy bill ───────────────────────────────────────────────────────
-- p_payments: [{amount, method, reference}], empty or null for credit.
create or replace function sehat_pharmacy_issue_bill_split(
  p_business uuid,
  p_lines jsonb,
  p_patient_member_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_prescription_id uuid default null,
  p_discount_pct numeric default 0,
  p_discount_reason text default null,
  p_payments jsonb default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_bill uuid;
  v_net numeric;
  v_total numeric := 0;
  p jsonb;
  v_amt numeric;
begin
  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payments must be a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) > 6 then
    raise exception 'A bill takes up to 6 payments.' using errcode = '22023';
  end if;

  v_bill := sehat_pharmacy_issue_bill(p_business, p_lines, p_patient_member_id, p_customer_name, p_customer_phone,
                                      p_prescription_id, p_discount_pct, p_discount_reason, null);
  select net_payable into v_net from pharmacy_bills where id = v_bill;

  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_amt := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2);
    continue when v_amt = 0;
    if v_amt < 0 then raise exception 'A payment cannot be below zero.' using errcode = '22023'; end if;
    v_total := v_total + v_amt;
    if v_total > v_net then
      raise exception 'The payments come to more than the bill (₹%).', v_net using errcode = '22023';
    end if;
    insert into pharmacy_payments (business_id, bill_id, amount, method, reference, received_by, received_by_name)
    values (p_business, v_bill, v_amt, coalesce(nullif(p->>'method', ''), 'cash'),
            nullif(btrim(coalesce(p->>'reference', '')), ''), auth.uid(), sehat_pharmacy_staff_name(p_business));
  end loop;

  return v_bill;
end $$;
revoke all on function sehat_pharmacy_issue_bill_split(uuid, jsonb, uuid, text, text, uuid, numeric, text, jsonb) from public, anon;
grant execute on function sehat_pharmacy_issue_bill_split(uuid, jsonb, uuid, text, text, uuid, numeric, text, jsonb) to authenticated;

-- ── 1b. Counter invoice (0225) ──────────────────────────────────────────────
create or replace function sehat_counter_invoice_split(
  p_business uuid, p_member uuid, p_lines jsonb,
  p_charge_ids uuid[] default '{}',
  p_discount numeric default 0, p_discount_reason text default null, p_round_off numeric default 0,
  p_payments jsonb default null,
  p_recorded_by uuid default null, p_doctor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_net numeric;
  v_total numeric := 0;
  v_first jsonb;
  p jsonb;
  v_amt numeric;
  i integer := 0;
begin
  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payments must be a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) > 6 then
    raise exception 'An invoice takes up to 6 payments.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) e
              where coalesce(nullif(e->>'amount', '')::numeric, 0) < 0) then
    raise exception 'A payment cannot be below zero.' using errcode = '22023';
  end if;
  -- The first payment above zero goes through the original, which writes it
  -- exactly as before; the rest follow it onto the same bill.
  select e into v_first from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) e
   where coalesce(nullif(e->>'amount', '')::numeric, 0) > 0 limit 1;

  r := sehat_counter_invoice(p_business, p_member, p_lines, p_charge_ids, p_discount, p_discount_reason, p_round_off,
                             coalesce(round(nullif(v_first->>'amount', '')::numeric, 2), 0),
                             coalesce(nullif(v_first->>'method', ''), 'cash'), v_first->>'reference',
                             p_recorded_by, p_doctor);
  v_net := (r->>'net')::numeric;
  v_total := coalesce((r->>'paid')::numeric, 0);

  for p in select e from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) e
            where coalesce(nullif(e->>'amount', '')::numeric, 0) > 0 loop
    i := i + 1;
    continue when i = 1;   -- written by the original above
    v_amt := round((p->>'amount')::numeric, 2);
    v_total := v_total + v_amt;
    if v_total > v_net then
      raise exception 'The payments come to more than the invoice (₹%).', v_net using errcode = '22023';
    end if;
    insert into patient_payments (business_id, patient_member_id, amount, method, reference, bill_id, recorded_by)
    values (p_business, p_member, v_amt, coalesce(nullif(p->>'method', ''), 'cash'),
            nullif(btrim(coalesce(p->>'reference', '')), ''), (r->>'bill_id')::uuid, p_recorded_by);
  end loop;

  return r || jsonb_build_object('paid', v_total);
end $$;
revoke all on function sehat_counter_invoice_split(uuid, uuid, jsonb, uuid[], numeric, text, numeric, jsonb, uuid, uuid) from public, anon;
grant execute on function sehat_counter_invoice_split(uuid, uuid, jsonb, uuid[], numeric, text, numeric, jsonb, uuid, uuid) to authenticated;

-- ── 2. Patient search (0267, file number part added) ────────────────────────
create or replace function sehat_search_patients(p_query text, p_business uuid default null)
returns table (
  patient_member_id uuid, business_id uuid, full_name text, relation text,
  phone text, age_years integer, gender text, mrn text,
  last_seen_at timestamptz, visit_count integer, also_known_as text
)
language sql stable security definer set search_path = public as $$
  with q as (select btrim(coalesce(p_query, '')) as raw,
                    regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g') as digits,
                    sehat_name_words(p_query) as words)
  select m.id, bp.business_id, m.full_name, m.relation,
         p.phone, m.age_years, m.gender, bp.mrn,
         bp.last_seen_at, bp.visit_count, m.also_known_as
    from business_patients bp
    join patient_members m on m.id = bp.patient_member_id
    join patients p on p.id = m.patient_id
   cross join q
   where bp.business_id in (select sehat_caller_business_ids())
     and (p_business is null or bp.business_id = p_business)
     and m.status = 'active'
     and length(q.raw) >= 2
     and (
       m.full_name ilike '%' || q.raw || '%'
       -- 0266: any word, in any order, titles and dots ignored.
       or (length(q.digits) = 0 and sehat_name_matches(m.full_name, q.raw))
       -- 0267: the other name — a maiden name, a nickname.
       or (m.also_known_as is not null and length(q.digits) = 0
           and (m.also_known_as ilike '%' || q.raw || '%' or sehat_name_matches(m.also_known_as, q.raw)))
       -- 0193: only a query with digits in it is a phone search.
       or (length(q.digits) >= 3 and p.phone like '%' || q.digits || '%')
       or (length(q.digits) >= 3 and exists (select 1 from patient_phones x where x.patient_member_id = m.id and x.phone like '%' || q.digits || '%'))
       -- 0301: the file number, whole or in part ("1023" finds SN-1023).
       or upper(coalesce(bp.mrn, '')) = upper(q.raw)
       or (bp.mrn is not null and upper(bp.mrn) like '%' || upper(q.raw) || '%')
       or (length(q.digits) >= 1 and q.digits = q.raw and regexp_replace(coalesce(bp.mrn, ''), '[^0-9]', '', 'g') like '%' || q.digits || '%')
     )
   order by
     (upper(coalesce(bp.mrn, '')) = upper(q.raw)) desc,
     (q.digits = q.raw and length(q.digits) > 0
        and regexp_replace(coalesce(bp.mrn, ''), '[^0-9]', '', 'g') like q.digits || '%') desc,
     ((sehat_name_words(m.full_name))[1] like coalesce(q.words[1], '') || '%') desc,
     bp.last_seen_at desc nulls last, m.full_name
   limit 50;
$$;
revoke all on function sehat_search_patients(text, uuid) from public, anon;
grant execute on function sehat_search_patients(text, uuid) to authenticated;

notify pgrst, 'reload schema';
