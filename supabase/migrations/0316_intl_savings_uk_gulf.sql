-- ============================================================================
-- 0316 — International savings: United Kingdom, UAE and Saudi Arabia prices
-- ============================================================================
-- AFTER 0315. Safe to re-run.
--
-- 3 Nov 2026 research, second half (0314 has India, USA, Canada, Australia).
-- UK: private hospitals' published self-pay guide prices (Nuffield, Cleveland
-- Clinic London, Ramsay), PHIN, Which?. UAE and Saudi Arabia: hospital offer
-- pages where published (Emirates Hospital, Saudi German Hospital), else
-- medical-travel price sites; USD prices there converted at the fixed pegs
-- (3.6725 AED, 3.75 SAR). Left out as too weak: Saudi IVF (only a competitor's
-- blog) and Saudi LASIK (not clear if one eye or both). Where low = high the
-- source gave one price, not a range.
-- ============================================================================

insert into intl_price_refs (country, level, procedure_code, low, high, currency, year, source, note) values
  ('GB', null, 'cataract', 2065, 4210, 'GBP', 2026, 'https://www.nuffieldhealth.com/hospitals/bournemouth/pricing', 'one eye, standard lens'),
  ('GB', null, 'lasik', 2590, 5900, 'GBP', 2026, 'https://www.which.co.uk/reviews/laser-eye-surgery/article/laser-eye-surgery-best-and-worst-companies/laser-eye-surgery-costs', 'both eyes, ''from'' prices'),
  ('GB', null, 'dental_implant', 2800, 2950, 'GBP', 2026, 'https://www.dental-implants-london.co.uk/blog/what-are-the-dental-implants-cost-in-the-uk-2025-price-guide', '''from'' prices, with crown'),
  ('GB', null, 'knee_replacement', 11875, 18530, 'GBP', 2026, 'https://www.nuffieldhealth.com/hospitals/newcastle-upon-tyne/pricing', null),
  ('GB', null, 'hip_replacement', 16135, 18640, 'GBP', 2026, 'https://www.nuffieldhealth.com/hospitals/bournemouth/pricing', null),
  ('GB', null, 'angioplasty', 12445, 12445, 'GBP', 2026, 'https://clevelandcliniclondon.uk/patients/payments/self-pay/electrophysiology-interventional-cardiology', 'one London ''from'' price, 1 stent'),
  ('GB', null, 'heart_bypass', 20000, 28510, 'GBP', 2026, 'https://www.phin.org.uk/help/surgery-cardiac-heart', null),
  ('GB', null, 'heart_valve', 34030, 40000, 'GBP', 2026, 'https://clevelandcliniclondon.uk/patients/payments/self-pay/heart-vascular-thoracic', null),
  ('GB', null, 'ivf', 3500, 7915, 'GBP', 2026, 'https://www.treatcompare.com/ivf-cost-uk', 'clinic fees, usually without drugs'),
  ('GB', null, 'gallbladder', 6640, 10530, 'GBP', 2026, 'https://www.nuffieldhealth.com/hospitals/bournemouth/pricing', null),
  ('GB', null, 'hernia', 3860, 4725, 'GBP', 2026, 'https://www.nuffieldhealth.com/hospitals/bournemouth/pricing', null),
  ('GB', null, 'hysterectomy', 7250, 10900, 'GBP', 2026, 'https://www.nuffieldhealth.com/hospitals/newcastle-upon-tyne/pricing', null),
  ('GB', null, 'spine_fusion', 17300, 17300, 'GBP', 2026, 'https://hje.org.uk/treatments/spinal-fusion/', '''from'' price, consultant fees extra'),
  ('GB', null, 'bariatric', 8500, 14000, 'GBP', 2026, 'https://www.ramsayhealth.co.uk/treatments/weight-loss-surgery/prices', 'gastric sleeve'),
  ('GB', null, 'prostate', 9225, 9405, 'GBP', 2026, 'https://www.nuffieldhealth.com/hospitals/newcastle-upon-tyne/pricing', 'TURP'),
  ('AE', null, 'cataract', 6980, 13220, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/direction=ophthalmology/', null),
  ('AE', null, 'lasik', 3999, 7499, 'AED', 2026, 'https://emirateshospitals.ae/cost-packages/lasik-eye-surgery-package-standard/', 'both eyes'),
  ('AE', null, 'dental_implant', 4500, 8080, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/city=dubai/procedure=dental-implant/', null),
  ('AE', null, 'knee_replacement', 53250, 84470, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/procedure=knee-replacement/', null),
  ('AE', null, 'hip_replacement', 55090, 88140, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/procedure=hip-replacement/', null),
  ('AE', null, 'angioplasty', 29380, 42230, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/procedure=coronary-stenting/', null),
  ('AE', null, 'heart_bypass', 88140, 132210, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/procedure=coronary-artery-bypass-grafting/', null),
  ('AE', null, 'heart_valve', 88140, 139560, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/procedure=heart-valve-replacement/', null),
  ('AE', null, 'ivf', 25000, 35000, 'AED', 2026, 'https://www.placidway.com/search-medical-pricings/Fertility-Treatment/UAE/1', 'per cycle'),
  ('AE', null, 'gallbladder', 22040, 27540, 'AED', 2026, 'https://medigence.com/hospitals/general-surgery/laparoscopic-gall-bladder-removal/united-arab-emirates', null),
  ('AE', null, 'hernia', 15000, 40000, 'AED', 2026, 'https://www.zavis.ai/directory/pricing/category/surgical/dubai', 'Dubai, laparoscopic'),
  ('AE', null, 'hysterectomy', 23870, 42230, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/procedure=hysterectomy/', null),
  ('AE', null, 'spine_fusion', 73450, 88140, 'AED', 2026, 'https://medigence.com/hospitals/neurology/spinal-fusion-1-level/united-arab-emirates', 'single level'),
  ('AE', null, 'bariatric', 32320, 55820, 'AED', 2026, 'https://us-uk.bookimed.com/clinics/country=united-arab-emirates/procedure=sleeve-resection/', 'gastric sleeve'),
  ('AE', null, 'prostate', 22040, 27540, 'AED', 2026, 'https://medigence.com/hospitals/urology/trans-urethral-resection-of-prostrate/united-arab-emirates', 'TURP'),
  ('SA', null, 'cataract', 5999, 9000, 'SAR', 2026, 'https://dammam.saudigermanhealth.com/en/offer/cataract-extraction', null),
  ('SA', null, 'dental_implant', 3000, 7000, 'SAR', 2026, 'https://www.alwatan.com.sa/article/1182397', 'implant plus crown, Jeddah'),
  ('SA', null, 'knee_replacement', 39000, 53000, 'SAR', 2026, 'https://saudigermanhealth.com/en/offer/knee-replacement-surgery', null),
  ('SA', null, 'hip_replacement', 45000, 69000, 'SAR', 2026, 'https://riyadh.saudigermanhealth.com/en/offer/hip-replacement-surgery-0', null),
  ('SA', null, 'angioplasty', 18750, 18750, 'SAR', 2026, 'https://medigence.com/hospitals/cardiac-sciences/angioplasty/saudi-arabia', 'one hospital''s ''from'' price'),
  ('SA', null, 'heart_bypass', 75000, 75000, 'SAR', 2026, 'https://medigence.com/hospitals/cardiac-sciences/cabg/saudi-arabia', 'one hospital''s ''from'' price'),
  ('SA', null, 'heart_valve', 67500, 67500, 'SAR', 2026, 'https://medigence.com/hospitals/cardiac-sciences/avr-mvr/saudi-arabia', 'one hospital''s ''from'' price'),
  ('SA', null, 'gallbladder', 12000, 12000, 'SAR', 2026, 'https://haj.saudigermanhealth.com/en/node/4990', 'one hospital offer'),
  ('SA', null, 'hernia', 8000, 14999, 'SAR', 2026, 'https://haj.saudigermanhealth.com/en/offers', null),
  ('SA', null, 'hysterectomy', 24380, 26250, 'SAR', 2026, 'https://medigence.com/hospitals/general-surgery/abdominal-hysterectomy/saudi-arabia', null),
  ('SA', null, 'spine_fusion', 67500, 75000, 'SAR', 2026, 'https://medigence.com/hospitals/neurology/spinal-fusion-1-level/saudi-arabia', 'single level'),
  ('SA', null, 'bariatric', 11999, 16999, 'SAR', 2026, 'https://saudigermanhealth.com/en/offer/sleeve-gastrectomy-0', 'gastric sleeve'),
  ('SA', null, 'prostate', 20630, 24380, 'SAR', 2026, 'https://medigence.com/hospitals/urology/trans-urethral-resection-of-prostrate/saudi-arabia', 'TURP')
on conflict (country, procedure_code, source, low, high) do nothing;
