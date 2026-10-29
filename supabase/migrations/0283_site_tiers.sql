-- ============================================================================
-- 0283 — Websites: the free page and the full site
-- ============================================================================
-- Decided 29 Oct 2026. Every business gets a FREE one-page site on
-- <slug>.sehatsandhi.com: name, logo, one photo, a short introduction, doctors
-- and fees, hours, address, phone, ratings and WhatsApp booking. The FULL
-- site — every content block, articles, font styles, and later the hospital's
-- own domain with the software on it — comes with the own name plan.
--
-- The tier is Sehatsandhi's to set, never the business's: the owner may edit
-- business_sites under RLS, so a trigger keeps tier and custom_domain as they
-- were unless an admin (or the service role, for scripts) changes them.
-- Content written for the full site is kept on a free one, just not handed
-- out, so a business that lapses and comes back finds it all still there.
--
-- SN Eye Hospital is the showcase shown to doctors: full, whatever it pays.
-- ============================================================================

alter table business_sites add column if not exists tier text not null default 'free'
  check (tier in ('free', 'full'));

create or replace function sehat_site_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if sehat_is_admin() or coalesce(auth.role(), '') = 'service_role' or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tier := 'free';
    new.custom_domain := null;
  else
    new.tier := old.tier;
    new.custom_domain := old.custom_domain;
  end if;
  return new;
end $$;

drop trigger if exists business_sites_guard on business_sites;
create trigger business_sites_guard before insert or update on business_sites
  for each row execute function sehat_site_guard();

update business_sites set tier = 'full' where slug = 'sneyehospital';

-- ── What a site prints, by tier ─────────────────────────────────────────────
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
                           from public_business_doctors d where d.business_id = s.business_id), '[]'::jsonb),
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
