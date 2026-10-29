-- ============================================================================
-- 0292 — A post for social media every day, made for the business
-- ============================================================================
-- AFTER 0291. Safe to re-run.
--
-- Decided 29 Oct 2026 (build plan "Automatic Social Posts & Marketing Plan",
-- stage 1, SN Eye as the pilot). Every night the social-posts function makes
-- tomorrow's post for each business that has posts switched on: it picks a
-- topic from the shared calendar (or a tip for the business's speciality),
-- Claude writes the words, the render worker draws the image with the
-- business's logo, colour and photos, and the post waits in the Social Posts
-- tab. Stage 1 stops there — the owner downloads or shares it by hand. The
-- 7 PM preview (stage 2) and posting to Facebook and Instagram (stage 3) come
-- later and only add statuses.
--
-- WHAT A POST NEVER USES: anything about a patient. The function reads the
-- business's own details (name, phone, hours, speciality, site, photos) and
-- nothing else — no patients, visits, records, ABHA or ABDM tables (0287).
-- See "ABDM and privacy rules" in the build plan.
--
--   social_calendar   one list for every business: health days, festivals,
--                     seasonal topics. Admin-edited. Lunar festivals change
--                     date each year, so they are rows with a year.
--   social_settings   per business: switched on (admin / plan), paused by the
--                     owner, languages, topics to prefer or avoid.
--   social_posts      each post made: topic, words, template, image, status.
-- ============================================================================

create table if not exists social_calendar (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('health_day', 'festival', 'season')),
  -- A day item has month + day; a season item only a month (any day in it).
  -- year null = every year; a year = that year only (lunar festivals).
  month smallint not null check (month between 1 and 12),
  day smallint check (day is null or day between 1 and 31),
  year smallint check (year is null or year between 2026 and 2100),
  title_en text not null,
  title_hi text,
  -- Speciality codes (practitioners.speciality: EYE, PAED, CARD…).
  -- Empty = for every business.
  specialities text[] not null default '{}',
  -- What the post should say about it, for the writer.
  angle text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind = 'season' or day is not null)
);
create unique index if not exists social_calendar_once
  on social_calendar (kind, month, coalesce(day, 0), coalesce(year, 0), title_en);

create table if not exists social_settings (
  business_id uuid primary key references businesses(id) on delete cascade,
  -- Switched on by an admin (the pilot) or, later, by the plan add-on.
  enabled boolean not null default false,
  -- The owner's own off switch, separate from what they paid for.
  paused boolean not null default false,
  languages text not null default 'both' check (languages in ('en', 'hi', 'both')),
  -- Which specialities the posts speak for. Empty = the business's doctors'.
  focus_specialities text[] not null default '{}',
  favourite_topics text[] not null default '{}',
  blocked_topics text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  post_date date not null,
  calendar_id uuid references social_calendar(id) on delete set null,
  topic text not null,
  template text not null,
  headline_en text, subline_en text,
  headline_hi text, subline_hi text,
  badge text,
  caption text,
  hashtags text[] not null default '{}',
  photo_url text,
  image_url text,           -- 1080 × 1080, the feed post
  story_url text,           -- 1080 × 1920, Stories and WhatsApp Status
  status text not null default 'planned'
    check (status in ('planned', 'ready', 'failed', 'skipped')),
  error text,
  -- 'claude' = written by Claude and passed the safety check;
  -- 'fallback' = Claude's words failed the check twice, plain info post used.
  written_by text check (written_by in ('claude', 'fallback')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One automatic post a day per business; remaking a day replaces it.
create unique index if not exists social_posts_one_a_day on social_posts (business_id, post_date);
create index if not exists social_posts_recent on social_posts (business_id, post_date desc);

alter table social_calendar enable row level security;
alter table social_settings enable row level security;
alter table social_posts enable row level security;

-- Calendar: admins edit; the function reads it with the service role.
grant select, insert, update, delete on social_calendar to authenticated;
revoke all on social_calendar from anon;
drop policy if exists social_calendar_admin on social_calendar;
create policy social_calendar_admin on social_calendar for all
  using (sehat_is_admin()) with check (sehat_is_admin());

-- Settings: the business reads its own; the owner changes only their own
-- choices (column grants) — never `enabled`, which is what they paid for.
grant select on social_settings to authenticated;
grant insert, update, delete on social_settings to authenticated;
revoke update on social_settings from authenticated;
grant update (paused, languages, focus_specialities, favourite_topics, blocked_topics, updated_at)
  on social_settings to authenticated;
revoke all on social_settings from anon;
drop policy if exists social_settings_read on social_settings;
create policy social_settings_read on social_settings for select
  using (sehat_caller_is_business(business_id) or sehat_is_admin());
drop policy if exists social_settings_owner on social_settings;
create policy social_settings_owner on social_settings for update
  using (sehat_caller_is_owner(business_id) or sehat_is_admin())
  with check (sehat_caller_is_owner(business_id) or sehat_is_admin());
drop policy if exists social_settings_admin on social_settings;
create policy social_settings_admin on social_settings for insert
  with check (sehat_is_admin());
drop policy if exists social_settings_admin_delete on social_settings;
create policy social_settings_admin_delete on social_settings for delete
  using (sehat_is_admin());

-- Posts: the business's people read them; the owner may skip one. Making and
-- remaking go through the function.
grant select on social_posts to authenticated;
grant update (status, updated_at) on social_posts to authenticated;
revoke all on social_posts from anon;
drop policy if exists social_posts_read on social_posts;
create policy social_posts_read on social_posts for select
  using (sehat_caller_is_business(business_id) or sehat_is_admin());
drop policy if exists social_posts_owner_skips on social_posts;
create policy social_posts_owner_skips on social_posts for update
  using (sehat_caller_is_owner(business_id) or sehat_is_admin())
  with check (status in ('ready', 'skipped'));

-- The images are posts meant for the public: public, like the site's photos.
insert into storage.buckets (id, name, public) values ('social-posts', 'social-posts', true)
on conflict (id) do nothing;

-- ── The calendar ────────────────────────────────────────────────────────────
-- Fixed-date days every year, then dated lunar festivals (checked against
-- Drik Panchang, 29 Oct 2026), then seasons. More are added in admin.
insert into social_calendar (kind, month, day, year, title_en, title_hi, specialities, angle) values
  ('festival',   1,  1, null, 'New Year', 'नया साल', '{}', 'Warm New Year wishes; a health resolution in one line'),
  ('health_day', 1,  4, null, 'World Braille Day', 'विश्व ब्रेल दिवस', '{EYE}', 'Respect for people with low vision; regular eye checks prevent avoidable blindness'),
  ('festival',   1, 26, null, 'Republic Day', 'गणतंत्र दिवस', '{}', 'Republic Day greetings'),
  ('health_day', 2,  4, null, 'World Cancer Day', 'विश्व कैंसर दिवस', '{}', 'Early detection saves lives; know the warning signs'),
  ('health_day', 3,  8, null, 'International Women''s Day', 'अंतर्राष्ट्रीय महिला दिवस', '{}', 'Women''s health: make time for your own check-ups'),
  ('health_day', 3, 24, null, 'World TB Day', 'विश्व टीबी दिवस', '{}', 'A cough over two weeks needs a check; TB is curable with full treatment'),
  ('health_day', 4,  7, null, 'World Health Day', 'विश्व स्वास्थ्य दिवस', '{}', 'Small daily habits for better health'),
  ('health_day', 4, 25, null, 'World Malaria Day', 'विश्व मलेरिया दिवस', '{}', 'Stop mosquito breeding; see a doctor for fever with chills'),
  ('health_day', 5, 17, null, 'World Hypertension Day', 'विश्व उच्च रक्तचाप दिवस', '{}', 'Know your BP number; high BP often has no symptoms'),
  ('health_day', 5, 31, null, 'World No Tobacco Day', 'विश्व तंबाकू निषेध दिवस', '{}', 'Quitting tobacco helps at any age'),
  ('health_day', 6,  5, null, 'World Environment Day', 'विश्व पर्यावरण दिवस', '{}', 'Clean air and green spaces are good for health'),
  ('health_day', 6, 14, null, 'World Blood Donor Day', 'विश्व रक्तदाता दिवस', '{}', 'Donating blood saves lives; who can donate'),
  ('health_day', 6, 21, null, 'International Day of Yoga', 'अंतर्राष्ट्रीय योग दिवस', '{}', 'A few minutes of yoga a day'),
  ('health_day', 7,  1, null, 'National Doctors'' Day', 'राष्ट्रीय चिकित्सक दिवस', '{}', 'Thank you to every doctor; gratitude from the team'),
  ('health_day', 7, 28, null, 'World Hepatitis Day', 'विश्व हेपेटाइटिस दिवस', '{}', 'Hepatitis B vaccine and safe water protect the liver'),
  ('festival',   8, 15, null, 'Independence Day', 'स्वतंत्रता दिवस', '{}', 'Independence Day greetings'),
  ('health_day', 8, 25, null, 'National Eye Donation Fortnight', 'राष्ट्रीय नेत्रदान पखवाड़ा', '{EYE}', 'Eye donation gives sight; pledge and tell your family (25 Aug – 8 Sep)'),
  ('health_day', 9, 29, null, 'World Heart Day', 'विश्व हृदय दिवस', '{}', 'Walk, eat less salt, check BP and sugar'),
  ('festival',  10,  2, null, 'Gandhi Jayanti', 'गांधी जयंती', '{}', 'Gandhi Jayanti greetings; cleanliness and health'),
  ('health_day',10, 10, null, 'World Mental Health Day', 'विश्व मानसिक स्वास्थ्य दिवस', '{}', 'It is okay to ask for help; talk to someone'),
  ('health_day',10, 29, null, 'World Stroke Day', 'विश्व स्ट्रोक दिवस', '{}', 'BE FAST signs of stroke; get to hospital quickly'),
  ('health_day',11, 14, null, 'World Diabetes Day', 'विश्व मधुमेह दिवस', '{}', 'Diabetes can affect eyes, kidneys and heart; regular checks'),
  ('health_day',11, 14, null, 'Children''s Day', 'बाल दिवस', '{PAED,EYE}', 'Children''s Day greetings; healthy habits for kids'),
  ('health_day',12,  1, null, 'World AIDS Day', 'विश्व एड्स दिवस', '{}', 'Testing is simple and confidential'),
  ('festival',  12, 25, null, 'Christmas', 'क्रिसमस', '{}', 'Merry Christmas greetings'),
  -- Second Thursdays, computed for 2027.
  ('health_day', 3, 11, 2027, 'World Kidney Day', 'विश्व किडनी दिवस', '{}', 'BP and sugar control protect the kidneys'),
  ('health_day',10, 14, 2027, 'World Sight Day', 'विश्व दृष्टि दिवस', '{EYE}', 'Love your eyes: a yearly eye test for everyone'),
  -- Lunar festivals, dated.
  ('festival',  11,  8, 2026, 'Diwali', 'दीपावली', '{}', 'Happy Diwali wishes; for eye clinics, firecracker eye safety'),
  ('festival',   3, 22, 2027, 'Holi', 'होली', '{}', 'Happy Holi; use natural colours, wash colour out of eyes with clean water'),
  ('festival',  10,  9, 2027, 'Dussehra', 'दशहरा', '{}', 'Happy Dussehra wishes'),
  -- Seasons.
  ('season',    11, null, null, 'Winter dry eyes', 'सर्दियों में सूखी आंखें', '{EYE}', 'Heaters and cold wind dry the eyes; blink, drink water, see a doctor if it burns'),
  ('season',    12, null, null, 'Winter dry eyes', 'सर्दियों में सूखी आंखें', '{EYE}', 'Heaters and cold wind dry the eyes; blink, drink water, see a doctor if it burns'),
  ('season',    11, null, null, 'Smog and your eyes', 'स्मॉग और आंखें', '{EYE}', 'Smog irritates eyes; do not rub, wash with clean water, wear glasses outside'),
  ('season',    11, null, null, 'Smog and breathing', 'स्मॉग और सांस', '{}', 'Limit early-morning walks in smog; masks; see a doctor for breathlessness'),
  ('season',     1, null, null, 'Cold weather and heart', 'सर्दी और दिल', '{CARD,GEN}', 'Cold mornings raise BP; keep warm, take medicines on time'),
  ('season',     3, null, null, 'World Glaucoma Week', 'विश्व ग्लूकोमा सप्ताह', '{EYE}', 'Glaucoma steals sight silently; a check after 40'),
  ('season',     4, null, null, 'Summer heat', 'गर्मी से बचाव', '{}', 'Heat stroke signs; water, shade, light clothes'),
  ('season',     5, null, null, 'Summer heat', 'गर्मी से बचाव', '{}', 'Heat stroke signs; water, shade, light clothes'),
  ('season',     5, null, null, 'UV and your eyes', 'धूप और आंखें', '{EYE}', 'Sunglasses with UV protection outdoors'),
  ('season',     6, null, null, 'School eye check', 'स्कूल से पहले आंखों की जांच', '{EYE,PAED}', 'Children squinting or sitting close to the board need an eye test'),
  ('season',     7, null, null, 'Monsoon conjunctivitis', 'बरसात में आंख आना', '{EYE}', 'Red, sticky eyes spread fast; wash hands, do not share towels, no self-medication'),
  ('season',     8, null, null, 'Monsoon conjunctivitis', 'बरसात में आंख आना', '{EYE}', 'Red, sticky eyes spread fast; wash hands, do not share towels, no self-medication'),
  ('season',     8, null, null, 'Dengue prevention', 'डेंगू से बचाव', '{}', 'No standing water; full sleeves; see a doctor for high fever'),
  ('season',     9, null, null, 'Dengue prevention', 'डेंगू से बचाव', '{}', 'No standing water; full sleeves; see a doctor for high fever'),
  ('season',    10, null, null, 'Festival firecracker safety', 'पटाखों से आंखों की सुरक्षा', '{EYE}', 'Keep children at a distance, wear glasses; for an eye injury do not rub, come straight in')
on conflict do nothing;

-- The pilot: SN Eye's sandbox business. Where that id does not exist (prod)
-- this inserts nothing; posts are switched on there separately.
insert into social_settings (business_id, enabled, languages, focus_specialities)
select id, true, 'both', '{EYE}' from businesses where id = '08e4ba8c-cd7e-4a37-aae3-d7defb50c72f'
on conflict (business_id) do nothing;

-- Tomorrow's posts are made every day at 1:30 PM IST (08:00 UTC), so the
-- 7 PM preview (stage 2) always has something to show.
do $$
begin
  perform cron.unschedule('social-posts-plan') where exists (select 1 from cron.job where jobname = 'social-posts-plan');
  perform cron.schedule('social-posts-plan', '0 8 * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/social-posts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{"action":"plan"}'::jsonb)
    where exists (select 1 from social_settings where enabled and not paused)
  $job$);
end $$;

notify pgrst, 'reload schema';
