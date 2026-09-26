-- ============================================================================
-- Sehatsandhi — the doctor's public page: the bot links to it correctly, the
--               doctor fills it in, and it no longer publishes their number
--
-- Run AFTER 0136. Safe to re-run.
--
-- ── THE BOT'S LINK WENT NOWHERE ─────────────────────────────────────────────
-- bot_search_bookable built every link from the CLINIC's id
-- (bot_profile_url(b.business_id, …)), but /doctor/:slug resolves a DOCTOR by
-- the id fragment at the end of the slug. No doctor has a clinic's id, so every
-- doctor link the bot sent opened "Doctor not found". A doctor's line now links
-- with the doctor's own id, the same shape as doctorUrl() in src/lib/links.ts.
-- Labs, pharmacies and the rest have no public page, so their lines carry no
-- link rather than a broken one.
--
-- ── THE DOCTOR FILLS IN THEIR PAGE ──────────────────────────────────────────
-- practitioners.photo_url existed with no way to set it. Added: about,
-- experience_years, languages. The doctor (or their clinic's owner/manager)
-- edits them from My practice → Public profile; the existing
-- practitioners_update_profile policy already allows exactly those people, and
-- 0077's guard keeps registration, status and login fields admin-only.
-- Photos go to the public 'profile-photos' bucket under <practitioner id>/.
--
-- ── IT PUBLISHED THEIR PHONE AND EMAIL ──────────────────────────────────────
-- practitioners_public_read lets anyone read an active practitioner row, and
-- the profile page selected '*' — so a doctor's mobile, email and login id were
-- one anonymous REST call away. anon now gets only the public columns.
-- ============================================================================

alter table practitioners add column if not exists about text;
alter table practitioners add column if not exists experience_years integer;
alter table practitioners add column if not exists languages text[];

do $$ begin
  alter table practitioners add constraint practitioners_about_len check (about is null or char_length(about) <= 1500);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table practitioners add constraint practitioners_experience_range
    check (experience_years is null or experience_years between 0 and 70);
exception when duplicate_object then null; end $$;

-- ── Anonymous readers see the public columns only ──────────────────────────
revoke select on practitioners from anon;
grant select (id, full_name, speciality, qualification, reg_number, photo_url, status,
              about, experience_years, languages, imr_status, created_at)
  on practitioners to anon;

-- ── Photos ──────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

drop policy if exists profile_photos_write on storage.objects;
create policy profile_photos_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos'
              and sehat_caller_may_edit_practitioner(((storage.foldername(name))[1])::uuid));
drop policy if exists profile_photos_update on storage.objects;
create policy profile_photos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos'
         and sehat_caller_may_edit_practitioner(((storage.foldername(name))[1])::uuid));
drop policy if exists profile_photos_delete on storage.objects;
create policy profile_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos'
         and sehat_caller_may_edit_practitioner(((storage.foldername(name))[1])::uuid));

-- ── The doctor's page, as doctorUrl() writes it ─────────────────────────────
create or replace function bot_doctor_url(p_id uuid, p_name text)
returns text
language sql stable security definer set search_path = public as $$
  select sehat_site_url() || '/doctor/'
      || coalesce(
           nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), ''),
           'doctor')
      || '-' || left(p_id::text, 8);
$$;

-- 0136's line, linking the doctor rather than the clinic.
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
            || case when b.practitioner_id is not null
                    then E'\n   ' || bot_doctor_url(b.practitioner_id, pr.full_name)
                    else '' end as line
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
