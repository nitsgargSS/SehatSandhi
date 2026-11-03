-- ============================================================================
-- 0319 — International: the hospital's own website, both ways
-- ============================================================================
-- AFTER 0318. Safe to re-run.
--
-- Asked 3 Nov 2026. Every business on Sehatsandhi has a website on our
-- domain (sehatsandhi.com/s/<slug>, 0282) — or its own domain on the full
-- plan. Once a hospital is listed for international patients:
--   1. the portal links to that website from the hospital's card and page
--      (catalogue: site_url — the own domain on the full plan, else /s/<slug>);
--   2. the website shows the hospital's approved photos and videos
--      (sehat_intl_site_media(key)) and a link to its International page.
-- Nothing is shown on the website before the listing, or after it is paused.
-- ============================================================================

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
        'site_url', (select case when s.tier = 'full' and s.custom_domain is not null then 'https://www.' || s.custom_domain
                                 else '/s/' || s.slug end
                       from business_sites s where s.business_id = b.id and s.is_live),
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


create or replace function sehat_intl_site_media(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when h.business_id is null then null else jsonb_build_object(
    'hospital_id', h.business_id,
    'media', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'path', m.path, 'youtube_id', m.youtube_id,
                                                           'category', m.category, 'caption', m.caption) order by m.sort, m.uploaded_at)
                       from intl_media m where m.business_id = h.business_id and m.status = 'approved'), '[]'::jsonb)) end
  from (select sehat_site_business(p_key) as id) k
  left join intl_hospitals h on h.business_id = k.id and h.status = 'listed'
$$;
revoke all on function sehat_intl_site_media(text) from public;
grant execute on function sehat_intl_site_media(text) to anon, authenticated;

notify pgrst, 'reload schema';
