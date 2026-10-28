-- ============================================================================
-- 0282 — A website for every business
-- ============================================================================
-- Decided 28 Oct 2026 (product plan: "Sehatsandhi Websites"). Every business
-- gets a site at <slug>.sehatsandhi.com — sehatsandhi.com/s/<slug> until the
-- DNS moves — and, on the own name plan, on its own domain.
--
-- What the site shows comes from two places:
--   * what Sehatsandhi already holds — name, address, phone, hours, doctors,
--     ratings, the booking QR code — read live, never copied;
--   * what the business writes for its site — business_sites.content (blocks:
--     highlights, treatments, technology, insurance, doctor's bio, social
--     links…) and site_articles. Text fields are {en, hi}.
--
-- Everything here is public by design: it is what the site prints. One
-- function, sehat_public_site, hands it out by slug or domain, so a page can
-- never reach anything the site does not show.
-- ============================================================================

create table if not exists business_sites (
  business_id uuid primary key references businesses(id) on delete cascade,
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  -- The own name plan: the hospital's domain, e.g. www.sneyeshospital.com.
  custom_domain text unique check (custom_domain is null or custom_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  is_live boolean not null default true,
  template text not null default 'clinic' check (template in ('clinic', 'hospital')),
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text,
  hero_image_url text,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists site_articles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$'),
  lang text not null default 'en' check (lang in ('en', 'hi')),
  title text not null,
  summary text,
  body text not null default '',        -- Markdown
  image_url text,
  author text,
  read_minutes integer check (read_minutes is null or read_minutes between 1 and 120),
  published_on date,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, slug)
);
create index if not exists site_articles_business_idx on site_articles (business_id, published_on desc);

alter table business_sites enable row level security;
alter table site_articles enable row level security;

-- Reads go through sehat_public_site; the business edits its own, admins any.
grant select, insert, update, delete on business_sites, site_articles to authenticated;
revoke all on business_sites, site_articles from anon;

drop policy if exists site_owner_reads on business_sites;
create policy site_owner_reads on business_sites for select
  using (sehat_caller_is_business(business_id) or sehat_is_admin());
drop policy if exists site_owner_writes on business_sites;
create policy site_owner_writes on business_sites for all
  using (sehat_caller_is_owner(business_id) or sehat_is_admin())
  with check (sehat_caller_is_owner(business_id) or sehat_is_admin());

drop policy if exists articles_owner_reads on site_articles;
create policy articles_owner_reads on site_articles for select
  using (sehat_caller_is_business(business_id) or sehat_is_admin());
drop policy if exists articles_owner_writes on site_articles;
create policy articles_owner_writes on site_articles for all
  using (sehat_caller_is_owner(business_id) or sehat_is_admin())
  with check (sehat_caller_is_owner(business_id) or sehat_is_admin());

-- Photos for the site: public, like letterheads and profile photos.
insert into storage.buckets (id, name, public) values ('site-images', 'site-images', true)
on conflict (id) do nothing;
drop policy if exists site_images_read on storage.objects;
create policy site_images_read on storage.objects for select using (bucket_id = 'site-images');
-- Path: <business id>/<file>; the business's owner (or an admin) writes there.
drop policy if exists site_images_write on storage.objects;
create policy site_images_write on storage.objects for insert to authenticated
  with check (bucket_id = 'site-images'
    and (sehat_is_admin() or sehat_caller_is_owner(nullif(split_part(name, '/', 1), '')::uuid)));
drop policy if exists site_images_change on storage.objects;
create policy site_images_change on storage.objects for update to authenticated
  using (bucket_id = 'site-images'
    and (sehat_is_admin() or sehat_caller_is_owner(nullif(split_part(name, '/', 1), '')::uuid)));
drop policy if exists site_images_delete on storage.objects;
create policy site_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'site-images'
    and (sehat_is_admin() or sehat_caller_is_owner(nullif(split_part(name, '/', 1), '')::uuid)));

-- ── What a site prints ──────────────────────────────────────────────────────
-- p_key: a slug ('sneyehospital') or a domain ('www.sneyeshospital.com').
-- p_article: one article's slug, to get its body; null lists them all.
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
             where a.business_id = s.business_id and a.slug = lower(p_article) and a.is_published);
  end if;

  return jsonb_build_object(
    'site', jsonb_build_object('slug', s.slug, 'custom_domain', s.custom_domain, 'template', s.template,
                               'brand_color', s.brand_color, 'logo_url', s.logo_url,
                               'hero_image_url', s.hero_image_url, 'content', s.content),
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
                           from site_articles a where a.business_id = s.business_id and a.is_published), '[]'::jsonb),
    'camps', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'description', c.description,
                                   'from', c.date_from, 'to', c.date_to, 'time', c.time_slot) order by c.date_from)
                           from camps_offers c
                          where c.business_id = s.business_id and c.status = 'approved'
                            and coalesce(c.date_to, c.date_from) >= current_date), '[]'::jsonb));
end $$;
revoke all on function sehat_public_site(text, text) from public;
grant execute on function sehat_public_site(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
