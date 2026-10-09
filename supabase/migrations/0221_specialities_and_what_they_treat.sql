-- ============================================================================
-- 0221 — Up to three specialities, the problems a doctor treats, and search
--        by problem
-- ============================================================================
-- AFTER 0220. Safe to re-run.
--
-- Decided 9 Oct 2026. A doctor had exactly one speciality and search matched
-- it exactly, so an MD physician who also looks after diabetes and thyroid was
-- found only under "General". Three changes, which are one idea:
--
--   UP TO THREE SPECIALITIES   practitioners.speciality stays the main one —
--        it still decides the examination form and where a booking is
--        counted. other_specialities holds up to two more. Nobody approves
--        them: a doctor says what they practise.
--
--   SUB-SPECIALITIES   the problems themselves — diabetes, thyroid, piles,
--        arthritis, asthma… (sub_specialities). Each sits under one
--        speciality, and may name others whose doctors commonly treat it
--        (also_under): diabetes belongs to the diabetologist, and a general
--        physician or an endocrinologist treats it too. A doctor ticks as
--        many as they treat (practitioners.sub_specialities).
--
--   SEARCH BY PROBLEM   the words patients use (intent_keywords, 0201) can
--        now say which sub-speciality they mean. "sugar ka doctor" finds, in
--        this order within each distance band: doctors who ticked diabetes
--        together with those whose main speciality is its own (a
--        diabetologist need not tick it); then doctors with that as a further
--        speciality; then doctors of an also_under speciality. So a search by
--        problem always finds someone the old search would have, and a
--        physician who says they treat it stands beside the specialist.
--
-- Six specialities that were missing are added: rheumatology, endocrinology,
-- chest, kidney (nephrology), sexual health and general surgery.
--
-- HOW THE BOT CARRIES IT. The WhatsApp bot picks "number 2" from a list and
-- asks the database again for the same list at the slot and booking steps, so
-- the list must come out the same each time. The sub-speciality therefore
-- travels in the same place the speciality code does, as 'sub:<code>', and
-- bot_bookable — the one function all three steps call — understands it.
-- ============================================================================

-- ── The missing specialities, and the sub-specialities ──────────────────────
create table if not exists sub_specialities (
  code text primary key,                       -- 'diabetes', 'piles'
  speciality text not null references speciality_names(code),   -- whose it is
  also_under text[] not null default '{}',     -- other specialities that commonly treat it
  name_en text not null,
  name_hi text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sub_specialities enable row level security;
grant select on sub_specialities to anon, authenticated;
grant insert, update on sub_specialities to authenticated;
drop policy if exists "anyone_reads_sub_specialities" on sub_specialities;
create policy "anyone_reads_sub_specialities" on sub_specialities for select using (true);
drop policy if exists "staff_insert_sub_specialities" on sub_specialities;
create policy "staff_insert_sub_specialities" on sub_specialities for insert with check (sehat_is_staff());
drop policy if exists "staff_update_sub_specialities" on sub_specialities;
create policy "staff_update_sub_specialities" on sub_specialities for update using (sehat_is_staff()) with check (sehat_is_staff());

alter table intent_keywords add column if not exists sub_speciality text references sub_specialities(code);

-- One word a patient uses. A word the matcher already knows is left under the
-- speciality it has and only told which sub-speciality it means; a new word is
-- added under the sub-speciality's own speciality.
create or replace function sehat_seed_keyword(p_term text, p_speciality text, p_sub text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_norm text := normalize_text(p_term);
begin
  if coalesce(v_norm, '') = '' then return; end if;
  if p_sub is not null then
    update intent_keywords set sub_speciality = p_sub
     where normalized_term = v_norm and intent = 'doctor' and sub_speciality is distinct from p_sub;
  end if;
  if exists (select 1 from intent_keywords where normalized_term = v_norm and intent = 'doctor') then return; end if;
  -- normalized_term and script are worked out by the table itself.
  insert into intent_keywords (term, intent, speciality, sub_speciality, weight, source)
  values (p_term, 'doctor', p_speciality, p_sub, 1.2, 'seed');
end $$;
revoke all on function sehat_seed_keyword(text, text, text) from public, anon, authenticated;

insert into speciality_names (code, name_en, name_hi, plain_hi, bookable) values
  ('RHEU', 'Rheumatology / Arthritis', 'गठिया रोग', 'गठिया और जोड़ों की सूजन के डॉक्टर', true),
  ('ENDO', 'Endocrinology / Thyroid & Hormones', 'हार्मोन रोग', 'थायरॉइड और हार्मोन के डॉक्टर', true),
  ('PULM', 'Chest & Lungs (Pulmonology)', 'छाती रोग', 'छाती और सांस के डॉक्टर', true),
  ('NEPH', 'Kidney (Nephrology)', 'किडनी रोग', 'किडनी के डॉक्टर', true),
  ('SEXO', 'Sexual Health (Sexology)', 'यौन रोग', 'यौन स्वास्थ्य के डॉक्टर', true),
  ('SURG', 'General Surgery', 'सर्जरी', 'ऑपरेशन (सर्जरी) के डॉक्टर', true)
on conflict (code) do nothing;

insert into sub_specialities (code, speciality, also_under, name_en, name_hi, sort_order) values
  ('diabetes', 'DIAB', array['GEN', 'ENDO']::text[], 'Diabetes (sugar)', 'शुगर / डायबिटीज़', 10),
  ('thyroid', 'ENDO', array['GEN', 'DIAB']::text[], 'Thyroid', 'थायरॉइड', 20),
  ('obesity', 'ENDO', array['GEN']::text[], 'Weight / obesity', 'मोटापा', 30),
  ('bp', 'CARD', array['GEN']::text[], 'High blood pressure', 'हाई बीपी', 40),
  ('cholesterol', 'CARD', array['GEN']::text[], 'Cholesterol', 'कोलेस्ट्रॉल', 50),
  ('fever', 'GEN', '{}'::text[], 'Fever / infections', 'बुखार', 60),
  ('anemia', 'GEN', '{}'::text[], 'Weakness / low blood', 'कमज़ोरी / खून की कमी', 70),
  ('arthritis', 'RHEU', array['ORTH', 'GEN']::text[], 'Arthritis / gout', 'गठिया', 80),
  ('joint_pain', 'ORTH', array['RHEU']::text[], 'Joint & knee pain', 'जोड़ों / घुटने का दर्द', 90),
  ('back_pain', 'ORTH', array['NEUR', 'PHYS']::text[], 'Back & neck pain', 'कमर / गर्दन दर्द', 100),
  ('fracture', 'ORTH', '{}'::text[], 'Fracture', 'हड्डी टूटना', 110),
  ('asthma', 'PULM', array['GEN']::text[], 'Asthma / breathing trouble', 'दमा / सांस की तकलीफ़', 120),
  ('tb', 'PULM', array['GEN']::text[], 'TB / long cough', 'टीबी / पुरानी खांसी', 130),
  ('allergy', 'SKIN', array['ENT', 'PULM', 'GEN']::text[], 'Allergy', 'एलर्जी', 140),
  ('kidney_stone', 'URO', array['SURG']::text[], 'Kidney stone', 'पथरी', 150),
  ('kidney_disease', 'NEPH', array['URO', 'GEN']::text[], 'Kidney disease / dialysis', 'किडनी की बीमारी', 160),
  ('prostate', 'URO', '{}'::text[], 'Prostate / urine trouble', 'प्रोस्टेट / पेशाब की तकलीफ़', 170),
  ('piles', 'SURG', array['GAST']::text[], 'Piles / fissure / fistula', 'बवासीर / भगंदर', 180),
  ('hernia', 'SURG', '{}'::text[], 'Hernia', 'हर्निया', 190),
  ('gallstone', 'SURG', array['GAST']::text[], 'Gallbladder stone', 'पित्त की पथरी', 200),
  ('appendix', 'SURG', '{}'::text[], 'Appendix', 'अपेंडिक्स', 210),
  ('sexual_problem', 'SEXO', array['URO', 'PSY']::text[], 'Sexual problems', 'यौन समस्या', 220),
  ('acidity', 'GAST', array['GEN']::text[], 'Acidity / gas', 'एसिडिटी / गैस', 230),
  ('liver', 'GAST', array['GEN']::text[], 'Liver / jaundice', 'लिवर / पीलिया', 240),
  ('migraine', 'NEUR', array['GEN']::text[], 'Migraine / headache', 'माइग्रेन / सिर दर्द', 250),
  ('depression', 'PSY', '{}'::text[], 'Depression / anxiety', 'डिप्रेशन / घबराहट', 260),
  ('sleep', 'PSY', array['NEUR', 'GEN']::text[], 'Sleep problems', 'नींद की समस्या', 270),
  ('deaddiction', 'PSY', '{}'::text[], 'De-addiction', 'नशा मुक्ति', 280),
  ('pcos', 'GYN', array['ENDO']::text[], 'PCOS / period problems', 'पीसीओडी / माहवारी की समस्या', 290),
  ('pregnancy', 'GYN', '{}'::text[], 'Pregnancy care', 'गर्भावस्था की देखभाल', 300),
  ('infertility', 'IVF', array['GYN']::text[], 'Infertility', 'संतान न होना', 310),
  ('acne', 'SKIN', '{}'::text[], 'Acne / pimples', 'मुंहासे', 320),
  ('hair_fall', 'SKIN', '{}'::text[], 'Hair fall', 'बाल झड़ना', 330),
  ('skin_infection', 'SKIN', '{}'::text[], 'Itching / fungal infection', 'खुजली / दाद', 340),
  ('cataract', 'EYE', '{}'::text[], 'Cataract', 'मोतियाबिंद', 350),
  ('eyesight', 'EYE', '{}'::text[], 'Eyesight / glasses', 'नज़र / चश्मा', 360),
  ('tooth_pain', 'DENT', '{}'::text[], 'Tooth pain / root canal', 'दांत दर्द / आरसीटी', 370),
  ('braces', 'DENT', '{}'::text[], 'Braces / dentures', 'ब्रेसेस / नकली दांत', 380),
  ('sinus', 'ENT', '{}'::text[], 'Sinus / tonsils', 'साइनस / टॉन्सिल', 390),
  ('hearing', 'ENT', '{}'::text[], 'Hearing loss', 'कम सुनना', 400),
  ('vaccination', 'PAED', '{}'::text[], 'Child vaccination', 'बच्चों का टीकाकरण', 410)
on conflict (code) do nothing;

-- The words patients use. sehat_seed_keyword keeps a word the matcher already
-- knows where it is and only says which sub-speciality it means; a new word
-- is added under the sub-speciality's own speciality.
select sehat_seed_keyword(t, 'RHEU', null) from unnest(array['rheumatologist', 'rheumatology', 'गठिया रोग विशेषज्ञ']::text[]) t;
select sehat_seed_keyword(t, 'ENDO', null) from unnest(array['endocrinologist', 'endocrinology', 'hormone doctor', 'हार्मोन']::text[]) t;
select sehat_seed_keyword(t, 'PULM', null) from unnest(array['chest specialist', 'chest doctor', 'pulmonologist', 'lungs', 'fefde', 'फेफड़े', 'छाती के डॉक्टर']::text[]) t;
select sehat_seed_keyword(t, 'NEPH', null) from unnest(array['nephrologist', 'nephrology', 'kidney specialist', 'किडनी के डॉक्टर']::text[]) t;
select sehat_seed_keyword(t, 'SEXO', null) from unnest(array['sexologist', 'sex specialist', 'sex doctor', 'सेक्सोलॉजिस्ट', 'यौन रोग विशेषज्ञ']::text[]) t;
select sehat_seed_keyword(t, 'SURG', null) from unnest(array['surgeon', 'general surgeon', 'surgery', 'operation', 'सर्जन', 'ऑपरेशन']::text[]) t;
select sehat_seed_keyword(t, 'DIAB', 'diabetes') from unnest(array['sugar', 'shugar', 'diabetes', 'diabetic', 'madhumeh', 'sugar ki bimari', 'शुगर', 'मधुमेह', 'डायबिटीज़', 'डायबिटीज']::text[]) t;
select sehat_seed_keyword(t, 'ENDO', 'thyroid') from unnest(array['thyroid', 'thairoid', 'thyroid problem', 'थायरॉइड', 'थायराइड']::text[]) t;
select sehat_seed_keyword(t, 'ENDO', 'obesity') from unnest(array['motapa', 'obesity', 'weight loss', 'wajan kam', 'vajan kam', 'मोटापा', 'वजन कम']::text[]) t;
select sehat_seed_keyword(t, 'CARD', 'bp') from unnest(array['bp', 'blood pressure', 'high bp', 'बीपी', 'ब्लड प्रेशर']::text[]) t;
select sehat_seed_keyword(t, 'CARD', 'cholesterol') from unnest(array['cholesterol', 'कोलेस्ट्रॉल']::text[]) t;
select sehat_seed_keyword(t, 'GEN', 'fever') from unnest(array['bukhar', 'bukhaar', 'fever', 'dengue', 'typhoid', 'malaria', 'viral', 'बुखार', 'टाइफाइड', 'डेंगू', 'मलेरिया']::text[]) t;
select sehat_seed_keyword(t, 'GEN', 'anemia') from unnest(array['khoon ki kami', 'anemia', 'anaemia', 'kamjori', 'kamzori', 'weakness', 'खून की कमी', 'कमजोरी', 'कमज़ोरी']::text[]) t;
select sehat_seed_keyword(t, 'RHEU', 'arthritis') from unnest(array['arthritis', 'gathiya', 'rheumatoid', 'gout', 'uric acid', 'jodo me sujan', 'गठिया', 'यूरिक एसिड', 'जोड़ों में सूजन']::text[]) t;
select sehat_seed_keyword(t, 'ORTH', 'joint_pain') from unnest(array['ghutne ka dard', 'ghutno me dard', 'joint pain', 'jodo ka dard', 'jodon ka dard', 'knee pain', 'घुटने का दर्द', 'घुटनों में दर्द', 'जोड़ों का दर्द']::text[]) t;
select sehat_seed_keyword(t, 'ORTH', 'back_pain') from unnest(array['back pain', 'kamar dard', 'kamar me dard', 'slip disc', 'cervical', 'sciatica', 'gardan dard', 'कमर दर्द', 'कमर में दर्द', 'गर्दन दर्द']::text[]) t;
select sehat_seed_keyword(t, 'ORTH', 'fracture') from unnest(array['fracture', 'haddi toot', 'haddi toot gayi', 'plaster', 'फ्रैक्चर', 'हड्डी टूट']::text[]) t;
select sehat_seed_keyword(t, 'PULM', 'asthma') from unnest(array['asthma', 'dama', 'saans phoolna', 'sans phoolna', 'breathing problem', 'inhaler', 'दमा', 'अस्थमा', 'सांस फूलना']::text[]) t;
select sehat_seed_keyword(t, 'PULM', 'tb') from unnest(array['tb', 'tuberculosis', 'purani khansi', 'purani khasi', 'टीबी', 'पुरानी खांसी']::text[]) t;
select sehat_seed_keyword(t, 'SKIN', 'allergy') from unnest(array['allergy', 'elergy', 'एलर्जी']::text[]) t;
select sehat_seed_keyword(t, 'URO', 'kidney_stone') from unnest(array['pathri', 'kidney stone', 'stone', 'पथरी']::text[]) t;
select sehat_seed_keyword(t, 'NEPH', 'kidney_disease') from unnest(array['dialysis', 'creatinine', 'kidney failure', 'kidney kharab', 'kidney problem', 'डायलिसिस', 'क्रिएटिनिन', 'किडनी खराब']::text[]) t;
select sehat_seed_keyword(t, 'URO', 'prostate') from unnest(array['prostate', 'peshab me jalan', 'peshab ruk ruk kar', 'urine infection', 'प्रोस्टेट', 'पेशाब में जलन']::text[]) t;
select sehat_seed_keyword(t, 'SURG', 'piles') from unnest(array['piles', 'bawasir', 'bavasir', 'fissure', 'fistula', 'bhagandar', 'बवासीर', 'भगंदर', 'फिशर']::text[]) t;
select sehat_seed_keyword(t, 'SURG', 'hernia') from unnest(array['hernia', 'हर्निया']::text[]) t;
select sehat_seed_keyword(t, 'SURG', 'gallstone') from unnest(array['gallbladder', 'gall bladder', 'gall stone', 'pitt ki pathri', 'pitte ki pathri', 'पित्त की पथरी', 'पित्त की थैली']::text[]) t;
select sehat_seed_keyword(t, 'SURG', 'appendix') from unnest(array['appendix', 'appendicitis', 'अपेंडिक्स']::text[]) t;
select sehat_seed_keyword(t, 'SEXO', 'sexual_problem') from unnest(array['sex problem', 'sexual problem', 'gupt rog', 'erectile', 'shighrapatan', 'namardi', 'nightfall', 'swapndosh', 'mardana kamzori', 'यौन समस्या', 'गुप्त रोग', 'सेक्स समस्या', 'शीघ्रपतन', 'स्वप्नदोष', 'मर्दाना कमजोरी']::text[]) t;
select sehat_seed_keyword(t, 'GAST', 'acidity') from unnest(array['acidity', 'gas', 'khatti dakar', 'pet me jalan', 'एसिडिटी', 'गैस', 'पेट में जलन']::text[]) t;
select sehat_seed_keyword(t, 'GAST', 'liver') from unnest(array['liver', 'jaundice', 'piliya', 'fatty liver', 'लिवर', 'पीलिया']::text[]) t;
select sehat_seed_keyword(t, 'NEUR', 'migraine') from unnest(array['migraine', 'maigren', 'sir dard', 'sar dard', 'headache', 'माइग्रेन', 'सिर दर्द']::text[]) t;
select sehat_seed_keyword(t, 'PSY', 'depression') from unnest(array['depression', 'anxiety', 'udasi', 'panic', 'डिप्रेशन', 'उदासी', 'एंग्जायटी']::text[]) t;
select sehat_seed_keyword(t, 'PSY', 'sleep') from unnest(array['neend nahi aati', 'nind nahi aati', 'insomnia', 'नींद नहीं आती']::text[]) t;
select sehat_seed_keyword(t, 'PSY', 'deaddiction') from unnest(array['nasha mukti', 'nasha chhodna', 'sharab chhodna', 'de addiction', 'deaddiction', 'नशा मुक्ति', 'शराब छोड़ना']::text[]) t;
select sehat_seed_keyword(t, 'GYN', 'pcos') from unnest(array['pcos', 'pcod', 'irregular periods', 'mahavari me dikkat', 'पीसीओडी', 'पीसीओएस', 'अनियमित माहवारी']::text[]) t;
select sehat_seed_keyword(t, 'GYN', 'pregnancy') from unnest(array['pregnancy', 'pregnant', 'garbhvati', 'गर्भवती', 'प्रेगनेंसी']::text[]) t;
select sehat_seed_keyword(t, 'IVF', 'infertility') from unnest(array['infertility', 'bachha nahi ho raha', 'bacha nahi ho raha', 'बांझपन', 'बच्चा नहीं हो रहा']::text[]) t;
select sehat_seed_keyword(t, 'SKIN', 'acne') from unnest(array['pimples', 'pimple', 'acne', 'muhase', 'मुंहासे', 'पिंपल']::text[]) t;
select sehat_seed_keyword(t, 'SKIN', 'hair_fall') from unnest(array['hair fall', 'baal jhadna', 'baal girna', 'ganjapan', 'बाल झड़ना', 'गंजापन']::text[]) t;
select sehat_seed_keyword(t, 'SKIN', 'skin_infection') from unnest(array['khujli', 'khujali', 'daad', 'fungal', 'ringworm', 'itching', 'खुजली', 'दाद']::text[]) t;
select sehat_seed_keyword(t, 'EYE', 'cataract') from unnest(array['cataract', 'motiabind', 'motiyabind', 'मोतियाबिंद']::text[]) t;
select sehat_seed_keyword(t, 'EYE', 'eyesight') from unnest(array['chashma', 'chasma', 'nazar kamzor', 'kam dikhna', 'चश्मा', 'नज़र कमज़ोर', 'कम दिखना']::text[]) t;
select sehat_seed_keyword(t, 'DENT', 'tooth_pain') from unnest(array['root canal', 'rct', 'daant dard', 'dant dard', 'toothache', 'दांत दर्द', 'दाँत दर्द']::text[]) t;
select sehat_seed_keyword(t, 'DENT', 'braces') from unnest(array['braces', 'denture', 'nakli daant', 'tedhe daant', 'नकली दांत', 'टेढ़े दांत']::text[]) t;
select sehat_seed_keyword(t, 'ENT', 'sinus') from unnest(array['sinus', 'tonsil', 'tonsils', 'साइनस', 'टॉन्सिल']::text[]) t;
select sehat_seed_keyword(t, 'ENT', 'hearing') from unnest(array['kam sunai', 'kam sunai dena', 'hearing loss', 'sunai nahi deta', 'कम सुनाई', 'सुनाई नहीं देता']::text[]) t;
select sehat_seed_keyword(t, 'PAED', 'vaccination') from unnest(array['tika', 'teeka', 'tikakaran', 'vaccination', 'vaccine', 'टीका', 'टीकाकरण']::text[]) t;

-- ── A doctor's further specialities and what they treat ─────────────────────
alter table practitioners add column if not exists other_specialities text[] not null default '{}';
alter table practitioners add column if not exists sub_specialities text[] not null default '{}';

-- Three specialities in all, each a real one and none twice; sub-specialities
-- from the list. Unknown codes are dropped rather than refused, so a list that
-- has since lost an entry does not stop a doctor saving their profile.
create or replace function sehat_practitioner_specialities_tidy()
returns trigger
language plpgsql set search_path = public as $$
begin
  new.other_specialities := coalesce((
    select array_agg(x order by ord) from (
      select distinct on (x) x, ord from unnest(coalesce(new.other_specialities, '{}')) with ordinality t(x, ord)
       where x is distinct from new.speciality
         and exists (select 1 from speciality_names s where s.code = x and s.bookable)
       order by x, ord) d), '{}');
  if cardinality(new.other_specialities) > 2 then
    raise exception 'A doctor can list three specialities: the main one and two more.' using errcode = 'P0001';
  end if;
  new.sub_specialities := coalesce((
    select array_agg(distinct x) from unnest(coalesce(new.sub_specialities, '{}')) x
     where exists (select 1 from sub_specialities s where s.code = x and s.is_active)), '{}');
  return new;
end $$;
drop trigger if exists practitioners_specialities_tidy on practitioners;
create trigger practitioners_specialities_tidy
  before insert or update of speciality, other_specialities, sub_specialities on practitioners
  for each row execute function sehat_practitioner_specialities_tidy();

-- The two public views carry both, at the end (a view's columns can be added
-- to, not reordered).
create or replace view public_practitioner_businesses as
 select p.id as practitioner_id,
    p.full_name,
    p.speciality,
    p.qualification,
    b.id as business_id,
    b.name as business_name,
    b.vertical,
    b.address,
    b.pin_codes,
    bp.consultation_fee,
    bp.is_primary,
    bp.discounted_fee,
    p.imr_status = any (array['matched'::text, 'confirmed'::text]) as reg_verified,
    p.other_specialities,
    p.sub_specialities
   from practitioners p
     join business_practitioners bp on bp.practitioner_id = p.id
     join businesses b on b.id = bp.business_id
  where p.status = 'active'::text and bp.status = 'active'::text and bp.role = 'doctor'::text and b.status = 'active'::text
    and coalesce(p.imr_status, 'unchecked'::text) <> 'no_match'::text;

create or replace view public_business_doctors as
 select bp.business_id,
    p.id as practitioner_id,
    p.full_name,
    p.qualification,
    p.speciality,
    bp.consultation_fee,
    bp.is_primary,
    bp.sort_order,
    bp.discounted_fee,
    p.imr_status = any (array['matched'::text, 'confirmed'::text]) as reg_verified,
    p.other_specialities,
    p.sub_specialities
   from business_practitioners bp
     join practitioners p on p.id = bp.practitioner_id
     join businesses b on b.id = bp.business_id
  where bp.role = 'doctor'::text and bp.status = 'active'::text and b.status = 'active'::text and p.status = 'active'::text
    and coalesce(p.imr_status, 'unchecked'::text) <> 'no_match'::text;

-- ── Which sub-speciality do these words mean? ───────────────────────────────
-- Whole words only, the longest phrase winning ("pitt ki pathri" over
-- "pathri"). A misspelling the matcher's fuzzy search understands still finds
-- the right speciality; it just does not narrow to the sub-speciality.
create or replace function sehat_match_sub(p_text text)
returns text
language sql stable security definer set search_path = public as $$
  select k.sub_speciality
    from intent_keywords k
    join sub_specialities s on s.code = k.sub_speciality and s.is_active
   where k.is_active and k.intent = 'doctor' and k.sub_speciality is not null
     and position(' ' || k.normalized_term || ' ' in ' ' || normalize_text(p_text) || ' ') > 0
   order by length(k.normalized_term) desc, k.weight desc, k.sub_speciality
   limit 1;
$$;
revoke all on function sehat_match_sub(text) from public, anon, authenticated;

-- The matcher's answer, told which sub-speciality was meant: the speciality
-- becomes the sub-speciality's own, and what is said back names the problem
-- ("समझ गए: थायरॉइड") rather than the speciality the word used to stand for.
create or replace function sehat_ft_with_sub(m jsonb, p_sub text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s sub_specialities;
  v_was text;
begin
  select * into s from sub_specialities where code = p_sub;
  if s.code is null then return m; end if;
  select plain_hi into v_was from speciality_names where code = m ->> 'speciality';
  return m || jsonb_build_object(
    'sub_speciality', s.code, 'sub_name_en', s.name_en, 'sub_name_hi', s.name_hi,
    'speciality', s.speciality, 'speciality_name_hi', s.name_hi,
    'reply_text', case when coalesce(v_was, '') <> '' and position(v_was in coalesce(m ->> 'reply_text', '')) > 0
                       then replace(m ->> 'reply_text', v_was, s.name_hi) else m ->> 'reply_text' end);
end $$;
revoke all on function sehat_ft_with_sub(jsonb, text) from public, anon, authenticated;

-- ── What the bot accepts as a speciality ────────────────────────────────────
-- Every bot step passes what it was given through this before searching. It
-- knew a fixed list; it now also knows the six new specialities, and lets
-- 'sub:<code>' through as it is.
create or replace function bot_speciality_code(p_value text)
returns text
language sql immutable as $function$
  select case
    when v.raw = '' then null
    when v.raw ~ 'SS-[A-Z0-9]{5}' then substring(v.raw from 'SS-[A-Z0-9]{5}')
    when v.raw ~ '^SUB:[A-Z0-9_]+$' then 'sub:' || lower(substr(v.raw, 5))
    when v.raw in ('GEN','SKIN','DENT','EYE','PAED','GYN','IVF','ORTH','CARD',
                   'ENT','GAST','NEUR','URO','ONC','PSY','DIAB','PHYS','ALT',
                   'RHEU','ENDO','PULM','NEPH','SEXO','SURG') then v.raw
    when v.raw like '%DERMAT%'  or v.raw like 'SKIN%'                        then 'SKIN'
    when v.raw like '%DENTAL%'  or v.raw like '%DENTIST%'                    then 'DENT'
    when v.raw like '%OPHTHAL%' or v.raw like 'EYE%'                         then 'EYE'
    when v.raw like '%CHILD%'   or v.raw like '%DIATRIC%'                    then 'PAED'
    when v.raw like '%GYNAEC%'  or v.raw like '%GYNEC%' or v.raw like '%MATERNITY%' then 'GYN'
    when v.raw like '%IVF%'     or v.raw like '%FERTILIT%'                   then 'IVF'
    when v.raw like '%RHEUMA%'                                               then 'RHEU'
    when v.raw like '%ORTHO%'   or v.raw like '%BONE%'                       then 'ORTH'
    when v.raw like '%CARDIO%'  or v.raw like '%HEART%'                      then 'CARD'
    when v.raw like 'ENT%'      or v.raw like '%EAR NOSE%'                   then 'ENT'
    when v.raw like '%GASTRO%'  or v.raw like '%STOMACH%'                    then 'GAST'
    when v.raw like '%NEURO%'   or v.raw like '%BRAIN%' or v.raw like '%SPINE%' then 'NEUR'
    when v.raw like '%NEPHRO%'                                               then 'NEPH'
    when v.raw like '%UROLOG%'  or v.raw like '%KIDNEY%'                     then 'URO'
    when v.raw like '%ONCOLOG%' or v.raw like '%CANCER%'                     then 'ONC'
    when v.raw like '%SEXOLOG%' or v.raw like '%SEXUAL%'                     then 'SEXO'
    when v.raw like '%PSYCH%'   or v.raw like '%MENTAL%'                     then 'PSY'
    when v.raw like '%ENDOCRIN%' or v.raw like '%THYROID%' or v.raw like '%HORMONE%' then 'ENDO'
    when v.raw like '%DIABET%'                                               then 'DIAB'
    when v.raw like '%PULMO%'   or v.raw like '%CHEST%' or v.raw like '%LUNG%' then 'PULM'
    when v.raw like '%PHYSIO%'                                               then 'PHYS'
    when v.raw like '%AYURVED%' or v.raw like '%HOMEO%' or v.raw like '%UNANI%' then 'ALT'
    when v.raw like '%SURGE%'                                                then 'SURG'
    when v.raw like '%GENERAL%' or v.raw like '%FAMILY%' or v.raw like '%PHYSICIAN%' then 'GEN'
    else null
  end
  from (select upper(btrim(coalesce(p_value, ''))) as raw) v;
$function$;

-- ── The bot's search (0105 → 0213), which the slot and booking steps share ──
create or replace function bot_bookable(p_kind text, p_filter text, p_pincode text)
returns TABLE(rn integer, business_id uuid, practitioner_id uuid, title text, subtitle text, phone text, address text, consultation_fee integer, avg_rating numeric, total_reviews bigint, area text)
language sql stable security definer set search_path = public as $function$
  with k as (
    select sehat_district_pin_codes(p_pincode) as pins, d.district_key, d.state_key
      from (select 1) one
      left join sehat_pin_district(p_pincode) d on true
  ),
  -- 0221: 'sub:<code>' asks for a sub-speciality — the one row here, else none.
  s as (
    select x.speciality, x.also_under from sub_specialities x
     where p_filter like 'sub:%' and x.code = substr(p_filter, 5) and x.is_active
  ),
  ranked as (
    select v.business_id, v.practitioner_id,
           v.full_name as title, v.business_name as subtitle,
           b.phone, b.address, v.consultation_fee,
           r.avg_rating, r.total_reviews, r.is_top_rated, b.created_at,
           case when p_filter like 'SS-%' then 1
                else sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                                       p_pincode, k.pins, k.district_key, k.state_key) end as near,
           b.own_city,
           -- How well the doctor fits what was asked: the lower, the earlier.
           case when s.speciality is null then (case when v.speciality = p_filter then 0 else 1 end)
                -- Said they treat it, or it is their own speciality: first, alike.
                when substr(p_filter, 5) = any(v.sub_specialities) or v.speciality = s.speciality then 0
                when s.speciality = any(v.other_specialities) then 1
                else 2 end as fit
      from public_practitioner_businesses v
      join businesses b on b.id = v.business_id
      left join rating_aggregate r on r.business_id = v.business_id
      cross join k
      left join s on true
     where p_kind = 'doctor'
       and (v.speciality = p_filter or p_filter = any(v.other_specialities)
            or (p_filter like 'SS-%' and b.qr_code = p_filter)
            or (s.speciality is not null and (
                  substr(p_filter, 5) = any(v.sub_specialities)
                  or v.speciality = s.speciality or s.speciality = any(v.other_specialities)
                  or v.speciality = any(s.also_under) or v.other_specialities && s.also_under)))
    union all
    select b.id, null::uuid,
           b.name, null::text,
           b.phone, b.address, 0,
           r.avg_rating, r.total_reviews, r.is_top_rated, b.created_at,
           sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                             p_pincode, k.pins, k.district_key, k.state_key),
           b.own_city, 0
      from businesses b
      left join rating_aggregate r on r.business_id = b.id
      cross join k
     where p_kind <> 'doctor'
       and b.vertical = p_filter
       and b.status = 'active'
  )
  select row_number() over (
           order by ranked.near,
                    ranked.fit,
                    coalesce(ranked.is_top_rated, false) desc,
                    ranked.avg_rating desc nulls last,
                    ranked.created_at desc nulls last,
                    ranked.business_id,
                    ranked.practitioner_id
         )::integer,
         ranked.business_id, ranked.practitioner_id,
         ranked.title, ranked.subtitle, ranked.phone, ranked.address,
         ranked.consultation_fee, ranked.avg_rating, ranked.total_reviews,
         case when ranked.near = 1 then nullif(btrim(ranked.own_city), '') end
    from ranked
   where ranked.near is not null
   order by 1
   limit 8;
$function$;

-- ── What they typed, on WhatsApp (0201 → 0213) ──────────────────────────────
create or replace function sehat_free_text_whatsapp(p_phone text, p_payload text)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_pin_hint text := nullif(btrim(split_part(coalesce(p_payload, ''), '|', 1)), '');
  v_text     text := btrim(substr(coalesce(p_payload, ''), length(split_part(coalesce(p_payload, ''), '|', 1)) + 2));
  m          jsonb;
  v_pin      text;
  v_branch   text;
  v_type     text;
  v_filter   text;
  v_list     text;
  v_log      bigint;
  v_search   bigint;
  v_route    text;
  v_out      text;
  v_sub      text;
begin
  m := match_message(v_text, v_pin_hint);
  -- 0221: the problem they named may be a sub-speciality — "sugar", "piles".
  if m ->> 'intent' = 'doctor' and not coalesce((m ->> 'is_emergency')::boolean, false) then
    v_sub := sehat_match_sub(v_text);
    if v_sub is not null then m := sehat_ft_with_sub(m, v_sub); end if;
  end if;
  if (m ->> 'place_live')::boolean is false and m ->> 'intent' is null and not coalesce((m ->> 'is_emergency')::boolean, false) then
    perform sehat_ft_note_place(m, 'whatsapp');   -- a bare "Mumbai": still interest
  end if;
  v_pin := m ->> 'pincode';
  v_branch := m ->> 'next_branch';
  -- What the normal search node takes for this branch.
  v_type := case v_branch when 'doctor_search' then 'doctor' when 'lab_booking' then 'lab_booking'
                          when 'medicine' then 'pharmacy' when 'ambulance' then 'ambulance' when 'camps' then 'camps' end;
  -- 'sub:<code>' is what the search, the slots and the booking all take, so
  -- the numbered list means the same doctors at every step.
  v_filter := case when v_branch = 'doctor_search' then coalesce('sub:' || v_sub, m ->> 'speciality') else v_type end;

  if not coalesce((m ->> 'is_emergency')::boolean, false) and (m ->> 'place_live')::boolean is false
     and m ->> 'intent' is not null then
    -- 0212: asked for somewhere we are not in yet — say so, and count it.
    perform sehat_ft_note_place(m, 'whatsapp');
    perform sehat_note_unmet_for(sehat_normalise_phone(p_phone), 'bot', coalesce(m ->> 'speciality', v_type, m ->> 'intent'), v_pin);
    insert into bot_search_log (branch, speciality, pin_code, raw_place, found)
    values (coalesce(v_type, m ->> 'intent'), case when v_type = 'doctor' then m ->> 'speciality' end, v_pin, m ->> 'location', false)
    returning id into v_search;
    v_route := 'info';
    v_out := sehat_ft_fill('not_live_place', jsonb_build_object('place', coalesce(m ->> 'location_hi', m ->> 'location'),
               'what', coalesce(m ->> 'speciality_name_hi', case m ->> 'intent' when 'lab' then 'जांच (टेस्ट) लैब' when 'medicine' then 'दवाई'
                 when 'insurance' then 'हेल्थ इंश्योरेंस' when 'camps' then 'हेल्थ कैंप' when 'ambulance' then 'एम्बुलेंस' else 'डॉक्टर' end)));
  elsif (m ->> 'is_emergency')::boolean then
    v_list := bot_ambulance(v_pin);
    v_out := sehat_ft_fill('emergency', '{}') || case when v_list is not null then E'\n\n' || v_list else '' end;
    v_route := 'emergency';
  elsif m ->> 'action' = 'proceed' then
    if v_branch = 'doctor_search' and m ->> 'speciality' is null then
      v_route := 'branch'; v_out := m ->> 'reply_text';
    elsif v_branch in ('insurance', 'medicine') then
      v_route := 'branch'; v_out := m ->> 'reply_text';
    elsif v_pin is null then
      v_route := 'ask_pin'; v_out := (m ->> 'reply_text') || E'\n' || sehat_ft_fill('ask_pin', '{}');
    else
      -- The same search the buttons run; bot_search_bookable logs unmet demand.
      v_list := bot_generic_search(v_type, v_filter, v_pin);
      insert into bot_search_log (branch, speciality, pin_code, raw_place, found)
      values (v_type, case when v_type = 'doctor' then m ->> 'speciality' end, v_pin, null, v_list is not null)
      returning id into v_search;
      if v_list is null then
        perform sehat_note_unmet_for(sehat_normalise_phone(p_phone), 'bot', coalesce(m ->> 'speciality', v_type), v_pin);
      end if;
      v_route := case when v_list is null then 'info' when v_type in ('doctor', 'lab_booking') then 'list' else 'info' end;
      v_out := (m ->> 'reply_text') || E'\n\n' || coalesce(v_list,
        sehat_ft_fill(case v_type when 'lab_booking' then 'none_lab' when 'doctor' then 'none_doctor' else 'none_other' end, '{}'));
    end if;
  elsif m ->> 'action' = 'confirm' then
    v_route := 'confirm'; v_out := m ->> 'reply_text';
  else
    v_route := 'menu'; v_out := m ->> 'reply_text';
  end if;

  v_log := sehat_ft_log('whatsapp', v_text, p_phone, null, m, v_search);

  return jsonb_build_object(
    'found', v_route in ('list', 'info', 'emergency'),
    'route', v_route,
    'text', v_out,
    'action', m ->> 'action',
    'next_branch', coalesce(v_branch, ''),
    'search_type', coalesce(v_type, ''),
    'filter_value', coalesce(v_filter, ''),
    'pincode', coalesce(v_pin, ''),
    'speciality', coalesce(m ->> 'speciality', ''),
    'target_date', coalesce(m ->> 'target_date', ''),
    'is_emergency', coalesce((m ->> 'is_emergency')::boolean, false),
    'confidence', m -> 'confidence',
    'log_id', v_log);
end $function$;

-- ── What they typed, in the app ─────────────────────────────────────────────
create or replace function sehat_match_text(p_text text, p_pin text DEFAULT NULL::text)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid uuid := auth.uid();
  m jsonb;
  v_log bigint;
  v_sub text;
begin
  if coalesce(btrim(p_text), '') = '' then raise exception 'Type what you need.' using errcode = 'P0001'; end if;
  if v_uid is not null then
    if (select count(*) from free_text_log where user_id = v_uid and created_at > now() - interval '1 minute') >= 30 then
      raise exception 'Too many searches — wait a minute.' using errcode = 'P0001';
    end if;
  elsif (select count(*) from free_text_log where channel = 'app' and user_id is null and created_at > now() - interval '1 minute') >= 300 then
    raise exception 'Too many searches — wait a minute.' using errcode = 'P0001';
  end if;
  m := match_message(p_text, p_pin);
  -- 0221: as on WhatsApp — the problem named may be a sub-speciality.
  if m ->> 'intent' = 'doctor' and not coalesce((m ->> 'is_emergency')::boolean, false) then
    v_sub := sehat_match_sub(p_text);
    if v_sub is not null then m := sehat_ft_with_sub(m, v_sub); end if;
  end if;
  if (m ->> 'place_live')::boolean is false then perform sehat_ft_note_place(m, 'app'); end if;
  v_log := sehat_ft_log('app', p_text, null, v_uid, m);
  return m || jsonb_build_object('log_id', v_log);
end $function$;

-- ── The app's and the website's search ──────────────────────────────────────
-- p_sub narrows it as 'sub:<code>' does for the bot. Dropped and made again
-- because what it returns grows; a caller that sends two arguments (the app
-- before 1.2) still works, and gets the doctor's further specialities too.
drop function if exists sehat_find_doctors(text, text);
create or replace function sehat_find_doctors(p_speciality text, p_pin_code text, p_sub text default null)
returns table(practitioner_id uuid, full_name text, speciality text, qualification text, business_id uuid,
              business_name text, address text, consultation_fee integer, is_primary boolean, nearby boolean,
              area text, discounted_fee integer, reg_verified boolean,
              other_specialities text[], sub_specialities text[])
language sql stable security definer set search_path = public as $$
  with k as (
    select sehat_district_pin_codes(p_pin_code) as pins, d.district_key, d.state_key
      from (select 1) one
      left join sehat_pin_district(p_pin_code) d on true
  ),
  s as (
    select x.speciality, x.also_under from sub_specialities x where x.code = p_sub and x.is_active
  ),
  hits as (
    select v.*, b.own_city,
           sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                             p_pin_code, k.pins, k.district_key, k.state_key) as near,
           case when s.speciality is null then (case when v.speciality = p_speciality then 0 else 1 end)
                when p_sub = any(v.sub_specialities) or v.speciality = s.speciality then 0
                when s.speciality = any(v.other_specialities) then 1
                else 2 end as fit
      from public_practitioner_businesses v
      join businesses b on b.id = v.business_id
      cross join k
      left join s on true
     where case when s.speciality is null
                then v.speciality = p_speciality or p_speciality = any(v.other_specialities)
                else p_sub = any(v.sub_specialities)
                     or v.speciality = s.speciality or s.speciality = any(v.other_specialities)
                     or v.speciality = any(s.also_under) or v.other_specialities && s.also_under end
  )
  select h.practitioner_id, h.full_name, h.speciality, h.qualification,
         h.business_id, h.business_name, h.address,
         h.consultation_fee, h.is_primary,
         h.near = 1,
         case when h.near = 1 then nullif(btrim(h.own_city), '') end,
         h.discounted_fee, h.reg_verified, h.other_specialities, h.sub_specialities
    from hits h
   where h.near is not null
   order by h.near, h.fit, h.full_name;
$$;
revoke all on function sehat_find_doctors(text, text, text) from public;
grant execute on function sehat_find_doctors(text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
