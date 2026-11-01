-- ============================================================================
-- 0307 — A demo business's website shows its doctors
-- ============================================================================
-- AFTER 0306. Safe to re-run.
--
-- Asked 1 Nov 2026: a sample "Sehatsandhi Demo Hospital" to show hospitals
-- what the hospital website looks like. A demo business stays non-active
-- (pending) so it never appears to patients — not in Browse, search or the
-- WhatsApp bot. But public_business_doctors lists only active businesses'
-- doctors, so its website had none.
--
-- sehat_public_site is 0283's function unchanged except for that: for a demo
-- business that is not active, its doctors are read directly. Real businesses
-- are untouched (they always come from public_business_doctors).
-- ============================================================================

create or replace function sehat_public_site(p_key text, p_article text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  k text := lower(btrim(coalesce(p_key, '')));
  s business_sites;
  b businesses;
begin
  select * into s from business_sites
   where is_live and (slug = k or custom_domain = k or custom_domain = regexp_replace(k, '^www\.', '')
                      or 'www.' || custom_domain = k);
  if s.business_id is null then return null; end if;
  select * into b from businesses where id = s.business_id;
  -- A business patients cannot find is not on the web either; the review demo is.
  if b.status <> 'active' and not coalesce(b.is_demo, false) then return null; end if;

  if p_article is not null then
    return (select jsonb_build_object('slug', a.slug, 'lang', a.lang, 'title', a.title, 'summary', a.summary,
                                      'body', a.body, 'image_url', a.image_url, 'author', a.author,
                                      'read_minutes', a.read_minutes, 'published_on', a.published_on)
              from site_articles a
             where a.business_id = s.business_id and a.slug = lower(p_article) and a.is_published
               and s.tier = 'full');
  end if;

  return jsonb_build_object(
    'site', jsonb_build_object('slug', s.slug, 'custom_domain', s.custom_domain, 'template', s.template,
                               'brand_color', s.brand_color, 'logo_url', s.logo_url,
                               'hero_image_url', s.hero_image_url, 'tier', s.tier,
                               'content', case when s.tier = 'full' then s.content
                                               else s.content - array['doctor','highlights','treatments','treatments_title','treatments_intro',
                                                                      'not_sure','technology','testimonials','insurance','social','font','google'] end),
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'vertical', b.vertical, 'category', b.category,
                                   'address', b.address, 'phone', b.phone, 'working_hours', b.working_hours,
                                   'photo_url', b.photo_url, 'qr_code', b.qr_code,
                                   'city', b.own_city, 'district', b.own_district, 'pin_code', b.own_pin_code,
                                   'google_place_id', b.google_place_id),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('practitioner_id', d.practitioner_id,
                                   'full_name', d.full_name, 'qualification', d.qualification,
                                   'speciality', d.speciality, 'fee', coalesce(d.discounted_fee, d.consultation_fee),
                                   'reg_verified', d.reg_verified) order by d.is_primary desc, d.sort_order)
                           from (
                             select * from public_business_doctors where business_id = s.business_id
                             union all
                             -- 0307: a demo business is never active (so patients never find it),
                             -- which keeps its doctors out of public_business_doctors; its website
                             -- reads them here instead.
                             select bp.business_id, p.id, p.full_name, p.qualification, p.speciality,
                                    bp.consultation_fee, bp.is_primary, bp.sort_order, bp.discounted_fee,
                                    false, p.other_specialities, p.sub_specialities
                               from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
                              where bp.business_id = s.business_id and coalesce(b.is_demo, false) and b.status <> 'active'
                                and bp.role = 'doctor' and bp.status = 'active' and p.status = 'active'
                           ) d), '[]'::jsonb),
    'rating', (select jsonb_build_object('average', round(avg(r.overall_rating)::numeric, 1), 'count', count(*))
                 from ratings r where r.business_id = s.business_id and r.is_visible),
    'reviews', coalesce((select jsonb_agg(x) from (
                   select jsonb_build_object('rating', r.overall_rating, 'text', r.review_text, 'on', r.created_at::date) x
                     from ratings r
                    where r.business_id = s.business_id and r.is_visible and coalesce(btrim(r.review_text), '') <> ''
                    order by r.created_at desc limit 6) t), '[]'::jsonb),
    'articles', coalesce((select jsonb_agg(jsonb_build_object('slug', a.slug, 'lang', a.lang, 'title', a.title,
                                   'summary', a.summary, 'image_url', a.image_url, 'read_minutes', a.read_minutes,
                                   'published_on', a.published_on) order by a.published_on desc nulls last)
                           from site_articles a where a.business_id = s.business_id and a.is_published
                            and s.tier = 'full'), '[]'::jsonb),
    'camps', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'description', c.description,
                                   'from', c.date_from, 'to', c.date_to, 'time', c.time_slot) order by c.date_from)
                           from camps_offers c
                          where c.business_id = s.business_id and c.status = 'approved'
                            and coalesce(c.date_to, c.date_from) >= current_date), '[]'::jsonb));
end $$;
revoke all on function sehat_public_site(text, text) from public;
grant execute on function sehat_public_site(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
