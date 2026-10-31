-- ============================================================================
-- 0303 — What a clinic's own website reads from Sehatsandhi, and what it tells us
-- ============================================================================
-- AFTER 0302. Safe to re-run.
--
-- Asked 31 Oct 2026 for SN Eye Hospital's own site (sneyeshospital.com, a
-- separate Next.js site): show the clinic's latest social posts on a Social
-- page, publish articles written in Sehatsandhi without a site release, and
-- count visits and taps so the owner sees them in Reports.
--
-- 1. sehat_site_business(key): the business behind a site key — the
--    business_sites slug or its own domain — by the same rule as
--    sehat_public_site (0282/0283): the site is live and the business active
--    (or the review demo).
-- 2. sehat_public_social(key, limit): its latest posts that have gone out —
--    published, or ready and dated today or earlier, and not waiting for the
--    owner's OK. Pictures and reels stay in the public social-posts bucket;
--    the site only links to them.
-- 3. site_articles.group_key: the English and Hindi versions of one article
--    share it, so a site can put them at /post/<group>/ and /hi/post/<group>/.
--    sehat_public_articles / sehat_public_article read them.
-- 4. clinic_site_events + sehat_site_track: page views and Call / WhatsApp /
--    Book taps on the clinic's site. Kept apart from site_events, which counts
--    Sehatsandhi's own visitors, so neither report is mixed into the other.
--    No cookies, no personal data: a random per-tab session id only.
--    sehat_site_visit_report gives the owner the numbers.
-- ============================================================================

-- ── 1. Which business a site key belongs to ────────────────────────────────
create or replace function sehat_site_business(p_key text)
returns uuid language sql stable security definer set search_path = public as $$
  select s.business_id
    from business_sites s join businesses b on b.id = s.business_id
   where s.is_live
     and (b.status = 'active' or coalesce(b.is_demo, false))
     and (s.slug = lower(btrim(coalesce(p_key, '')))
          or s.custom_domain = lower(btrim(coalesce(p_key, '')))
          or s.custom_domain = regexp_replace(lower(btrim(coalesce(p_key, ''))), '^www\.', '')
          or 'www.' || s.custom_domain = lower(btrim(coalesce(p_key, ''))))
   limit 1;
$$;
revoke all on function sehat_site_business(text) from public, anon, authenticated;

-- ── 2. Latest social posts ─────────────────────────────────────────────────
create or replace function sehat_public_social(p_key text, p_limit integer default 12)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'post_date' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', p.id, 'post_date', p.post_date, 'topic', p.topic,
               'headline_en', p.headline_en, 'headline_hi', p.headline_hi,
               'caption', p.caption, 'hashtags', p.hashtags,
               'image_url', p.image_url, 'story_url', p.story_url, 'reel_url', p.reel_url,
               'fb_post_id', p.fb_post_id, 'ig_media_id', p.ig_media_id) as x
        from social_posts p
       where p.business_id = sehat_site_business(p_key)
         and p.image_url is not null
         and (p.status = 'published'
              or (p.status = 'ready'
                  and p.post_date <= (now() at time zone 'Asia/Kolkata')::date
                  and (not coalesce(p.needs_ok, false) or p.approval = 'ok')))
       order by p.post_date desc
       limit least(greatest(coalesce(p_limit, 12), 1), 30)
    ) q;
$$;
revoke all on function sehat_public_social(text, integer) from public;
grant execute on function sehat_public_social(text, integer) to anon, authenticated;

-- ── 3. Articles in two languages ───────────────────────────────────────────
alter table site_articles add column if not exists group_key text;
alter table site_articles drop constraint if exists site_articles_group_key_check;
alter table site_articles add constraint site_articles_group_key_check
  check (group_key is null or group_key ~ '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$');
create unique index if not exists site_articles_group_lang_idx
  on site_articles (business_id, group_key, lang) where group_key is not null;

/** The published articles of a site, newest first, without their bodies. */
create or replace function sehat_public_articles(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', a.slug, 'group', coalesce(a.group_key, a.slug), 'lang', a.lang, 'title', a.title,
           'summary', a.summary, 'image_url', a.image_url, 'author', a.author,
           'read_minutes', a.read_minutes, 'published_on', a.published_on)
           order by a.published_on desc nulls last, a.created_at desc), '[]'::jsonb)
    from site_articles a
   where a.business_id = sehat_site_business(p_key) and a.is_published;
$$;
revoke all on function sehat_public_articles(text) from public;
grant execute on function sehat_public_articles(text) to anon, authenticated;

/** One article by its group (or slug) in a language, with its body. */
create or replace function sehat_public_article(p_key text, p_group text, p_lang text default 'en')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'slug', a.slug, 'group', coalesce(a.group_key, a.slug), 'lang', a.lang, 'title', a.title,
           'summary', a.summary, 'body', a.body, 'image_url', a.image_url, 'author', a.author,
           'read_minutes', a.read_minutes, 'published_on', a.published_on,
           'has_twin', exists (select 1 from site_articles t where t.business_id = a.business_id and t.is_published
                                 and t.lang <> a.lang and coalesce(t.group_key, t.slug) = coalesce(a.group_key, a.slug)))
    from site_articles a
   where a.business_id = sehat_site_business(p_key) and a.is_published
     and coalesce(a.group_key, a.slug) = lower(btrim(coalesce(p_group, '')))
     and a.lang = coalesce(nullif(p_lang, ''), 'en')
   limit 1;
$$;
revoke all on function sehat_public_article(text, text, text) from public;
grant execute on function sehat_public_article(text, text, text) to anon, authenticated;

-- ── 4. Visits and taps on the clinic's own site ────────────────────────────
create table if not exists clinic_site_events (
  id bigserial primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  event text not null check (event in ('page_view', 'call_click', 'whatsapp_click', 'book_start', 'book_sent', 'online_start', 'vision_check')),
  path text,
  lang text check (lang is null or lang in ('en', 'hi')),
  session_id text,
  device text check (device is null or device in ('mobile', 'tablet', 'desktop')),
  referrer_host text,
  created_at timestamptz not null default now()
);
create index if not exists clinic_site_events_biz_idx on clinic_site_events (business_id, created_at desc);
alter table clinic_site_events enable row level security;
-- No direct access: written by sehat_site_track, read by sehat_site_visit_report.
revoke all on clinic_site_events from anon, authenticated;
revoke all on sequence clinic_site_events_id_seq from anon, authenticated;

create or replace function sehat_site_track(
  p_key text, p_event text, p_path text default null, p_session text default null,
  p_device text default null, p_referrer text default null, p_lang text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_biz uuid := sehat_site_business(p_key);
begin
  if v_biz is null then return; end if;
  if p_event not in ('page_view', 'call_click', 'whatsapp_click', 'book_start', 'book_sent', 'online_start', 'vision_check') then return; end if;
  insert into clinic_site_events (business_id, event, path, lang, session_id, device, referrer_host)
  values (v_biz, p_event,
          left(split_part(coalesce(p_path, ''), '?', 1), 200),
          case when p_lang in ('en', 'hi') then p_lang end,
          left(p_session, 64),
          case when p_device in ('mobile', 'tablet', 'desktop') then p_device end,
          left(lower(regexp_replace(coalesce(p_referrer, ''), '^www\.', '')), 120));
end $$;
revoke all on function sehat_site_track(text, text, text, text, text, text, text) from public;
grant execute on function sehat_site_track(text, text, text, text, text, text, text) to anon, authenticated;

/** The owner's view: totals, visitors, per day, top pages and where visitors came from. */
create or replace function sehat_site_visit_report(p_business uuid, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  if not (sehat_is_admin() or sehat_caller_owns_business(p_business)) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'has_site', exists (select 1 from business_sites s where s.business_id = p_business and s.is_live),
    'totals', coalesce((select jsonb_object_agg(event, n) from (
        select event, count(*) n from clinic_site_events where business_id = p_business and created_at >= v_from group by event) t), '{}'::jsonb),
    'visitors', (select count(distinct session_id) from clinic_site_events
                  where business_id = p_business and created_at >= v_from and event = 'page_view'),
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'views', v, 'taps', k) order by d) from (
        select (created_at at time zone 'Asia/Kolkata')::date d,
               count(*) filter (where event = 'page_view') v,
               count(*) filter (where event in ('call_click', 'whatsapp_click', 'book_sent')) k
          from clinic_site_events where business_id = p_business and created_at >= v_from group by 1) t), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'views', n) order by n desc) from (
        select path, count(*) n from clinic_site_events
         where business_id = p_business and created_at >= v_from and event = 'page_view'
         group by path order by count(*) desc limit 10) t), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('host', h, 'visits', n) order by n desc) from (
        select coalesce(nullif(referrer_host, ''), 'direct') h, count(distinct session_id) n from clinic_site_events
         where business_id = p_business and created_at >= v_from and event = 'page_view'
         group by 1 order by 2 desc limit 8) t), '[]'::jsonb)
  );
end $$;
revoke all on function sehat_site_visit_report(uuid, integer) from public, anon;
grant execute on function sehat_site_visit_report(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
