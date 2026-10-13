-- ============================================================================
-- 0256 — Abusive words in a review are not published
-- ============================================================================
-- AFTER 0255. Safe to re-run.
--
-- A bad review is a review: low stars and criticism stay up, and the clinic
-- cannot hide them. What is not published is abuse. A review whose words
-- contain a listed abusive word keeps its stars, but the words are held back
-- (kept, unseen, for Sehatsandhi) and the patient is asked to say what went
-- wrong in words the clinic can use. The list is a table, so words can be
-- added without a release; it is a first line, not a judge — an admin can
-- still hide a review that slips through (ratings.is_visible).
-- ============================================================================

create table if not exists review_blocked_words (word text primary key, added_at timestamptz not null default now());
create table if not exists rating_held_reviews (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid, review_text text not null, created_at timestamptz not null default now());
alter table review_blocked_words enable row level security;
alter table rating_held_reviews enable row level security;
revoke all on review_blocked_words, rating_held_reviews from anon, authenticated;

insert into review_blocked_words (word) values
  ('fuck'), ('fucking'), ('fucker'), ('motherfucker'), ('shit'), ('bullshit'), ('bitch'), ('bastard'), ('asshole'), ('dick'), ('slut'), ('whore'), ('chutiya'), ('chutiye'), ('chutia'), ('chutiyapa'), ('madarchod'), ('maderchod'), ('behenchod'), ('bhenchod'), ('benchod'), ('gandu'), ('gaandu'), ('harami'), ('haramzada'), ('haramzade'), ('haramkhor'), ('kamina'), ('kamine'), ('kamini'), ('kutiya'), ('randi'), ('bhosdike'), ('bhosdi'), ('bhosdiwale'), ('lund'), ('lauda'), ('lavde'), ('lodu'), ('jhatu'), ('jhant'), ('chod'), ('chodu'), ('चूतिया'), ('चूतिये'), ('चुतिया'), ('मादरचोद'), ('बहनचोद'), ('भेनचोद'), ('गांडू'), ('गाँडू'), ('हरामी'), ('हरामज़ादा'), ('हरामजादा'), ('हरामखोर'), ('कमीना'), ('कमीने'), ('कमीनी'), ('कुतिया'), ('रंडी'), ('भोसड़ी'), ('भोसडी'), ('लंड'), ('लौड़ा'), ('लौडा'), ('झाटू'), ('चोदू')
on conflict do nothing;

-- Latin-script words match whole words only; Devanagari ones anywhere.
create or replace function sehat_review_is_abusive(p_text text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from review_blocked_words w
     where case when w.word ~ '^[a-z]+$'
                then lower(coalesce(p_text, '')) ~ ('\m' || w.word || '\M')
                else position(w.word in coalesce(p_text, '')) > 0 end);
$$;
revoke all on function sehat_review_is_abusive(text) from public, anon, authenticated;
grant execute on function sehat_review_is_abusive(text) to service_role;

-- Whichever way a review arrives (WhatsApp, the app, the website): abusive words never reach the row.
create or replace function sehat_ratings_hold_abuse() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.review_text is not null and sehat_review_is_abusive(new.review_text) then
    insert into rating_held_reviews (rating_id, review_text) values (new.id, new.review_text);
    new.review_text := null;
  end if;
  return new;
end $$;
drop trigger if exists ratings_hold_abuse on ratings;
create trigger ratings_hold_abuse before insert or update of review_text on ratings
  for each row execute function sehat_ratings_hold_abuse();

CREATE OR REPLACE FUNCTION public.sehat_rating_add_review(p_phone text, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_text text := nullif(left(btrim(coalesce(p_text, '')), 600), '');
  v_id uuid;
begin
  if v_phone is null or v_text is null or length(v_text) < 3 then return jsonb_build_object('saved', false); end if;
  -- 0256: abusive words are not published. The stars stand; the patient is
  -- asked to say what went wrong in words the clinic can use.
  if sehat_review_is_abusive(v_text) then
    insert into rating_held_reviews (rating_id, review_text)
    select r.id, v_text from ratings r
     where r.patient_phone_hash = sehat_phone_hash(v_phone) and r.review_text is null
       and r.created_at > now() - interval '2 hours'
     order by r.created_at desc limit 1;
    return jsonb_build_object('saved', false, 'held', true, 'text',
      'आपकी रेटिंग दर्ज है। 🙏 आपके संदेश के कुछ शब्द हम प्रकाशित नहीं कर सकते।' || E'\n'
      || 'कृपया बताएं कि क्या ठीक नहीं लगा और क्या बेहतर हो सकता था — इससे क्लिनिक को सुधार करने में मदद मिलेगी।' || E'\n\n'
      || 'Your rating is saved. Some words in your message cannot be published. Please tell us what went wrong and what could be better — that helps the clinic improve.');
  end if;

  update ratings set review_text = v_text
   where id = (select r.id from ratings r
                where r.patient_phone_hash = sehat_phone_hash(v_phone) and r.review_text is null
                  and r.created_at > now() - interval '2 hours'
                order by r.created_at desc limit 1)
  returning id into v_id;
  return jsonb_build_object('saved', v_id is not null,
    'text', case when v_id is not null then 'धन्यवाद 🙏 आपका अनुभव दर्ज हो गया।' end);
end $function$;

notify pgrst, 'reload schema';
