-- ============================================================================
-- Sehatsandhi — refer a patient to another doctor at the same clinic
--
-- Run AFTER 0133. Safe to re-run.
--
-- Decided 26 Sep 2026: a doctor (or the desk, on the doctor's word) refers a
-- patient to another doctor of the same hospital or clinic, picked from its
-- own doctors. The referred consultation is charged at that doctor's OPD fee,
-- at a price the referrer sets, or at ₹0 — every option, recorded.
--
-- sehat_refer_patient does it in one go:
--   1. writes the referral (who, to whom, why, from which visit);
--   2. charges the consultation to the referred doctor. Below their fee is a
--      discount like any other (0133) and carries the reason
--      "Referred by Dr X"; ₹0 is recorded as a free consultation, so the
--      doctor's report shows internal referrals it waived;
--   3. puts the patient in that doctor's OPD queue today, unless they already
--      have a live token there.
-- ============================================================================

create table if not exists patient_referrals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  from_visit_id uuid references patient_visits(id) on delete set null,
  from_practitioner_id uuid references practitioners(id) on delete set null,
  to_practitioner_id uuid not null references practitioners(id) on delete cascade,
  note text,
  fee_charged numeric,
  charge_id uuid references patient_charges(id) on delete set null,
  queue_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists patient_referrals_member_idx on patient_referrals (patient_member_id, created_at desc);
create index if not exists patient_referrals_to_idx on patient_referrals (to_practitioner_id, created_at desc);

alter table patient_referrals enable row level security;
drop policy if exists clinic_reads_referrals on patient_referrals;
create policy clinic_reads_referrals on patient_referrals
  for select to authenticated using (sehat_caller_owns_business(business_id));
revoke insert, update, delete on patient_referrals from anon, authenticated;


create or replace function sehat_refer_patient(
  p_business uuid,
  p_member uuid,
  p_to_practitioner uuid,
  p_note text default null,
  p_fee numeric default null,          -- null = the referred doctor's fee; 0 = free
  p_from_visit uuid default null,
  p_from_practitioner uuid default null,
  p_queue boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_to     record;
  v_from   uuid := coalesce(p_from_practitioner, sehat_caller_practitioner_id());
  v_from_n text;
  v_list   numeric;
  v_fee    numeric;
  v_ref    uuid;
  v_charge uuid;
  v_queue  uuid;
  v_reason text;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'not your business' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from patient_members where id = p_member) then
    raise exception 'No such patient.' using errcode = 'no_data_found';
  end if;

  select p.id, p.full_name, bp.consultation_fee, bp.discounted_fee into v_to
    from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
   where bp.business_id = p_business and bp.practitioner_id = p_to_practitioner
     and bp.role in ('doctor', 'owner') and bp.status <> 'suspended';
  if v_to.id is null then
    raise exception 'That doctor does not work here.' using errcode = 'no_data_found';
  end if;
  if v_from is not null and v_from = p_to_practitioner then
    raise exception 'A doctor cannot refer a patient to themselves.' using errcode = 'check_violation';
  end if;

  select full_name into v_from_n from practitioners where id = v_from;
  v_list := nullif(coalesce(v_to.discounted_fee, v_to.consultation_fee, 0), 0);
  v_fee := coalesce(p_fee, v_list, 0);
  if v_fee < 0 then raise exception 'The fee cannot be negative.' using errcode = 'check_violation'; end if;
  v_reason := 'Referred by ' || coalesce(v_from_n, 'the clinic')
              || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), '');

  insert into patient_referrals (business_id, patient_member_id, from_visit_id, from_practitioner_id,
                                 to_practitioner_id, note, fee_charged)
  values (p_business, p_member, p_from_visit, v_from, p_to_practitioner,
          nullif(btrim(coalesce(p_note, '')), ''), v_fee)
  returning id into v_ref;

  -- A charge whenever there is money involved or a fee being waived.
  if v_fee > 0 or v_list is not null then
    insert into patient_charges (business_id, patient_member_id, category, description, quantity,
                                 unit_price, amount, practitioner_id, list_price, discount_reason, notes)
    values (p_business, p_member, 'consultation', 'OPD consultation (referral) — ' || v_to.full_name, 1,
            v_fee, v_fee, p_to_practitioner, v_list,
            case when v_list is not null and v_fee < v_list then left(v_reason, 300) end,
            left(v_reason, 300))
    returning id into v_charge;
  end if;

  if p_queue then
    begin
      select (sehat_issue_token(p_member, p_business, p_to_practitioner, left(v_reason, 200))).id into v_queue;
    exception when others then
      v_queue := null;   -- already in that line today, or no queue system: the referral stands
    end;
  end if;

  update patient_referrals set charge_id = v_charge, queue_id = v_queue where id = v_ref;
  return jsonb_build_object('referral_id', v_ref, 'charge_id', v_charge, 'queue_id', v_queue,
                            'fee', v_fee, 'list_price', v_list, 'doctor', v_to.full_name);
end $$;

revoke all on function sehat_refer_patient(uuid, uuid, uuid, text, numeric, uuid, uuid, boolean) from public, anon;
grant execute on function sehat_refer_patient(uuid, uuid, uuid, text, numeric, uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
