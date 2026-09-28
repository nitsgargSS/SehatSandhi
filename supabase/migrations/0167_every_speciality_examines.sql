-- ============================================================================
-- Sehatsandhi — an examination form for every speciality, filled by the
-- doctor or the nurse
--
-- Run AFTER 0166. Safe to re-run: fields are inserted only where the
-- (speciality, code) pair is new, so Eye and Dental (0066) and anything an
-- admin has edited since are left exactly as they are.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- 0066 built the mechanism — a speciality's examination as rows, values stored
-- per field and per site (R/L eye, tooth number) so they can be trended — and
-- filled it in for Eye and Dental only. Seventeen other doctors got nothing but
-- the free-text visit note. This adds a form for each of them, standard for
-- the speciality: what the doctor measures, as data, not prose.
--
-- The lists are a clinical starting point written from standard examination
-- practice, not a clinic's own protocol. They are data: a clinic's doctor can
-- ask for a field to be added, renamed or retired and it is a row, not a
-- release. Blood-test labs and pharmacies are not doctors and have no form.
--
-- ── WHO RECORDS IT ──────────────────────────────────────────────────────────
-- 0066/0067 let only the owner or a doctor save an examination. In most
-- clinics the nurse or optometrist takes the refraction, the weight and height,
-- the sugar reading, before the doctor sees the patient. So a nurse may now
-- record findings too — for patients they may see (0138/0149) — and recorded_by
-- says who. Diagnosis and prescription stay the doctor's.
--
-- Kinds: number (with unit and a sane range), select (fixed options), text.
-- Sites: R/L for paired organs; a field with no sites is one value.
-- ============================================================================

insert into speciality_fields (speciality, section, code, label, kind, unit, options, sites, min_value, max_value, help, sort_order) values
-- ── GEN — General / Family Doctor ───────────────────────────────────────────
('GEN','General examination','general_condition','General condition','select',null,array['Well','Unwell','Ill-looking','Distressed'],null,null,null,null,10),
('GEN','General examination','pallor','Pallor','select',null,array['Absent','Mild','Moderate','Severe'],null,null,null,null,20),
('GEN','General examination','icterus','Icterus (jaundice)','select',null,array['Absent','Present'],null,null,null,null,30),
('GEN','General examination','cyanosis','Cyanosis','select',null,array['Absent','Present'],null,null,null,null,40),
('GEN','General examination','clubbing','Clubbing','select',null,array['Absent','Present'],null,null,null,null,50),
('GEN','General examination','lymph_nodes','Lymph nodes','select',null,array['Not palpable','Palpable'],null,null,null,null,60),
('GEN','General examination','oedema','Oedema','select',null,array['None','Pedal','Generalised'],null,null,null,null,70),
('GEN','General examination','hydration','Hydration','select',null,array['Normal','Mild dehydration','Moderate dehydration','Severe dehydration'],null,null,null,null,80),
('GEN','Systemic examination','resp','Chest / respiratory','text',null,null,null,null,null,'e.g. clear, crepitations, wheeze',110),
('GEN','Systemic examination','cvs','Heart (CVS)','text',null,null,null,null,null,'e.g. S1 S2 normal, murmur',120),
('GEN','Systemic examination','abdomen','Abdomen','text',null,null,null,null,null,'e.g. soft, non-tender',130),
('GEN','Systemic examination','cns','Nervous system (CNS)','text',null,null,null,null,null,null,140),

-- ── SKIN — Dermatology ──────────────────────────────────────────────────────
('SKIN','Lesion','lesion_type','Lesion type','select',null,array['Macule','Patch','Papule','Plaque','Nodule','Vesicle','Bulla','Pustule','Wheal','Ulcer','Scale','Crust'],null,null,null,null,10),
('SKIN','Lesion','lesion_site','Site','text',null,null,null,null,null,'e.g. face, both forearms, scalp',20),
('SKIN','Lesion','distribution','Distribution','select',null,array['Localised','Generalised','Symmetrical','Dermatomal','Flexural','Extensor','Sun-exposed'],null,null,null,null,30),
('SKIN','Lesion','lesion_size','Size','number','cm',null,null,0,100,null,40),
('SKIN','Lesion','lesion_colour','Colour','text',null,null,null,null,null,null,50),
('SKIN','Lesion','itching','Itching','select',null,array['None','Mild','Moderate','Severe'],null,null,null,null,60),
('SKIN','Lesion','lesion_duration','Duration','text',null,null,null,null,null,'e.g. 2 weeks',70),
('SKIN','Hair & nails','hair','Hair / scalp','text',null,null,null,null,null,null,110),
('SKIN','Hair & nails','nails','Nails','text',null,null,null,null,null,null,120),

-- ── PAED — Child Specialist ─────────────────────────────────────────────────
('PAED','Growth','weight','Weight','number','kg',null,null,0.3,150,null,10),
('PAED','Growth','height','Height / length','number','cm',null,null,20,200,null,20),
('PAED','Growth','head_circ','Head circumference','number','cm',null,null,20,65,'Under 2 years',30),
('PAED','Growth','muac','Mid-upper arm circumference','number','cm',null,null,5,40,null,40),
('PAED','Development','development','Development','select',null,array['Age-appropriate','Delayed','Needs assessment'],null,null,null,null,110),
('PAED','Development','immunisation','Immunisation','select',null,array['Up to date','Due now','Incomplete'],null,null,null,null,120),
('PAED','Development','feeding','Feeding','select',null,array['Breastfed','Formula','Mixed','Weaned','Normal diet'],null,null,null,null,130),
('PAED','Examination','paed_exam','Examination','text',null,null,null,null,null,null,210),

-- ── GYN — Gynaecology / Maternity ───────────────────────────────────────────
('GYN','History','lmp','Last menstrual period (LMP)','text',null,null,null,null,null,'dd/mm/yyyy',10),
('GYN','History','cycle','Menstrual cycle','select',null,array['Regular','Irregular','Menopause','Pregnant'],null,null,null,null,20),
('GYN','History','gravida','Gravida','number',null,null,null,0,20,null,30),
('GYN','History','para','Para','number',null,null,null,0,20,null,40),
('GYN','History','abortions','Abortions','number',null,null,null,0,20,null,50),
('GYN','History','living','Living children','number',null,null,null,0,20,null,60),
('GYN','Antenatal','gestation','Gestation','number','weeks',null,null,0,45,null,110),
('GYN','Antenatal','fundal_height','Fundal height','number','cm',null,null,0,50,null,120),
('GYN','Antenatal','fhr','Foetal heart rate','number','bpm',null,null,60,220,null,130),
('GYN','Antenatal','presentation','Presentation','select',null,array['Cephalic','Breech','Transverse','Not assessed'],null,null,null,null,140),
('GYN','Antenatal','usg','Ultrasound finding','text',null,null,null,null,null,null,150),
('GYN','Examination','breast','Breast examination','text',null,null,null,null,null,null,210),
('GYN','Examination','pv','Per-vaginal / speculum','text',null,null,null,null,null,null,220),

-- ── IVF — Fertility ─────────────────────────────────────────────────────────
('IVF','Female','cycle_day','Cycle day','number',null,null,null,1,60,null,10),
('IVF','Female','amh','AMH','number','ng/mL',null,null,0,30,null,20),
('IVF','Female','afc','Antral follicle count','number',null,null,array['R','L'],0,60,null,30),
('IVF','Female','lead_follicle','Leading follicle','number','mm',null,array['R','L'],0,40,null,40),
('IVF','Female','endometrium','Endometrial thickness','number','mm',null,null,0,30,null,50),
('IVF','Female','protocol','Stimulation protocol','text',null,null,null,null,null,null,60),
('IVF','Male','sperm_count','Sperm count','number','million/mL',null,null,0,400,null,110),
('IVF','Male','motility','Progressive motility','number','%',null,null,0,100,null,120),
('IVF','Male','morphology','Normal morphology','number','%',null,null,0,100,null,130),

-- ── ORTH — Orthopaedics / Bones ─────────────────────────────────────────────
('ORTH','Complaint','joint','Joint / region','select',null,array['Shoulder','Elbow','Wrist','Hand','Hip','Knee','Ankle','Foot','Cervical spine','Thoracic spine','Lumbar spine','Pelvis'],null,null,null,null,10),
('ORTH','Complaint','side','Side','select',null,array['Right','Left','Both','Midline'],null,null,null,null,20),
('ORTH','Complaint','pain_score','Pain score','number','/10',null,null,0,10,null,30),
('ORTH','Examination','swelling','Swelling','select',null,array['None','Mild','Moderate','Severe'],null,null,null,null,110),
('ORTH','Examination','tenderness','Tenderness','select',null,array['Absent','Present'],null,null,null,null,120),
('ORTH','Examination','rom','Range of movement','text',null,null,null,null,null,'e.g. flexion 0–110°, painful abduction',130),
('ORTH','Examination','deformity','Deformity','text',null,null,null,null,null,null,140),
('ORTH','Examination','neurovascular','Distal neurovascular status','select',null,array['Intact','Impaired'],null,null,null,null,150),
('ORTH','Imaging','xray','X-ray finding','text',null,null,null,null,null,null,210),
('ORTH','Imaging','mri','MRI / CT finding','text',null,null,null,null,null,null,220),

-- ── CARD — Cardiology ───────────────────────────────────────────────────────
('CARD','Symptoms','chest_pain','Chest pain','select',null,array['None','Typical angina','Atypical','Non-cardiac'],null,null,null,null,10),
('CARD','Symptoms','nyha','Breathlessness (NYHA class)','select',null,array['I','II','III','IV'],null,null,null,null,20),
('CARD','Examination','heart_sounds','Heart sounds','select',null,array['Normal S1 S2','Murmur','Added sounds (S3/S4)','Irregular rhythm'],null,null,null,null,110),
('CARD','Examination','murmur','Murmur details','text',null,null,null,null,null,null,120),
('CARD','Examination','jvp','JVP','select',null,array['Normal','Raised'],null,null,null,null,130),
('CARD','Examination','card_oedema','Oedema','select',null,array['None','Pedal','Sacral','Generalised'],null,null,null,null,140),
('CARD','Tests','ecg','ECG','text',null,null,null,null,null,null,210),
('CARD','Tests','ef','Ejection fraction (Echo)','number','%',null,null,5,85,null,220),
('CARD','Tests','echo','Echo finding','text',null,null,null,null,null,null,230),
('CARD','Tests','tmt','Stress test (TMT)','select',null,array['Not done','Negative','Positive','Inconclusive'],null,null,null,null,240),

-- ── ENT — Ear, Nose, Throat ─────────────────────────────────────────────────
('ENT','Ear','tm','Ear drum','select',null,array['Normal','Retracted','Perforated','Bulging','Dull','Wax obscuring'],array['R','L'],null,null,null,10),
('ENT','Ear','ear_canal','Ear canal','select',null,array['Normal','Wax','Discharge','Inflamed','Fungal debris'],array['R','L'],null,null,null,20),
('ENT','Ear','hearing','Hearing','select',null,array['Normal','Reduced'],array['R','L'],null,null,null,30),
('ENT','Ear','rinne','Rinne test','select',null,array['Positive','Negative'],array['R','L'],null,null,null,40),
('ENT','Ear','weber','Weber test','select',null,array['Central','Lateralised right','Lateralised left'],null,null,null,null,50),
('ENT','Nose','septum','Nasal septum','select',null,array['Central','Deviated right','Deviated left'],null,null,null,null,110),
('ENT','Nose','turbinates','Turbinates','select',null,array['Normal','Hypertrophied','Pale / boggy'],null,null,null,null,120),
('ENT','Nose','nasal_discharge','Discharge','select',null,array['None','Watery','Mucoid','Purulent','Blood-stained'],null,null,null,null,130),
('ENT','Throat','tonsils','Tonsils','select',null,array['Normal','Grade 1','Grade 2','Grade 3','Grade 4','Removed'],null,null,null,null,210),
('ENT','Throat','pharynx','Pharynx','text',null,null,null,null,null,null,220),

-- ── GAST — Gastro / Stomach ─────────────────────────────────────────────────
('GAST','Abdomen','tenderness_site','Tenderness','select',null,array['None','Epigastric','Right upper','Right lower','Left upper','Left lower','Periumbilical','Generalised'],null,null,null,null,10),
('GAST','Abdomen','distension','Distension','select',null,array['None','Mild','Tense'],null,null,null,null,20),
('GAST','Abdomen','liver','Liver','select',null,array['Not palpable','Enlarged'],null,null,null,null,30),
('GAST','Abdomen','spleen','Spleen','select',null,array['Not palpable','Enlarged'],null,null,null,null,40),
('GAST','Abdomen','ascites','Ascites','select',null,array['Absent','Present'],null,null,null,null,50),
('GAST','Abdomen','bowel_sounds','Bowel sounds','select',null,array['Normal','Increased','Reduced','Absent'],null,null,null,null,60),
('GAST','Investigations','endoscopy','Endoscopy / colonoscopy','text',null,null,null,null,null,null,110),
('GAST','Investigations','usg_abd','Ultrasound abdomen','text',null,null,null,null,null,null,120),
('GAST','Investigations','lft','Liver function','text',null,null,null,null,null,null,130),

-- ── NEUR — Neuro / Brain & Spine ────────────────────────────────────────────
('NEUR','Higher functions','gcs','Glasgow Coma Scale','number','/15',null,null,3,15,null,10),
('NEUR','Higher functions','orientation','Orientation','select',null,array['Oriented','Disoriented'],null,null,null,null,20),
('NEUR','Motor','power_upper','Power — upper limb','number','/5',null,array['R','L'],0,5,null,110),
('NEUR','Motor','power_lower','Power — lower limb','number','/5',null,array['R','L'],0,5,null,120),
('NEUR','Motor','tone','Tone','select',null,array['Normal','Increased','Reduced'],array['R','L'],null,null,null,130),
('NEUR','Motor','reflexes','Reflexes','select',null,array['Normal','Brisk','Diminished','Absent'],array['R','L'],null,null,null,140),
('NEUR','Motor','plantar','Plantar response','select',null,array['Flexor','Extensor','Equivocal'],array['R','L'],null,null,null,150),
('NEUR','Other','sensation','Sensation','text',null,null,null,null,null,null,210),
('NEUR','Other','cranial_nerves','Cranial nerves','text',null,null,null,null,null,null,220),
('NEUR','Other','gait','Gait','select',null,array['Normal','Ataxic','Hemiplegic','Parkinsonian','Unable to walk'],null,null,null,null,230),
('NEUR','Other','neuro_imaging','CT / MRI finding','text',null,null,null,null,null,null,240),

-- ── URO — Urology / Kidney ──────────────────────────────────────────────────
('URO','Symptoms','ipss','Prostate symptom score (IPSS)','number','/35',null,null,0,35,null,10),
('URO','Symptoms','haematuria','Blood in urine','select',null,array['None','Microscopic','Visible'],null,null,null,null,20),
('URO','Symptoms','dysuria','Burning / pain on passing urine','select',null,array['No','Yes'],null,null,null,null,30),
('URO','Examination','renal_angle','Kidney-area tenderness','select',null,array['Absent','Present'],array['R','L'],null,null,null,110),
('URO','Examination','dre','Prostate (DRE)','select',null,array['Not done','Normal','Enlarged','Nodular / hard'],null,null,null,null,120),
('URO','Tests','usg_kub','Ultrasound KUB','text',null,null,null,null,null,null,210),
('URO','Tests','creatinine','Serum creatinine','number','mg/dL',null,null,0.1,20,null,220),
('URO','Tests','psa','PSA','number','ng/mL',null,null,0,1000,null,230),

-- ── ONC — Oncology / Cancer ─────────────────────────────────────────────────
('ONC','Disease','primary_site','Primary site','text',null,null,null,null,null,null,10),
('ONC','Disease','histology','Histology','text',null,null,null,null,null,null,20),
('ONC','Disease','stage','Stage','select',null,array['0','I','II','III','IV','Not staged'],null,null,null,null,30),
('ONC','Status','ecog','Performance status (ECOG)','number','/4',null,null,0,4,null,110),
('ONC','Treatment','treatment','Current treatment','select',null,array['Surgery','Chemotherapy','Radiotherapy','Targeted / immunotherapy','Hormonal','Palliative care','Observation'],null,null,null,null,210),
('ONC','Treatment','cycle','Cycle number','number',null,null,null,0,100,null,220),
('ONC','Treatment','response','Response','select',null,array['Complete','Partial','Stable','Progressive','Not assessed'],null,null,null,null,230),
('ONC','Treatment','toxicity','Side effects','text',null,null,null,null,null,null,240),

-- ── PSY — Psychiatry / Mental Health ────────────────────────────────────────
('PSY','Mental state','mood','Mood','select',null,array['Euthymic','Depressed','Anxious','Elevated','Irritable'],null,null,null,null,10),
('PSY','Mental state','affect','Affect','text',null,null,null,null,null,null,20),
('PSY','Mental state','thought','Thought content','text',null,null,null,null,null,null,30),
('PSY','Mental state','perception','Perception','select',null,array['No hallucinations','Hallucinations'],null,null,null,null,40),
('PSY','Mental state','insight','Insight','select',null,array['Present','Partial','Absent'],null,null,null,null,50),
('PSY','Mental state','sleep','Sleep','select',null,array['Normal','Reduced','Increased','Disturbed'],null,null,null,null,60),
('PSY','Risk & scales','risk','Risk of self-harm','select',null,array['None','Low','Moderate','High'],null,null,null,null,110),
('PSY','Risk & scales','phq9','PHQ-9 (depression)','number','/27',null,null,0,27,null,120),
('PSY','Risk & scales','gad7','GAD-7 (anxiety)','number','/21',null,null,0,21,null,130),

-- ── DIAB — Diabetologist ────────────────────────────────────────────────────
('DIAB','Sugar','fbs','Fasting sugar','number','mg/dL',null,null,20,700,null,10),
('DIAB','Sugar','ppbs','Post-meal sugar','number','mg/dL',null,null,20,900,null,20),
('DIAB','Sugar','rbs','Random sugar','number','mg/dL',null,null,20,900,null,30),
('DIAB','Sugar','hba1c','HbA1c','number','%',null,null,3,20,null,40),
('DIAB','Sugar','hypos','Low-sugar episodes since last visit','number',null,null,null,0,100,null,50),
('DIAB','Complications','foot','Foot examination','select',null,array['Normal','Callus','Ulcer','Deformity','Amputation'],array['R','L'],null,null,null,110),
('DIAB','Complications','monofilament','Monofilament sensation','select',null,array['Felt','Not felt'],array['R','L'],null,null,null,120),
('DIAB','Complications','retina','Eye screening','select',null,array['Not done','Normal','Retinopathy'],null,null,null,null,130),
('DIAB','Complications','urine_albumin','Urine albumin','text',null,null,null,null,null,null,140),

-- ── PHYS — Physiotherapy ────────────────────────────────────────────────────
('PHYS','Assessment','area','Area treated','select',null,array['Neck','Shoulder','Upper back','Lower back','Elbow','Wrist / hand','Hip','Knee','Ankle / foot','Post-surgery','Stroke / neuro rehab','Sports injury'],null,null,null,null,10),
('PHYS','Assessment','pain_score','Pain score','number','/10',null,null,0,10,null,20),
('PHYS','Assessment','rom','Range of movement','text',null,null,null,null,null,'e.g. knee flexion 0–95°',30),
('PHYS','Assessment','strength','Muscle strength (MMT)','number','/5',null,null,0,5,null,40),
('PHYS','Assessment','function','Function','select',null,array['Independent','Needs some help','Dependent'],null,null,null,null,50),
('PHYS','Session','treatment','Treatment given','text',null,null,null,null,null,'e.g. IFT, ultrasound, exercises',110),
('PHYS','Session','session_no','Session number','number',null,null,null,1,200,null,120),
('PHYS','Session','home_programme','Home exercise programme','text',null,null,null,null,null,null,130),

-- ── ALT — Ayurveda / Homeopathy ─────────────────────────────────────────────
('ALT','Assessment','prakriti','Prakriti','select',null,array['Vata','Pitta','Kapha','Vata-Pitta','Pitta-Kapha','Vata-Kapha','Sama'],null,null,null,null,10),
('ALT','Assessment','nadi','Nadi (pulse)','text',null,null,null,null,null,null,20),
('ALT','Assessment','agni','Agni (digestion)','select',null,array['Sama','Vishama','Tikshna','Manda'],null,null,null,null,30),
('ALT','Assessment','appetite','Appetite','select',null,array['Normal','Reduced','Increased'],null,null,null,null,40),
('ALT','Assessment','bowel','Bowel','select',null,array['Regular','Constipated','Loose'],null,null,null,null,50),
('ALT','Assessment','alt_sleep','Sleep','select',null,array['Sound','Disturbed','Reduced'],null,null,null,null,60),
('ALT','Homeopathy','generals','Mental & physical generals','text',null,null,null,null,null,null,110),
('ALT','Homeopathy','remedy','Constitutional remedy','text',null,null,null,null,null,null,120)
on conflict (speciality, code) do nothing;


-- ── A nurse may record an examination too ───────────────────────────────────
create or replace function sehat_save_findings(
  p_visit_id uuid, p_speciality text, p_findings jsonb, p_recorded_by uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v record; f jsonb; n integer := 0; v_unit text;
begin
  select pv.business_id, pv.patient_member_id into v
    from patient_visits pv where pv.id = p_visit_id;
  if not found then raise exception 'no such visit'; end if;
  -- 0167: owner, doctor or nurse — for a patient they may see — rather than
  -- owner or doctor only. The nurse often takes the refraction, the growth
  -- measurements or the sugar reading before the doctor sees the patient.
  if not (sehat_caller_is_clinical(v.business_id)
          and sehat_caller_sees_patient(v.business_id, v.patient_member_id)) then
    raise exception 'only the doctor or a nurse caring for this patient can record an examination'
      using errcode = 'insufficient_privilege';
  end if;

  delete from visit_findings where visit_id = p_visit_id;
  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb))
  loop
    continue when coalesce(btrim(f ->> 'text'), '') = '' and (f ->> 'num') is null;
    select sf.unit into v_unit from speciality_fields sf
     where sf.speciality = p_speciality and sf.code = f ->> 'code';
    insert into visit_findings (
      visit_id, business_id, patient_member_id, speciality,
      field_code, site, value_num, value_text, unit, recorded_by
    ) values (
      p_visit_id, v.business_id, v.patient_member_id, p_speciality,
      f ->> 'code', nullif(btrim(coalesce(f ->> 'site','')), ''),
      (nullif(btrim(coalesce(f ->> 'num','')), ''))::numeric,
      nullif(btrim(coalesce(f ->> 'text','')), ''), v_unit, p_recorded_by
    );
    n := n + 1;
  end loop;
  return n;
end $$;

notify pgrst, 'reload schema';
