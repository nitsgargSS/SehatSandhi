-- ============================================================================
-- Sehatsandhi — clinics hear about bookings, doctors' registrations are
--               checked, and the website shows a doctor's discount
--
-- Run AFTER 0135. Safe to re-run.
--
-- ── 1. A NEW BOOKING EMAILS THE CLINIC ──────────────────────────────────────
-- WhatsApp cannot send yet (no AiSensy API campaigns), so a clinic learnt of a
-- bot booking only if its dashboard happened to be open. Every new booking now
-- queues 'clinic_new_booking' on email_outbox (0125); email-send mails the
-- business's address, and the doctor's own when they have a different one.
-- The once-per-business index was right for the two registration emails and
-- wrong for bookings, so it is narrowed to them.
--
-- ── 2. REGISTRATION CHECKED BEFORE A DOCTOR IS TRUSTED ──────────────────────
-- 0131 made doctors go live with their clinic, so nothing stood between a typed
-- registration number and the bot. practitioners.imr_status has existed since
-- 0037 and nothing ever set it. Now:
--   matched    — set on registration when the doctor was picked from the
--                medical register (it carries smc_id), so the number is real;
--   confirmed  — admin checked it (admin panel → Verify → Confirm);
--   no_match   — admin checked it and it is wrong: the doctor is taken OFF the
--                bot and the website until corrected.
-- The bot marks matched/confirmed doctors with ✓. Unchecked doctors still list.
--
-- ── 3. THE WEBSITE SHOWS THE DISCOUNT (0132) ────────────────────────────────
-- The two public views and sehat_find_doctors gain discounted_fee and
-- reg_verified, so the profile and speciality pages can match the bot.
-- ============================================================================

-- ── 1. Booking emails ───────────────────────────────────────────────────────
alter table email_outbox add column if not exists appointment_id uuid references appointments(id) on delete cascade;

alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check
  check (kind in ('business_welcome', 'admin_new_business', 'clinic_new_booking'));

drop index if exists email_outbox_once_idx;
create unique index if not exists email_outbox_once_idx
  on email_outbox (kind, business_id) where kind in ('business_welcome', 'admin_new_business');
create unique index if not exists email_outbox_booking_once_idx
  on email_outbox (appointment_id) where kind = 'clinic_new_booking';

create or replace function sehat_queue_booking_email()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('booked', 'confirmed') and new.slot_datetime > now() - interval '1 hour' then
    insert into email_outbox (kind, business_id, appointment_id)
    values ('clinic_new_booking', new.business_id, new.id)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists appointments_queue_booking_email on appointments;
create trigger appointments_queue_booking_email
  after insert on appointments
  for each row execute function sehat_queue_booking_email();

-- ── 2. Registration checks ──────────────────────────────────────────────────
create or replace function sehat_practitioner_from_register()
returns trigger
language plpgsql as $$
begin
  if new.smc_id is not null and nullif(btrim(coalesce(new.reg_number, '')), '') is not null
     and coalesce(new.imr_status, 'unchecked') = 'unchecked' then
    new.imr_status := 'matched';
    new.imr_checked_at := coalesce(new.imr_checked_at, now());
  end if;
  return new;
end $$;

drop trigger if exists practitioners_from_register on practitioners;
create trigger practitioners_from_register
  before insert on practitioners
  for each row execute function sehat_practitioner_from_register();

update practitioners set imr_status = 'matched', imr_checked_at = coalesce(imr_checked_at, now())
 where smc_id is not null and nullif(btrim(coalesce(reg_number, '')), '') is not null
   and coalesce(imr_status, 'unchecked') = 'unchecked';

-- ── 3. Public views: discount + verified, wrong registrations hidden ───────
create or replace view public_practitioner_businesses as
 select p.id as practitioner_id,
        p.full_name,
        p.speciality,
        p.qualification,
        b.id as business_id,
        b.name as business_name,
        b.vertical,
        b.address,
        b.pin_codes,
        bp.consultation_fee,
        bp.is_primary,
        bp.discounted_fee,
        p.imr_status in ('matched', 'confirmed') as reg_verified
   from practitioners p
   join business_practitioners bp on bp.practitioner_id = p.id
   join businesses b on b.id = bp.business_id
  where p.status = 'active' and bp.status = 'active' and bp.role = 'doctor' and b.status = 'active'
    and coalesce(p.imr_status, 'unchecked') <> 'no_match';

create or replace view public_business_doctors as
 select bp.business_id,
        p.id as practitioner_id,
        p.full_name,
        p.qualification,
        p.speciality,
        bp.consultation_fee,
        bp.is_primary,
        bp.sort_order,
        bp.discounted_fee,
        p.imr_status in ('matched', 'confirmed') as reg_verified
   from business_practitioners bp
   join practitioners p on p.id = bp.practitioner_id
   join businesses b on b.id = bp.business_id
  where bp.role = 'doctor' and bp.status = 'active' and b.status = 'active' and p.status = 'active'
    and coalesce(p.imr_status, 'unchecked') <> 'no_match';

drop function if exists sehat_find_doctors(text, text);
create function sehat_find_doctors(p_speciality text, p_pin_code text)
returns table(practitioner_id uuid, full_name text, speciality text, qualification text, business_id uuid,
              business_name text, address text, consultation_fee integer, is_primary boolean, nearby boolean,
              area text, discounted_fee integer, reg_verified boolean)
language sql stable security definer set search_path to 'public' as $function$
  with k as (
    select sehat_district_pin_codes(p_pin_code) as pins, d.district_key, d.state_key
      from (select 1) one
      left join sehat_pin_district(p_pin_code) d on true
  ),
  hits as (
    select v.*, b.own_city,
           sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                             p_pin_code, k.pins, k.district_key, k.state_key) as near
      from public_practitioner_businesses v
      join businesses b on b.id = v.business_id
      cross join k
     where v.speciality = p_speciality
  )
  select h.practitioner_id, h.full_name, h.speciality, h.qualification,
         h.business_id, h.business_name, h.address,
         h.consultation_fee, h.is_primary,
         h.near = 1,
         case when h.near = 1 then nullif(btrim(h.own_city), '') end,
         h.discounted_fee, h.reg_verified
    from hits h
   where h.near is not null
   order by h.near, h.full_name;
$function$;
grant execute on function sehat_find_doctors(text, text) to anon, authenticated;

-- ── The bot's line: 0132's, with ✓ for a checked registration ──────────────
create or replace function bot_search_bookable(p_kind text, p_filter text, p_pincode text)
returns text
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_pin  text := bot_pincode(p_pincode);
  v_code text := case when p_kind = 'doctor'
                      then bot_speciality_code(p_filter)
                      else bot_vertical_code(coalesce(nullif(btrim(p_filter), ''), p_kind)) end;
  v_out  text;
begin
  if v_code is not null and v_pin is not null then
    select string_agg(l.line, E'\n\n' order by l.rn) into v_out
      from (
        select b.rn,
               b.rn || '. ' || b.title
            || case when pr.imr_status in ('matched', 'confirmed') then ' ✓' else '' end
            || case when coalesce(b.subtitle, '') not in ('', b.title)
                    then ' — ' || b.subtitle else '' end
            || case when b.avg_rating is not null
                    then ' (' || b.avg_rating || '★, ' || b.total_reviews || ' समीक्षाएँ)'
                    else ' (नया)' end
            || case when b.area is not null then E'\n   📍 ' || b.area else '' end
            || case
                 when coalesce(b.consultation_fee, 0) > 0 and bp.discounted_fee is not null
                      and bp.discounted_fee < b.consultation_fee
                   then E'\n   फ़ीस ~₹' || b.consultation_fee || '~ *₹' || bp.discounted_fee || '* (छूट)'
                 when coalesce(b.consultation_fee, 0) > 0
                   then E'\n   फ़ीस ₹' || b.consultation_fee
                 else '' end
            || E'\n   ' || bot_profile_url(b.business_id, coalesce(b.subtitle, b.title)) as line
          from bot_bookable(p_kind, v_code, v_pin) b
          left join business_practitioners bp
            on bp.business_id = b.business_id and bp.practitioner_id = b.practitioner_id
          left join practitioners pr on pr.id = b.practitioner_id
      ) l;
  end if;

  if v_out is null then
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification)
    values ('bot',
            coalesce(v_pin, nullif(left(btrim(coalesce(p_pincode, '')), 20), '')),
            coalesce(v_code, nullif(left(btrim(coalesce(p_filter, '')), 40), '')),
            false);
  end if;

  return v_out;
end $function$;

notify pgrst, 'reload schema';
