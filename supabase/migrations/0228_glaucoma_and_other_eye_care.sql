-- ============================================================================
-- 0228 — Glaucoma, and the rest of what an eye doctor treats
-- ============================================================================
-- AFTER 0227. Safe to re-run.
--
-- 0221 gave the eye speciality two things a doctor can say they treat:
-- cataract and eyesight. An eye hospital's first fortnight showed the gap: a
-- glaucoma surgeon had nothing to tick, and a patient typing "kala motiya"
-- was matched to no one in particular. Added here, each with the words
-- patients use for it:
--
--   glaucoma        काला मोतिया          — kala motiya, eye pressure
--   retina          पर्दे की बीमारी        — retina, diabetic eye, parde ki bimari
--   squint          भेंगापन / बच्चों की आँख — squint, lazy eye
--   cornea          आँख की पुतली / सूखापन  — cornea, dry eye
--
-- A doctor chooses these themselves in their profile; nothing is ticked for
-- anyone here.
-- ============================================================================

insert into sub_specialities (code, speciality, also_under, name_en, name_hi, sort_order) values
  ('glaucoma', 'EYE', '{}'::text[], 'Glaucoma (kala motiya)', 'काला मोतिया', 352),
  ('retina',   'EYE', '{}'::text[], 'Retina / diabetic eye', 'पर्दे की बीमारी', 354),
  ('squint',   'EYE', '{}'::text[], 'Squint / children''s eyes', 'भेंगापन / बच्चों की आँख', 356),
  ('cornea',   'EYE', '{}'::text[], 'Cornea / dry eye', 'आँख की पुतली / सूखापन', 358)
on conflict (code) do nothing;

select sehat_seed_keyword(t, 'EYE', 'glaucoma') from unnest(array[
  'glaucoma', 'glucoma', 'kala motiya', 'kala motia', 'kaala motiya', 'kala motiyabind', 'eye pressure', 'aankh ka pressure',
  'काला मोतिया', 'काला मोतियाबिंद', 'आँख का प्रेशर', 'आंख का प्रेशर']::text[]) t;
select sehat_seed_keyword(t, 'EYE', 'retina') from unnest(array[
  'retina', 'diabetic eye', 'diabetic retinopathy', 'parde ki bimari', 'aankh ka parda',
  'रेटिना', 'पर्दे की बीमारी', 'आँख का पर्दा']::text[]) t;
select sehat_seed_keyword(t, 'EYE', 'squint') from unnest(array[
  'squint', 'bhengapan', 'lazy eye', 'tirchi aankh', 'भेंगापन', 'तिरछी आँख']::text[]) t;
select sehat_seed_keyword(t, 'EYE', 'cornea') from unnest(array[
  'cornea', 'dry eye', 'aankh me sukhapan', 'aankh ki putli', 'कॉर्निया', 'आँख में सूखापन']::text[]) t;

notify pgrst, 'reload schema';
