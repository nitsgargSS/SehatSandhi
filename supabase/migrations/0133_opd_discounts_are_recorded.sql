-- ============================================================================
-- Sehatsandhi — a consultation charged below the doctor's fee says why, and who
--
-- Run AFTER 0132. Safe to re-run.
--
-- Decided 26 Sep 2026: the OPD fee is set in the system (0132, per doctor per
-- clinic). At the desk, reception charges it — or, as the doctor asks, a lower
-- price or nothing at all. A free or discounted consultation needs a reason,
-- and the doctor's report lists every one with who gave it.
--
-- On patient_charges:
--   list_price       the doctor's regular fee, per unit, when the charge came
--                    from it. Null for charges typed freehand (a bed, a drug).
--   discount_amount  list_price × quantity − amount, worked out here, never
--                    trusted from the screen.
--   discount_kind    'free' (charged ₹0) or 'discount'.
--   discount_reason  required whenever discount_amount > 0.
--   discount_by      the login that recorded it.
--
-- sehat_discount_report lists them: the owner or a manager sees everyone's,
-- a doctor sees their own. Reception records discounts but does not read the
-- report — it is how the practice checks what the desk gave away.
-- ============================================================================

alter table patient_charges add column if not exists list_price numeric;
alter table patient_charges add column if not exists discount_amount numeric not null default 0;
alter table patient_charges add column if not exists discount_kind text;
alter table patient_charges add column if not exists discount_reason text;
alter table patient_charges add column if not exists discount_by uuid;

do $$ begin
  alter table patient_charges add constraint patient_charges_discount_kind_check
    check (discount_kind is null or discount_kind in ('free', 'discount'));
exception when duplicate_object then null; end $$;

create or replace function sehat_charge_discount()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.list_price is null or new.list_price <= 0 then
    new.discount_amount := 0; new.discount_kind := null; new.discount_by := null;
    return new;
  end if;
  new.discount_amount := greatest(0, round(new.list_price * coalesce(new.quantity, 1), 2) - coalesce(new.amount, 0));
  if new.discount_amount = 0 then
    new.discount_kind := null; new.discount_reason := null; new.discount_by := null;
    return new;
  end if;
  if nullif(btrim(coalesce(new.discount_reason, '')), '') is null then
    raise exception 'Say why this consultation is % — for example, "Doctor''s relative" or "Follow-up within 7 days".',
      case when coalesce(new.amount, 0) = 0 then 'free' else 'discounted' end
      using errcode = 'check_violation';
  end if;
  new.discount_reason := left(btrim(new.discount_reason), 300);
  new.discount_kind := case when coalesce(new.amount, 0) = 0 then 'free' else 'discount' end;
  new.discount_by := coalesce(new.discount_by, auth.uid());
  return new;
end $$;

drop trigger if exists patient_charges_discount on patient_charges;
create trigger patient_charges_discount
  before insert or update of list_price, amount, quantity, discount_reason on patient_charges
  for each row execute function sehat_charge_discount();


create or replace function sehat_discount_report(
  p_business uuid, p_practitioner uuid default null, p_from date default null, p_to date default null
) returns table (
  charged_on date, patient_name text, doctor_name text, description text,
  list_price numeric, amount numeric, discount_amount numeric, discount_kind text,
  discount_reason text, given_by text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := sehat_caller_role(p_business);
  v_me uuid := sehat_caller_practitioner_id();
  v_only uuid := p_practitioner;
begin
  if v_role in ('owner', 'manager') then
    null;
  elsif v_role is not null and v_me is not null then
    v_only := v_me;   -- a doctor sees their own, whatever was asked for
  else
    raise exception 'Only the owner, a manager or the doctor can see discounts.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select c.charged_on, m.full_name, p.full_name, c.description,
         c.list_price * coalesce(c.quantity, 1), c.amount, c.discount_amount, c.discount_kind,
         c.discount_reason,
         coalesce(
           (select g.full_name from practitioners g where g.auth_uid = c.discount_by
             order by g.created_at limit 1),
           (select 'Owner (' || b.name || ')' from businesses b
             where b.id = c.business_id and b.auth_uid = c.discount_by),
           (select u.email::text from auth.users u where u.id = c.discount_by),
           '—')
    from patient_charges c
    left join patient_members m on m.id = c.patient_member_id
    left join practitioners p on p.id = c.practitioner_id
   where c.business_id = p_business
     and c.discount_amount > 0
     and (v_only is null or c.practitioner_id = v_only)
     and (p_from is null or c.charged_on >= p_from)
     and (p_to is null or c.charged_on <= p_to)
   order by c.charged_on desc, c.created_at desc;
end $$;

revoke all on function sehat_discount_report(uuid, uuid, date, date) from public, anon;
grant execute on function sehat_discount_report(uuid, uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
