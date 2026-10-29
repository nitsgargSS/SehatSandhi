-- ============================================================================
-- 0293 — Social posts: one design per post, and pictures made by AI
-- ============================================================================
-- AFTER 0292. Safe to re-run.
--
-- 29 Oct 2026: the first designs (two languages stacked, a plain block of
-- text) were not good enough. A post now carries ONE language on the image,
-- a template-specific design (tips with icons, myth vs fact, a question, a
-- health day with its date, a photo, festival wishes) and a call button.
-- The image's words live in `design`; the caption stays in both languages.
--
-- Pictures: the business's own photos first; when none fits the topic, an
-- AI picture is made once per topic and kept in social_images, so every
-- clinic posting about the same thing reuses it (build plan: "one picture per
-- topic, shared"). The prompt never describes a patient, a procedure close
-- up, text or a logo.
-- ============================================================================

alter table social_posts add column if not exists design jsonb;
alter table social_posts add column if not exists image_lang text check (image_lang in ('en', 'hi'));
alter table social_posts add column if not exists photo_source text check (photo_source in ('own', 'ai'));

create table if not exists social_images (
  id uuid primary key default gen_random_uuid(),
  -- What the picture is for, normalised (lowercase topic words), so the same
  -- topic finds the same picture.
  topic_key text not null,
  prompt text not null,
  image_url text not null,
  model text not null,
  created_at timestamptz not null default now()
);
create index if not exists social_images_topic on social_images (topic_key, created_at desc);

alter table social_images enable row level security;
grant select on social_images to authenticated;
revoke all on social_images from anon;
drop policy if exists social_images_admin_reads on social_images;
create policy social_images_admin_reads on social_images for select using (sehat_is_admin());

notify pgrst, 'reload schema';
