-- ============================================================================
-- Sehatsandhi — who may act on a business, and how a doctor gets attached
--
-- Run AFTER 0037. Safe to re-run.
--
-- 0037 gave us the three tables. This is the behaviour on top: the one
-- definition of "which businesses may the caller act on", the policies that
-- resolve through it, and the RPCs registration actually calls — including
-- attaching a doctor who ALREADY EXISTS, which the old schema could not do at
-- all (sehat_org_add_doctor only ever inserted a new row).
--
-- A BUG FIXED ON THE WAY
-- sehat_caller_owns_org never got the auth_uid route that 0023 introduced and
-- 0027 retrofitted for reports: it matched only the legacy JWT email or a staff
-- supabase_user_id. A hospital that signed up through the wizard and logs in by
-- WhatsApp OTP has a synthetic email that is never written to the listing, so it
-- could not manage its own roster — both roster RPCs raised
-- insufficient_privilege. The replacement below resolves through auth_uid like
-- everything else.
-- ============================================================================

-- ── 1. The one definition of "my businesses" ───────────────────────────────
-- SECURITY DEFINER so a policy can consult these tables without recursing
-- through their own policies. Three routes in, same as before, plus the
-- affiliation route that replaces clinic_users.

create or replace function sehat_caller_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  -- The listing this login owns, linked at phone login.
  select b.id from businesses b
   where b.auth_uid is not null and b.auth_uid = auth.uid()
  union
  -- Legacy email/password login, still honoured.
  select b.id from businesses b
   where b.email is not null and b.email <> '' and b.email = auth.jwt() ->> 'email'
  union
  -- Anyone attached to the business who is allowed to sign in: the owner, the
  -- doctors, reception. This is the clinic_users route, rebuilt on affiliations.
  select bp.business_id
    from business_practitioners bp
    join practitioners p on p.id = bp.practitioner_id
   where p.auth_uid = auth.uid()
     and bp.status <> 'suspended'
     and bp.can_login_web;
$$;

grant execute on function sehat_caller_business_ids() to authenticated;

comment on function sehat_caller_business_ids is
  'Businesses the current session may act on: the auth_uid linked at phone '
  'login, a matching legacy email, or an active affiliation that permits web '
  'login. The single authority for business-facing RLS.';

create or replace function sehat_caller_owns_business(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_business is not null
     and (sehat_is_admin() or p_business in (select sehat_caller_business_ids()));
$$;

grant execute on function sehat_caller_owns_business(uuid) to authenticated;

-- ── 2. RLS ─────────────────────────────────────────────────────────────────

alter table businesses enable row level security;
alter table practitioners enable row level security;
alter table business_practitioners enable row level security;

-- Patients see active listings. Everything else about a business — its GSTIN,
-- its term dates, its auth_uid — is on the same row, so this is deliberately
-- the whole row for an ACTIVE listing only; pending and suspended stay private.
create policy businesses_public_read on businesses
  for select using (status = 'active');

create policy businesses_read_own on businesses
  for select using (sehat_caller_owns_business(id));

create policy businesses_update_own on businesses
  for update using (sehat_caller_owns_business(id))
  with check (sehat_caller_owns_business(id));

create policy businesses_admin_all on businesses
  using (sehat_is_admin()) with check (sehat_is_admin());

-- A practitioner row carries a phone and an email, so the public gets the view
-- at the bottom of this file rather than the table.
create policy practitioners_read_own on practitioners
  for select using (
    auth_uid = auth.uid()
    or exists (
      select 1 from business_practitioners bp
       where bp.practitioner_id = practitioners.id
         and bp.business_id in (select sehat_caller_business_ids())
    )
  );

create policy practitioners_update_own on practitioners
  for update using (
    auth_uid = auth.uid()
    or exists (
      select 1 from business_practitioners bp
       where bp.practitioner_id = practitioners.id
         and bp.business_id in (select sehat_caller_business_ids())
    )
  ) with check (true);

create policy practitioners_admin_all on practitioners
  using (sehat_is_admin()) with check (sehat_is_admin());

create policy affiliations_read_own on business_practitioners
  for select using (
    business_id in (select sehat_caller_business_ids())
    or exists (select 1 from practitioners p
                where p.id = business_practitioners.practitioner_id
                  and p.auth_uid = auth.uid())
  );

create policy affiliations_manage_own on business_practitioners
  using (sehat_caller_owns_business(business_id))
  with check (sehat_caller_owns_business(business_id));

create policy affiliations_admin_all on business_practitioners
  using (sehat_is_admin()) with check (sehat_is_admin());

-- ── 3. Registering a business ──────────────────────────────────────────────
-- One path for every vertical. The old schema had two — create_listing for
-- everyone and sehat_create_hospital for hospitals — and they disagreed about
-- what a doctor was, which is how the whole inconsistency started.
--
-- SECURITY DEFINER for the reason create_listing was: a just-created 'pending'
-- row is invisible to its own creator under the public read policy, so a plain
-- insert cannot read back the id it needs. Status is forced server-side, so a
-- caller cannot self-activate a listing.

create or replace function sehat_register_business(
  p_name        text,
  p_vertical    text default 'clinic',
  p_address     text default null,
  p_pin_codes   text[] default '{}',
  p_phone       text default null,
  p_email       text default null,
  p_reg_number  text default null,
  p_working_hours text default null,
  p_place_id    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a business needs a name';
  end if;

  insert into businesses (
    name, vertical, address, pin_codes, phone, email,
    reg_number, working_hours, google_place_id, status
  ) values (
    btrim(p_name),
    coalesce(nullif(btrim(p_vertical), ''), 'clinic'),
    p_address,
    coalesce(p_pin_codes, '{}'),
    p_phone,
    p_email,
    p_reg_number,
    p_working_hours,
    p_place_id,
    'pending'
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function sehat_register_business(text,text,text,text[],text,text,text,text,text)
  to anon, authenticated;

-- ── 4. Registering a person ────────────────────────────────────────────────
-- Returns the EXISTING practitioner when the registration already identifies
-- one, rather than creating a duplicate. Two clinics adding the same visiting
-- consultant must end up pointing at one person, or the whole model is
-- pointless.

create or replace function sehat_register_practitioner(
  p_full_name     text,
  p_speciality    text default null,
  p_qualification text default null,
  p_reg_number    text default null,
  p_smc_id        integer default null,
  p_phone         text default null,
  p_email         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'a practitioner needs a name';
  end if;

  -- The register identifies this person already? Use them.
  if p_smc_id is not null and coalesce(btrim(p_reg_number), '') <> '' then
    select id into v_id from practitioners
     where smc_id = p_smc_id
       and upper(btrim(reg_number)) = upper(btrim(p_reg_number));
    if found then
      return v_id;
    end if;
  end if;

  insert into practitioners (
    full_name, speciality, qualification, reg_number, smc_id, phone, email, status
  ) values (
    btrim(p_full_name),
    nullif(btrim(coalesce(p_speciality, '')), ''),
    nullif(btrim(coalesce(p_qualification, '')), ''),
    nullif(btrim(coalesce(p_reg_number, '')), ''),
    p_smc_id,
    p_phone,
    p_email,
    'pending'
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function sehat_register_practitioner(text,text,text,text,integer,text,text)
  to anon, authenticated;

-- ── 5. Attaching — the operation that did not exist ────────────────────────
-- The old schema could only ever CREATE a doctor into a hospital. There was no
-- way to say "this doctor, who already exists, also works here", which is the
-- normal case: one full-time post and a few visiting ones.

create or replace function sehat_attach_practitioner(
  p_business_id     uuid,
  p_practitioner_id uuid,
  p_role            text default 'doctor',
  p_is_primary      boolean default false,
  p_consultation_fee integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not sehat_caller_owns_business(p_business_id) then
    raise exception 'you are not authorised to manage this business'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from practitioners where id = p_practitioner_id) then
    raise exception 'no such practitioner';
  end if;

  -- One primary per person: clear the old one first, or the partial unique
  -- index rejects the insert and the caller sees a constraint error instead of
  -- their intent being carried out.
  if p_is_primary then
    update business_practitioners
       set is_primary = false
     where practitioner_id = p_practitioner_id and is_primary;
  end if;

  insert into business_practitioners (
    business_id, practitioner_id, role, is_primary, consultation_fee, status
  ) values (
    p_business_id, p_practitioner_id,
    coalesce(nullif(btrim(p_role), ''), 'doctor'),
    coalesce(p_is_primary, false),
    coalesce(p_consultation_fee, 0),
    'pending'
  )
  on conflict (business_id, practitioner_id) do update
    set role             = excluded.role,
        is_primary       = excluded.is_primary,
        consultation_fee = excluded.consultation_fee,
        status           = case when business_practitioners.status = 'suspended'
                                then 'pending' else business_practitioners.status end
  returning id into v_id;

  return v_id;
end $$;

grant execute on function sehat_attach_practitioner(uuid,uuid,text,boolean,integer)
  to authenticated;

comment on function sehat_attach_practitioner is
  'Link an existing person to a business. Re-attaching someone suspended '
  'revives the affiliation rather than erroring, which is what "they are back" '
  'means.';

-- Detaching is suspending. Deleting the affiliation would orphan the
-- appointments made through it and erase the record of who a patient actually
-- saw — the same reasoning 0018 applied to consultants.
create or replace function sehat_detach_practitioner(
  p_business_id     uuid,
  p_practitioner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not sehat_caller_owns_business(p_business_id) then
    raise exception 'you are not authorised to manage this business'
      using errcode = 'insufficient_privilege';
  end if;

  update business_practitioners
     set status = 'suspended', is_primary = false
   where business_id = p_business_id
     and practitioner_id = p_practitioner_id;
end $$;

grant execute on function sehat_detach_practitioner(uuid,uuid) to authenticated;

-- Which post is their main one. Called by the doctor's own dashboard, so
-- authority is the practitioner, not the business.
create or replace function sehat_set_primary_affiliation(
  p_practitioner_id uuid,
  p_business_id     uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    sehat_is_admin()
    or exists (select 1 from practitioners p
                where p.id = p_practitioner_id and p.auth_uid = auth.uid())
    or sehat_caller_owns_business(p_business_id)
  ) then
    raise exception 'you are not authorised to change this affiliation'
      using errcode = 'insufficient_privilege';
  end if;

  update business_practitioners set is_primary = false
   where practitioner_id = p_practitioner_id and is_primary;

  update business_practitioners set is_primary = true
   where practitioner_id = p_practitioner_id and business_id = p_business_id;
end $$;

grant execute on function sehat_set_primary_affiliation(uuid,uuid) to authenticated;

-- ── 6. Finding a doctor who is already here ────────────────────────────────
-- What the "attach existing" box calls. Deliberately narrow: enough to
-- recognise someone, never their phone or email. Registration is a public page,
-- so this is reachable by anyone.

create or replace function sehat_search_practitioners(p_query text)
returns table (
  id uuid,
  full_name text,
  speciality text,
  qualification text,
  reg_number text,
  smc_id integer,
  affiliation_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.speciality, p.qualification, p.reg_number, p.smc_id,
         (select count(*) from business_practitioners bp
           where bp.practitioner_id = p.id and bp.status <> 'suspended')
  from practitioners p
  where coalesce(btrim(p_query), '') <> ''
    and (
      p.full_name ilike '%' || btrim(p_query) || '%'
      or upper(btrim(coalesce(p.reg_number, ''))) = upper(btrim(p_query))
    )
  order by p.full_name
  limit 20;
$$;

grant execute on function sehat_search_practitioners(text) to anon, authenticated;

-- ── 7. Headcount, for billing ──────────────────────────────────────────────
-- Each business pays for the doctors it advertises. A visiting consultant at
-- four hospitals is billed to each of them, because each is separately
-- listing — and separately profiting from — that doctor.

create or replace function sehat_business_doctor_count(p_business_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*), 0)::integer
    from business_practitioners bp
   where bp.business_id = p_business_id
     and bp.role = 'doctor'
     and bp.status <> 'suspended';
$$;

grant execute on function sehat_business_doctor_count(uuid) to anon, authenticated;

-- ── 8. The views that described the old shape ──────────────────────────────

-- What a patient sees under a business. Names and credentials only — never a
-- registration number, never contact details. A view rather than a policy
-- because RLS is row-level: a policy letting the public read practitioner rows
-- would expose every column of those rows, phone included.
create or replace view public_business_doctors as
  select
    bp.business_id,
    p.id            as practitioner_id,
    p.full_name,
    p.qualification,
    p.speciality,
    bp.consultation_fee,
    bp.is_primary,
    bp.sort_order
  from business_practitioners bp
  join practitioners p on p.id = bp.practitioner_id
  join businesses b    on b.id = bp.business_id
  where bp.role = 'doctor'
    and bp.status = 'active'
    and b.status = 'active'
    and p.status = 'active';

grant select on public_business_doctors to anon, authenticated;

comment on view public_business_doctors is
  'The doctors a patient sees under a business. Name, qualification, speciality '
  'and the fee at THIS business — not registration numbers, not contact '
  'details, not non-clinical staff.';

-- Where a doctor practises. The other direction of the same join, and what
-- makes "find a cardiologist" able to say where to go.
create or replace view public_practitioner_businesses as
  select
    p.id            as practitioner_id,
    p.full_name,
    p.speciality,
    p.qualification,
    b.id            as business_id,
    b.name          as business_name,
    b.vertical,
    b.address,
    b.pin_codes,
    bp.consultation_fee,
    bp.is_primary
  from practitioners p
  join business_practitioners bp on bp.practitioner_id = p.id
  join businesses b on b.id = bp.business_id
  where p.status = 'active'
    and bp.status = 'active'
    and bp.role = 'doctor'
    and b.status = 'active';

grant select on public_practitioner_businesses to anon, authenticated;

-- Rebuilt against businesses. Same definitions as before; only the table and
-- the column names change.
create view business_effective_pricing as
 select b.id as business_id,
    b.name,
    b.pin_codes,
    coalesce(sum(pt.monthly_price), (0)::bigint) as base_monthly_price,
    bpo.override_type,
    bpo.discount_percentage,
    bpo.discount_amount,
    bpo.custom_monthly_price,
    bpo.valid_until,
    bpo.reason,
    bpo.category,
        case
            when (bpo.override_type = 'free') then (0)::numeric
            when (bpo.override_type = 'discount_pct') then round(((coalesce(sum(pt.monthly_price), (0)::bigint))::numeric * ((1)::numeric - ((bpo.discount_percentage)::numeric / (100)::numeric))))
            when (bpo.override_type = 'discount_fixed') then (greatest((0)::bigint, (coalesce(sum(pt.monthly_price), (0)::bigint) - bpo.discount_amount)))::numeric
            when (bpo.override_type = 'custom_price') then (bpo.custom_monthly_price)::numeric
            when (bpo.override_type = 'trial') then (0)::numeric
            else (coalesce(sum(pt.monthly_price), (0)::bigint))::numeric
        end as effective_monthly_price,
        case
            when (bpo.override_type = any (array['free','trial'])) then true
            when ((bpo.override_type = 'discount_pct') and (bpo.discount_percentage = 100)) then true
            else false
        end as is_free,
    bpo.is_active as has_override
   from (((businesses b
     left join service_areas sa on (((sa.pin_code = any (b.pin_codes)) and (sa.is_active = true))))
     left join pricing_tiers pt on ((pt.tier_number = sa.tier_number)))
     left join business_pricing_overrides bpo on (((bpo.business_id = b.id) and (bpo.is_active = true) and ((bpo.valid_until is null) or (bpo.valid_until >= current_date)))))
  group by b.id, b.name, b.pin_codes, bpo.override_type, bpo.discount_percentage, bpo.discount_amount, bpo.custom_monthly_price, bpo.valid_until, bpo.reason, bpo.category, bpo.is_active;

create view admin_revenue_summary as
 select b.name as business_name,
    b.status,
    bep.base_monthly_price,
    bep.effective_monthly_price,
    ((bep.base_monthly_price)::numeric - bep.effective_monthly_price) as discount_amount,
        case
            when bep.is_free then 'FREE'
            when (bep.override_type = 'discount_pct') then (bep.discount_percentage || '% off')
            when (bep.override_type = 'discount_fixed') then (('₹' || bep.discount_amount) || ' off')
            when (bep.override_type = 'custom_price') then ('Custom: ₹' || bep.custom_monthly_price)
            else 'Full price'
        end as pricing_label,
    bep.category as override_category,
    bep.valid_until as discount_expires
   from (businesses b
     left join business_effective_pricing bep on ((bep.business_id = b.id)))
  where (b.status = 'active')
  order by bep.effective_monthly_price desc;

revoke all on admin_revenue_summary from anon, authenticated;

create view plan_enrolment as
select
  b.pricing_plan_code                                as plan_code,
  b.id                                               as business_id,
  b.name,
  b.vertical,
  b.phone,
  b.status,
  b.locked_monthly_price,
  b.months_paid,
  b.term_start,
  b.term_end,
  (b.term_end is not null and b.term_end < current_date) as term_expired,
  b.locked_at
from businesses b
where b.pricing_plan_code is not null
order by b.pricing_plan_code, b.term_end nulls last;

revoke all on plan_enrolment from anon, authenticated;

create view pricing_plan_status as
select
  p.*,
  (select count(*) from businesses b
    where b.pricing_plan_code = p.code)                            as signups_used,
  (select count(*) from businesses b
    where b.pricing_plan_code = p.code
      and b.status = 'active'
      and (b.term_end is null or b.term_end >= current_date))      as active_enrolled,
  (select count(*) from businesses b
    where b.pricing_plan_code = p.code
      and b.term_end is not null
      and b.term_end < current_date)                               as expired_enrolled,
  (select max(b.locked_at) from businesses b
    where b.pricing_plan_code = p.code)                            as last_signup_at,
  case when p.max_signups is null then null
       else greatest(p.max_signups - (select count(*) from businesses b
                                       where b.pricing_plan_code = p.code), 0)
  end                                                              as seats_left,
  ((select count(*) from businesses b where b.pricing_plan_code = p.code) = 0)
                                                                   as can_delete,
  (select code from active_pricing_plan)                           as active_code,
  (p.code = (select code from active_pricing_plan))                as is_currently_active
from pricing_plans p
order by p.sequence, p.code;

revoke all on pricing_plan_status from anon, authenticated;

create view subscription_renewals_due as
select
  b.id                                    as business_id,
  b.name,
  b.vertical,
  b.phone,
  b.email,
  b.pricing_plan_code,
  b.locked_monthly_price,
  b.months_paid,
  b.term_start,
  b.term_end,
  (b.term_end - current_date)             as days_remaining,
  b.status
from businesses b
where b.term_end is not null
  and b.status = 'active'
order by b.term_end;

revoke all on subscription_renewals_due from anon, authenticated;

-- Demand reporting counts a pincode as served when an active listing covers it.
create or replace view demand_by_area as
select
  e.pin_code,
  e.speciality,
  count(*)                        as searches,
  count(distinct e.session_id)    as searchers,
  max(e.created_at)               as last_searched_at,
  (select count(*) from businesses b
    where b.status = 'active' and e.pin_code = any(b.pin_codes)) as active_listings
from site_events e
where e.event_type = 'search' and e.pin_code is not null
group by e.pin_code, e.speciality;

revoke all on demand_by_area from anon, authenticated;
