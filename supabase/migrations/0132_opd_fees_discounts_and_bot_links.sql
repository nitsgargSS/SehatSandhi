-- ============================================================================
-- Sehatsandhi — doctors set their OPD fee and a discount; the bot shows both,
--               and its links point at the site that owns the data
--
-- Run AFTER 0131. Safe to re-run.
--
-- ── FEES (decided 26 Sep 2026) ──────────────────────────────────────────────
-- business_practitioners.consultation_fee has always been the OPD fee a doctor
-- charges at a clinic, but nothing let anyone set it after registration (which
-- does not ask), so new doctors showed no fee in the bot. Now:
--
--   consultation_fee   the regular price, per doctor per clinic
--   discounted_fee     optional; when set and below the regular price, the bot
--                      shows ~₹600~ ₹450 (WhatsApp's strike-through)
--
-- sehat_set_opd_fee sets both. The doctor may set their own, at any clinic they
-- work at; the owner or a manager may set anyone's at their clinic.
--
-- ── LINKS ───────────────────────────────────────────────────────────────────
-- bot_profile_url wrote https://sehatsandhi.com into every result, so the bot
-- running on the sandbox database sent patients to production pages that do
-- not exist. The site now comes from site_settings, one row per database:
-- production keeps the default, sandbox is pointed at the staging site. It is
-- per-database configuration — classified never_purge, NOT sync, which would
-- copy production's value over sandbox's.
-- ============================================================================

-- ── Links ───────────────────────────────────────────────────────────────────
create table if not exists site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;
revoke all on site_settings from anon, authenticated;
insert into site_settings (key, value) values ('site_url', 'https://sehatsandhi.com')
on conflict (key) do nothing;

create or replace function sehat_site_url()
returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select rtrim(value, '/') from site_settings where key = 'site_url'), 'https://sehatsandhi.com')
$$;

create or replace function bot_profile_url(p_id uuid, p_name text)
returns text
language sql stable security definer set search_path = public as $$
  select sehat_site_url() || '/doctor/'
      || coalesce(
           nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), ''),
           'listing')
      || '-' || left(p_id::text, 8);
$$;

-- ── Fees ────────────────────────────────────────────────────────────────────
alter table business_practitioners add column if not exists discounted_fee integer;
do $$ begin
  alter table business_practitioners add constraint business_practitioners_discounted_fee_check
    check (discounted_fee is null or discounted_fee >= 0);
exception when duplicate_object then null; end $$;

create or replace function sehat_set_opd_fee(
  p_business uuid, p_practitioner uuid, p_fee integer, p_discounted_fee integer default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text := sehat_caller_role(p_business);
begin
  if not (v_role in ('owner', 'manager')
          or (sehat_caller_practitioner_id() = p_practitioner and v_role is not null)) then
    raise exception 'Only the doctor, the owner or a manager can change this fee.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_fee is null or p_fee < 0 or p_fee > 100000 then
    raise exception 'Enter a fee between ₹0 and ₹1,00,000.' using errcode = 'check_violation';
  end if;
  if p_discounted_fee is not null and (p_discounted_fee < 0 or p_discounted_fee >= p_fee) then
    raise exception 'The discounted price must be less than the regular fee of ₹%.', p_fee
      using errcode = 'check_violation';
  end if;

  update business_practitioners
     set consultation_fee = p_fee, discounted_fee = p_discounted_fee
   where business_id = p_business and practitioner_id = p_practitioner;
  if not found then
    raise exception 'That doctor does not work at this business.' using errcode = 'no_data_found';
  end if;
end $$;

revoke all on function sehat_set_opd_fee(uuid, uuid, integer, integer) from public, anon;
grant execute on function sehat_set_opd_fee(uuid, uuid, integer, integer) to authenticated;

-- ── The bot's result line: 0110's, with the discount ───────────────────────
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
