-- ============================================================================
-- 0251 — A patient registers themselves at reception by scanning a QR code
-- ============================================================================
-- AFTER 0250. Safe to re-run.
--
-- At a busy desk the receptionist types every new patient's name, age and
-- number. A second QR code at reception now opens a short form on the
-- patient's own phone — name, age and WhatsApp number (address and PIN code
-- if they wish) — and "Register" puts them in a list on the reception's Queue
-- screen. The receptionist checks it, takes the OPD fee and gives the token;
-- only then does the person become a patient of the clinic. Nothing here goes
-- through WhatsApp, and nothing is added to the patient list unconfirmed.
--
-- The form is open to anyone who has the code, so: what it writes is a
-- waiting-list row and nothing else; one row per number per clinic a day
-- (sent again, it is corrected); a clinic takes at most 300 a day; a row
-- nobody acts on is gone the next day.
-- ============================================================================

create table if not exists clinic_checkins (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  day date not null default (now() at time zone 'Asia/Kolkata')::date,
  phone text not null,
  full_name text not null,
  age integer check (age is null or age between 0 and 120),
  address text,
  pin_code text,
  status text not null default 'waiting' check (status in ('waiting', 'registered', 'dismissed')),
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, day, phone)
);
create index if not exists clinic_checkins_waiting_idx on clinic_checkins (business_id, day) where status = 'waiting';
alter table clinic_checkins enable row level security;   -- reached only through the functions below
revoke all on clinic_checkins from anon, authenticated;

-- What the form shows on top: whose reception this is. Public.
create or replace function sehat_clinic_checkin_info(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'name', b.name, 'city', nullif(btrim(b.own_city), ''))
      from businesses b
     where b.qr_code = substring(upper(coalesce(p_code, '')) from 'SS-[A-Z0-9]{5}') and b.status = 'active'),
    jsonb_build_object('ok', false));
$$;

-- The form's Register button. Public.
create or replace function sehat_clinic_checkin(
  p_code text, p_name text, p_age integer, p_phone text, p_address text default null, p_pin text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_biz uuid;
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_phone text := sehat_normalise_phone(p_phone);
  v_pin text := nullif(regexp_replace(coalesce(p_pin, ''), '\D', '', 'g'), '');
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select b.id into v_biz from businesses b
   where b.qr_code = substring(upper(coalesce(p_code, '')) from 'SS-[A-Z0-9]{5}') and b.status = 'active';
  if v_biz is null then return jsonb_build_object('ok', false, 'text', 'This QR code is not active. Please tell the reception.'); end if;
  if v_name is null or char_length(v_name) < 2 then return jsonb_build_object('ok', false, 'text', 'Please write the patient''s name.'); end if;
  if p_age is null or p_age < 0 or p_age > 120 then return jsonb_build_object('ok', false, 'text', 'Please write the age in years.'); end if;
  if v_phone is null or v_phone !~ '^91[6-9][0-9]{9}$' then return jsonb_build_object('ok', false, 'text', 'Please write a 10-digit mobile number.'); end if;
  if v_pin is not null and v_pin !~ '^[1-9][0-9]{5}$' then v_pin := null; end if;
  if (select count(*) from clinic_checkins where business_id = v_biz and day = v_day) >= 300 then
    return jsonb_build_object('ok', false, 'text', 'Please give your details at the reception desk.');
  end if;

  insert into clinic_checkins (business_id, day, phone, full_name, age, address, pin_code)
  values (v_biz, v_day, v_phone, left(v_name, 80), p_age, nullif(btrim(left(coalesce(p_address, ''), 200)), ''), v_pin)
  on conflict (business_id, day, phone) do update
    set full_name = excluded.full_name, age = excluded.age, address = excluded.address, pin_code = excluded.pin_code,
        status = case when clinic_checkins.status = 'registered' then 'registered' else 'waiting' end,
        created_at = case when clinic_checkins.status = 'registered' then clinic_checkins.created_at else now() end;

  delete from clinic_checkins where day < v_day - 1;
  return jsonb_build_object('ok', true);
end $$;

-- Today's self-registered patients waiting at this reception.
create or replace function sehat_clinic_checkins(p_business uuid)
returns table (id uuid, full_name text, age integer, phone text, address text, pin_code text, created_at timestamptz, known boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_business not in (select sehat_caller_business_ids()) then
    raise exception 'not your business' using errcode = '42501';
  end if;
  return query
    select c.id, c.full_name, c.age, c.phone, c.address, c.pin_code, c.created_at,
           exists (select 1 from patients p join patient_members m on m.patient_id = p.id
                     join business_patients bp on bp.patient_member_id = m.id and bp.business_id = p_business
                    where p.phone = c.phone)
      from clinic_checkins c
     where c.business_id = p_business and c.day = (now() at time zone 'Asia/Kolkata')::date and c.status = 'waiting'
     order by c.created_at;
end $$;

-- The receptionist has given the token ('registered') or removed the entry ('dismissed').
create or replace function sehat_clinic_checkin_close(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('registered', 'dismissed') then raise exception 'unknown status' using errcode = 'P0001'; end if;
  update clinic_checkins set status = p_status, handled_by = auth.uid(), handled_at = now()
   where id = p_id and business_id in (select sehat_caller_business_ids());
  if not found then raise exception 'not your business' using errcode = '42501'; end if;
end $$;

revoke all on function sehat_clinic_checkin_info(text) from public;
revoke all on function sehat_clinic_checkin(text, text, integer, text, text, text) from public;
revoke all on function sehat_clinic_checkins(uuid) from public, anon;
revoke all on function sehat_clinic_checkin_close(uuid, text) from public, anon;
grant execute on function sehat_clinic_checkin_info(text) to anon, authenticated;
grant execute on function sehat_clinic_checkin(text, text, integer, text, text, text) to anon, authenticated;
grant execute on function sehat_clinic_checkins(uuid) to authenticated;
grant execute on function sehat_clinic_checkin_close(uuid, text) to authenticated;

notify pgrst, 'reload schema';
