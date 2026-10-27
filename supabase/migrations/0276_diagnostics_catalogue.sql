-- ============================================================================
-- 0276 — Diagnostics: every imaging and heart, lung and nerve test, grouped
-- ============================================================================
-- The Diagnostics add-on (0272) and the Diagnostic Centre plan cover X-ray,
-- ultrasound, CT, MRI, mammography, ECG, echo, TMT, Holter, PFT, EEG, NCV and
-- the like. Until now two X-rays sat under cardiology, and PFT, EEG, NCV, EMG,
-- the sleep study and hearing tests sat under "other", outside Diagnostics.
--
-- Categories stay the two codes Diagnostics has always meant:
--   radiology  — Imaging: X-ray, ultrasound & Doppler, CT, MRI, mammography,
--                bone density, contrast studies, nuclear medicine
--   cardiology — Heart, lungs & nerves: ECG, echo, TMT, Holter, ABPM, PFT,
--                sleep study, EEG, NCV, EMG, hearing tests
-- and the department becomes the group a test is listed under (X-ray, CT…).
-- A lab adds its own test under any group, or names a new one.
--
-- Each business's own copies of these tests (lab_tests.catalogue_code) move
-- with the catalogue; a test the business made itself is left alone.
-- ============================================================================

create or replace function sehat_diagnostic_group(p_code text, p_name text)
returns text language sql immutable as $$
  select case
    when p_code in ('MAMMO') then 'Mammography'
    when p_code in ('DEXA') then 'Bone density'
    when p_code in ('HSG', 'IVP', 'BARIUM') then 'Contrast studies'
    when p_code in ('PETCT') then 'Nuclear medicine'
    when p_code in ('FIBRO') or p_name ilike 'fibroscan%' then 'Ultrasound & Doppler'
    when p_name ilike 'x-ray%' or p_name ilike '%x-ray%' or p_code in ('OPG') then 'X-ray'
    when p_name ilike 'ultrasound%' or p_name ilike '%doppler%' then 'Ultrasound & Doppler'
    when p_name ilike 'ct %' or p_name ilike 'ct scan%' or p_name ilike 'hrct%' or p_name ilike 'ct angio%' or p_name ilike 'ct coronary%' then 'CT scan'
    when p_name ilike 'mri%' or p_name ilike 'mr %' or p_code = 'MRCP' then 'MRI'
    when p_code in ('ECG', 'ECHO', 'TMT', 'HOLTER', 'ABPM', 'STRESSECHO') then 'Heart'
    when p_name ilike 'pulmonary function%' or p_name ilike 'sleep study%' then 'Lungs'
    when p_name ilike 'eeg%' or p_name ilike 'nerve conduction%' or p_name ilike 'emg%' then 'Brain & nerves'
    when p_name ilike '%audiometry%' or p_name ilike 'bera%' then 'Hearing'
  end
$$;

-- Which category a catalogue test belongs in, after this migration.
create or replace function sehat_diagnostic_category(p_group text, p_old text)
returns text language sql immutable as $$
  select case
    when p_group in ('X-ray', 'Ultrasound & Doppler', 'CT scan', 'MRI', 'Mammography', 'Bone density', 'Contrast studies', 'Nuclear medicine') then 'radiology'
    when p_group in ('Heart', 'Lungs', 'Brain & nerves', 'Hearing') then 'cardiology'
    else p_old
  end
$$;

update lab_catalogue c
   set department = g.grp, category = sehat_diagnostic_category(g.grp, c.category)
  from (select code, sehat_diagnostic_group(code, name) grp from lab_catalogue) g
 where g.code = c.code and g.grp is not null and c.category <> 'pathology';

-- Tests most diagnostic centres are asked for that the catalogue lacked.
insert into lab_catalogue (code, name, category, department, sample_type, report_kind, default_price, tat_hours, parameters, sort_order)
values
  ('XRPORT',   'X-Ray — Portable / Bedside',           'radiology',  'X-ray',                null, 'narrative',  600, 2,  '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2000),
  ('CBCT',     'CBCT (Dental 3D Scan)',                'radiology',  'X-ray',                null, 'narrative', 2500, 24, '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2001),
  ('USGMSK',   'Ultrasound — Musculoskeletal',         'radiology',  'Ultrasound & Doppler', null, 'narrative', 1200, 2,  '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2002),
  ('ECHOFET',  'Fetal Echo',                           'radiology',  'Ultrasound & Doppler', null, 'narrative', 2500, 2,  '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2003),
  ('CTWHOLE',  'CT Scan — Whole Abdomen with Contrast','radiology',  'CT scan',              null, 'narrative', 5500, 24, '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2004),
  ('MRIKNEE',  'MRI — Knee',                           'radiology',  'MRI',                  null, 'narrative', 5500, 24, '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2005),
  ('MAMMOBI',  'Mammography — Both Breasts',           'radiology',  'Mammography',          null, 'narrative', 1800, 24, '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2006),
  ('HOLTER48', 'Holter Monitoring (48 h)',             'cardiology', 'Heart',                null, 'narrative', 3500, 72, '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2007),
  ('ECHOPAED', '2D Echo — Child',                      'cardiology', 'Heart',                null, 'narrative', 2000, 2,  '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2008),
  ('PFTDLCO',  'PFT with DLCO',                        'cardiology', 'Lungs',                null, 'narrative', 2500, 2,  '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2009),
  ('VEEG',     'Video EEG',                            'cardiology', 'Brain & nerves',       null, 'narrative', 4000, 24, '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2010),
  ('VEP',      'Evoked Potentials (VEP / SSEP)',       'cardiology', 'Brain & nerves',       null, 'narrative', 2500, 24, '[{"kind": "long_text", "name": "Findings"}, {"kind": "long_text", "name": "Impression"}]'::jsonb, 2011)
on conflict (code) do nothing;

-- Each business's copies of catalogue tests follow.
update lab_tests t
   set category = c.category, department = c.department
  from lab_catalogue c
 where t.catalogue_code = c.code and c.category <> 'pathology'
   and (t.category is distinct from c.category or t.department is distinct from c.department);

notify pgrst, 'reload schema';
