-- ============================================================================
-- 0274 — An extra doctor, under the plans by doctors (0272)
-- ============================================================================
-- A doctor who joins a clinic mid-term and takes it past its plan's doctors
-- (Clinic 2, Polyclinic 4, Multi-speciality 8, Hospital 15) is paid for as the
-- difference to the plan that fits — e.g. a third doctor moves a Clinic
-- (₹2,000) to a Polyclinic (₹3,000): ₹1,000 a month, pro rata for the term
-- (doctor-addon-order, unchanged). Beyond 15 it is ₹400 a doctor. Until the
-- plans are live this is exactly as before.
--
-- And the old rule that a clinic may have at most 3 doctors gives way: a
-- clinic with more simply moves up a plan.
-- ============================================================================

create or replace function sehat_extra_doctor_monthly(p_business uuid, p_practitioner uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_others integer;
  v_now jsonb;
  v_then jsonb;
begin
  -- Doctors here besides the one joining.
  select count(*) into v_others from business_practitioners bp
   where bp.business_id = p_business and bp.role in ('doctor', 'owner') and bp.status <> 'suspended'
     and bp.practitioner_id <> p_practitioner and exists (select 1 from practitioners p where p.id = bp.practitioner_id);

  if (select tiered_live from plan_settings where id) then
    v_now := sehat_plan_quote(p_business, 1, null, null, greatest(v_others, 1));
    v_then := sehat_plan_quote(p_business, 1, null, null, greatest(v_others + 1, 1));
    if v_now is not null and v_then is not null then
      return greatest(0, (v_then->>'monthly')::numeric - (v_now->>'monthly')::numeric);
    end if;
  end if;

  -- Before the plans (0140): one price per doctor beyond those included.
  return (select case
           when coalesce(vb.extra_doctor_price, 0) > 0
                and (select count(*) from business_practitioners bp
                      where bp.business_id = p_business and bp.role = 'doctor'
                        and bp.status <> 'suspended' and bp.practitioner_id <> p_practitioner)
                    >= coalesce(vb.included_doctors, 0)
           then vb.extra_doctor_price else 0 end
    from businesses b
    left join vertical_billing vb on vb.vertical = b.vertical
   where b.id = p_business);
end $$;

create or replace function sehat_clinic_doctor_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if new.role not in ('doctor', 'owner') or new.status = 'suspended' then return new; end if;
  -- Only when this row BECOMES a doctor here: joined, came back, or promoted.
  if tg_op = 'UPDATE' and old.role in ('doctor', 'owner') and old.status <> 'suspended' then return new; end if;
  if (select vertical from businesses where id = new.business_id) is distinct from 'clinic' then return new; end if;
  -- 0274: with the plans by doctors live, a clinic simply moves up a plan.
  if (select tiered_live from plan_settings where id) then return new; end if;
  select count(*) into v_count from business_practitioners bp
   where bp.business_id = new.business_id and bp.role in ('doctor', 'owner') and bp.status <> 'suspended'
     and bp.practitioner_id <> new.practitioner_id
     and exists (select 1 from practitioners p where p.id = bp.practitioner_id);
  if v_count >= 3 then
    raise exception 'A clinic can have up to 3 doctors. For more, register as a hospital — message us on WhatsApp and we will move you across.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
