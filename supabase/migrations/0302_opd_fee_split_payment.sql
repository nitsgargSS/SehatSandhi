-- ============================================================================
-- 0302 — The OPD fee paid two ways
-- ============================================================================
-- AFTER 0301. Safe to re-run.
--
-- Asked 30 Oct 2026, after 0301 split the pharmacy bill and counter invoice:
-- the fee taken with an OPD token can be split too (₹200 UPI + ₹300 cash),
-- or part paid with the rest left due.
--
-- sehat_opd_visit (0226) is unchanged. The split version gives the token
-- through it with no payment, then records each part the way it would have
-- recorded one — same note, same "taken by" — in the same transaction.
-- ============================================================================

-- p_payments: [{amount, method, reference}]; empty or null leaves the fee due.
create or replace function sehat_opd_visit_split(
  p_business uuid, p_member uuid, p_practitioner uuid,
  p_fee numeric default null, p_discount_reason text default null, p_reason text default null,
  p_priority integer default 0, p_priority_reason text default null,
  p_payments jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_fee numeric;
  v_total numeric := 0;
  p jsonb;
  v_amt numeric;
begin
  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payments must be a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) > 6 then
    raise exception 'A fee takes up to 6 payments.' using errcode = '22023';
  end if;

  r := sehat_opd_visit(p_business, p_member, p_practitioner, p_fee, p_discount_reason, p_reason,
                       p_priority, p_priority_reason, null, null);
  v_fee := coalesce((r->>'fee')::numeric, 0);

  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_amt := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2);
    continue when v_amt = 0;
    if v_amt < 0 then raise exception 'A payment cannot be below zero.' using errcode = '22023'; end if;
    v_total := v_total + v_amt;
    if v_total > v_fee then
      raise exception 'The payments come to more than the fee (₹%).', v_fee using errcode = '22023';
    end if;
    insert into patient_payments (business_id, patient_member_id, amount, method, reference, notes, recorded_by, practitioner_id)
    values (p_business, p_member, v_amt, coalesce(nullif(p->>'method', ''), 'cash'),
            nullif(btrim(coalesce(p->>'reference', '')), ''),
            'OPD fee, token ' || (r->>'token_number'), sehat_caller_practitioner_id(), p_practitioner);
  end loop;

  return r || jsonb_build_object('paid', v_total);
end $$;
revoke all on function sehat_opd_visit_split(uuid, uuid, uuid, numeric, text, text, integer, text, jsonb) from public, anon;
grant execute on function sehat_opd_visit_split(uuid, uuid, uuid, numeric, text, text, integer, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
