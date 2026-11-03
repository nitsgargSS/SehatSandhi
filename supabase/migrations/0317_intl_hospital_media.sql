-- ============================================================================
-- 0317 — International: hospital photos and videos
-- ============================================================================
-- AFTER 0316. Safe to re-run.
--
-- Asked 3 Nov 2026: hospitals on the portal show patients real photos and
-- videos of the hospital — building, rooms, ICU, OT, equipment, food.
--
--   intl_media   one photo, uploaded video or YouTube link per row, with a
--                category, caption and order. Every item waits for a
--                Sehatsandhi check before patients see it (NMC rules: no
--                identifiable patients, no before/after, no testimonials).
--   bucket intl-media   public (these are for showing); <business id>/<file>.
--                Photos are resized in the browser before upload; videos up
--                to 50 MB; longer tours go on YouTube.
--   sehat_intl_catalogue()   now also returns each listed hospital's approved
--                media (storage paths; the page builds the public links) and
--                cover_path, the first approved photo.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intl-media', 'intl-media', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists intl_media_read on storage.objects;
create policy intl_media_read on storage.objects for select using (bucket_id = 'intl-media');
drop policy if exists intl_media_write on storage.objects;
create policy intl_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'intl-media'
    and (sehat_is_admin() or sehat_caller_is_business(nullif(split_part(name, '/', 1), '')::uuid)));
drop policy if exists intl_media_delete on storage.objects;
create policy intl_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'intl-media'
    and (sehat_is_admin() or sehat_caller_is_business(nullif(split_part(name, '/', 1), '')::uuid)));

create table if not exists intl_media (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references intl_hospitals(business_id) on delete cascade,
  kind text not null check (kind in ('photo', 'video', 'youtube')),
  path text,
  youtube_id text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  category text not null default 'other'
    check (category in ('building', 'rooms', 'icu', 'ot', 'equipment', 'food', 'lounge', 'tour', 'other')),
  caption text,
  sort integer not null default 100,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason text,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  reviewed_by_name text,
  reviewed_at timestamptz,
  check ((kind = 'youtube') = (youtube_id is not null)),
  check ((kind <> 'youtube') = (path is not null))
);
create index if not exists intl_media_biz_idx on intl_media (business_id, sort, uploaded_at);

alter table intl_media enable row level security;
drop policy if exists intl_media_rows_read on intl_media;
create policy intl_media_rows_read on intl_media for select to authenticated
  using (sehat_is_admin() or sehat_caller_is_business(business_id));
revoke all on intl_media from anon;
revoke insert, update, delete on intl_media from authenticated;
grant select on intl_media to authenticated;

create or replace function sehat_intl_media_add(p_business uuid, p_kind text, p_path text, p_youtube text,
                                                p_category text, p_caption text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_yt text;
begin
  perform sehat_intl_check(p_business);
  if not exists (select 1 from intl_hospitals where business_id = p_business) then
    raise exception 'Save your hospital details first.' using errcode = 'P0002';
  end if;
  if (select count(*) from intl_media where business_id = p_business) >= 60 then
    raise exception 'Up to 60 photos and videos. Remove some old ones first.' using errcode = 'P0001';
  end if;
  if p_kind = 'youtube' then
    -- Accept a full link or the bare id.
    v_yt := coalesce(substring(p_youtube from '(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})'),
                     substring(btrim(coalesce(p_youtube, '')) from '^([A-Za-z0-9_-]{11})$'));
    if v_yt is null then raise exception 'That does not look like a YouTube link.' using errcode = '22023'; end if;
  elsif p_kind in ('photo', 'video') then
    if split_part(coalesce(p_path, ''), '/', 1) <> p_business::text
       or not exists (select 1 from storage.objects where bucket_id = 'intl-media' and name = p_path) then
      raise exception 'The file did not upload. Please try again.' using errcode = 'P0002';
    end if;
  else
    raise exception 'Unknown kind.' using errcode = '22023';
  end if;
  insert into intl_media (business_id, kind, path, youtube_id, category, caption, sort, uploaded_by)
  values (p_business, p_kind, case when p_kind = 'youtube' then null else p_path end, v_yt,
          case when p_category in ('building', 'rooms', 'icu', 'ot', 'equipment', 'food', 'lounge', 'tour', 'other') then p_category else 'other' end,
          nullif(left(btrim(coalesce(p_caption, '')), 160), ''),
          coalesce((select max(sort) + 10 from intl_media where business_id = p_business), 100), auth.uid())
  returning id into v_id;
  perform sehat_intl_log(p_business, 'media_added', p_kind || coalesce(' · ' || nullif(btrim(coalesce(p_caption, '')), ''), ''));
  return v_id;
end $$;

-- The hospital edits caption, category or order; an edit goes back for a check.
create or replace function sehat_intl_media_edit(p_business uuid, p_id uuid, p_category text, p_caption text, p_sort integer)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m intl_media;
begin
  perform sehat_intl_check(p_business);
  select * into m from intl_media where id = p_id and business_id = p_business;
  if m.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  update intl_media set
    category = case when p_category in ('building', 'rooms', 'icu', 'ot', 'equipment', 'food', 'lounge', 'tour', 'other') then p_category else category end,
    caption = nullif(left(btrim(coalesce(p_caption, '')), 160), ''),
    sort = coalesce(p_sort, sort),
    status = case when coalesce(nullif(left(btrim(coalesce(p_caption, '')), 160), ''), '') is distinct from coalesce(m.caption, '') then 'pending' else status end
  where id = p_id;
end $$;

-- Remove: the row and its file.
create or replace function sehat_intl_media_delete(p_business uuid, p_id uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_path text;
begin
  perform sehat_intl_check(p_business);
  delete from intl_media where id = p_id and business_id = p_business returning path into v_path;
  return v_path;
end $$;

create or replace function sehat_intl_media_review(p_id uuid, p_ok boolean, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m intl_media;
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into m from intl_media where id = p_id;
  if m.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  if not p_ok and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Write the reason, so the hospital knows what to change.' using errcode = '22023';
  end if;
  update intl_media set status = case when p_ok then 'approved' else 'rejected' end,
    reason = case when p_ok then null else left(btrim(p_reason), 300) end,
    reviewed_by_name = sehat_intl_actor_name(), reviewed_at = now()
  where id = p_id;
  if not p_ok then
    perform sehat_intl_notify(m.business_id, 'hospital', 'A photo or video needs changing — Sehatsandhi International',
      array['Sehatsandhi could not show one of your ' || case m.kind when 'photo' then 'photos' else 'videos' end
              || coalesce(' ("' || m.caption || '")', '') || ' on the portal.',
            'Reason: ' || btrim(p_reason),
            'You can remove it and upload another in your dashboard → International → Photos and videos.']);
  end if;
end $$;

revoke all on function sehat_intl_media_add(uuid, text, text, text, text, text) from public, anon;
revoke all on function sehat_intl_media_edit(uuid, uuid, text, text, integer) from public, anon;
revoke all on function sehat_intl_media_delete(uuid, uuid) from public, anon;
revoke all on function sehat_intl_media_review(uuid, boolean, text) from public, anon;
grant execute on function sehat_intl_media_add(uuid, text, text, text, text, text), sehat_intl_media_edit(uuid, uuid, text, text, integer),
  sehat_intl_media_delete(uuid, uuid), sehat_intl_media_review(uuid, boolean, text) to authenticated;

-- ── Catalogue: add approved media and a cover photo ─────────────────────────
create or replace function sehat_intl_catalogue()
returns jsonb language sql stable security definer set search_path = public as $$
  with fee as (select sehat_intl_fee_pct() as pct)
  select jsonb_build_object(
    'fee_pct', (select pct from fee),
    'fx', coalesce((select value::jsonb from site_settings where key = 'intl_fx'), '{}'::jsonb),
    'procedures', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'speciality', p.speciality, 'grp', p.grp,
        'hospital_days', p.hospital_days, 'india_days', p.india_days, 'summary', p.summary, 'reports', p.reports)
        order by p.sort) from intl_procedures p where p.active), '[]'::jsonb),
    'hospitals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name,
        'city', coalesce(nullif(b.own_city, ''), nullif(b.own_district, '')),
        'state', b.own_state,
        'city_level', coalesce(h.city_level, sehat_intl_city_level(coalesce(nullif(b.own_city, ''), b.own_district))),
        'star', h.star, 'nabh', h.nabh, 'jci', h.jci, 'beds', h.beds, 'icu_beds', h.icu_beds,
        'panels', to_jsonb(h.panels), 'languages', to_jsonb(h.languages), 'specialities', to_jsonb(h.specialities),
        'about', h.about, 'photo_url', b.photo_url,
        'cover_path', (select m.path from intl_media m
                       where m.business_id = b.id and m.status = 'approved' and m.kind = 'photo'
                       order by m.sort, m.uploaded_at limit 1),
        'media', coalesce((select jsonb_agg(jsonb_build_object(
            'kind', m.kind, 'path', m.path,
            'youtube_id', m.youtube_id, 'category', m.category, 'caption', m.caption) order by m.sort, m.uploaded_at)
            from intl_media m where m.business_id = b.id and m.status = 'approved'), '[]'::jsonb),
        'nearest_airport', h.nearest_airport, 'airport_hours', h.airport_hours,
        'packages', coalesce((select jsonb_agg(jsonb_build_object(
            'procedure_code', k.procedure_code,
            'price_min', (ceil(k.price_min * (1 + (select pct from fee) / 100.0) / 100.0) * 100)::integer,
            'price_max', (ceil(k.price_max * (1 + (select pct from fee) / 100.0) / 100.0) * 100)::integer,
            'room_type', k.room_type, 'included', k.included, 'excluded', k.excluded,
            'hospital_days', k.hospital_days, 'india_days', k.india_days, 'fly_after_days', k.fly_after_days,
            'doctor_name', k.doctor_name, 'valid_until', k.valid_until))
            from intl_packages k where k.business_id = b.id and k.active and k.valid_until >= current_date), '[]'::jsonb))
        order by b.name)
        from intl_hospitals h join businesses b on b.id = h.business_id
        where h.status = 'listed' and b.status = 'active'), '[]'::jsonb)
  )
$$;

notify pgrst, 'reload schema';

-- ── G1: photos are part of the hospital checklist ───────────────────────────
-- Asked 3 Nov 2026: photos belong in the joining checklist. At least 5 photos,
-- covering the building, a patient room, the ICU and the operation theatre.
-- Sending for review needs them uploaded; listing needs them approved.
insert into intl_check_items (key, grp, label, needs_doc, needs_expiry, required, sort) values
  ('G1', 'G', 'Photos: at least 5, including the building, a patient room, the ICU and the operation theatre', false, false, true, 701)
on conflict (key) do update set grp = excluded.grp, label = excluded.label, required = excluded.required, sort = excluded.sort;

create or replace function sehat_intl_media_gap(p_business uuid, p_level text)
returns text language sql stable security definer set search_path = public as $$
  with m as (select * from intl_media where business_id = p_business and kind = 'photo'
               and status <> 'rejected' and (p_level <> 'list' or status = 'approved')),
  miss as (select string_agg(c.name, ', ' order by c.ord) as names
             from (values ('building', 'building', 1), ('rooms', 'patient room', 2), ('icu', 'ICU', 3), ('ot', 'operation theatre', 4)) c(cat, name, ord)
            where not exists (select 1 from m where m.category = c.cat))
  select case
    when (select count(*) from m) < 5 or (select names from miss) is not null then
      case when p_level = 'list' and exists (select 1 from intl_media where business_id = p_business and kind = 'photo' and status = 'pending')
             then 'Photos waiting for Sehatsandhi to check' else '' end
      || case when (select count(*) from m) < 5 then
           case when p_level = 'list' and exists (select 1 from intl_media where business_id = p_business and kind = 'photo' and status = 'pending') then '; ' else '' end
           || (select count(*) from m) || ' of 5 photos' else '' end
      || coalesce(case when (select count(*) from m) < 5 or p_level = 'list' and exists (select 1 from intl_media where business_id = p_business and kind = 'photo' and status = 'pending') then '; ' else '' end
                  || 'missing: ' || (select names from miss), '')
    end
$$;
revoke all on function sehat_intl_media_gap(uuid, text) from public, anon;

create or replace function sehat_intl_readiness(p_business uuid, p_level text default 'list')
returns jsonb language sql stable security definer set search_path = public as $$
  with h as (select checklist from intl_hospitals where business_id = p_business),
  cur as (select * from intl_documents where business_id = p_business and status <> 'replaced')
  select coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'why', w.why) order by i.sort), '[]'::jsonb)
  from intl_check_items i
  left join cur d on d.item_key = i.key
  cross join lateral (select case
      when i.key = 'G1' then nullif(sehat_intl_media_gap(p_business, p_level), '')
      when not i.needs_doc then
        case when coalesce((select (checklist->i.key->>'ok')::boolean from h), false) then null else 'Not ticked' end
      when d.id is null then 'No document uploaded'
      when d.status = 'rejected' then 'Rejected: ' || coalesce(d.reason, 'see note')
      when i.needs_expiry and d.expires is null then 'No expiry date'
      when i.needs_expiry and d.expires < current_date then 'Expired on ' || to_char(d.expires, 'DD Mon YYYY')
      when p_level = 'list' and d.status <> 'verified' then 'Waiting for Sehatsandhi to check'
      else null end as why) w
  where i.required and w.why is not null
$$;

-- A listed hospital's photos stay listed while a new one is checked; only the
-- approved ones show.
notify pgrst, 'reload schema';
