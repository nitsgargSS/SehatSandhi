-- ============================================================================
-- 0314 — International: "How much could you save?" — prices abroad vs India
-- ============================================================================
-- AFTER 0313. Safe to re-run.
--
-- Asked 3 Nov 2026: show patients abroad a ballpark comparison of what a
-- treatment costs at home (self-pay) and in India, by country, from a drop-
-- down. Not quotes: every figure comes from a published page, kept with its
-- link and year, and the page says so.
--
--   intl_countries     the countries in the drop-down, with their currency.
--   intl_price_refs    one published price range: country ('IN' for India),
--                      procedure, low–high in that currency, year, source URL.
--                      For India, level says metro / regional / smaller / india.
--   sehat_intl_savings()  everything the page needs, with exchange rates
--                      (site_settings intl_fx, rupees per unit; intl_fx_date).
-- Admins edit the figures (RLS); the seed below is the 3 Nov 2026 research.
-- ============================================================================

create table if not exists intl_countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  sort integer not null default 100,
  active boolean not null default true
);

create table if not exists intl_price_refs (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  level text check (level in ('metro', 'regional', 'smaller', 'india')),
  procedure_code text not null references intl_procedures(code),
  low numeric(14,2) not null check (low > 0),
  high numeric(14,2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  year integer not null check (year between 2015 and 2100),
  source text not null check (source ~ '^https?://'),
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (high >= low),
  unique (country, procedure_code, source, low, high)
);
create index if not exists intl_price_refs_idx on intl_price_refs (country, procedure_code) where active;

alter table intl_countries enable row level security;
alter table intl_price_refs enable row level security;
drop policy if exists intl_countries_read on intl_countries;
create policy intl_countries_read on intl_countries for select using (true);
drop policy if exists intl_countries_admin on intl_countries;
create policy intl_countries_admin on intl_countries for all to authenticated using (sehat_is_admin()) with check (sehat_is_admin());
drop policy if exists intl_price_refs_read on intl_price_refs;
create policy intl_price_refs_read on intl_price_refs for select using (true);
drop policy if exists intl_price_refs_admin on intl_price_refs;
create policy intl_price_refs_admin on intl_price_refs for all to authenticated using (sehat_is_admin()) with check (sehat_is_admin());
grant select on intl_countries, intl_price_refs to anon, authenticated;
grant insert, update, delete on intl_countries, intl_price_refs to authenticated;

insert into site_settings (key, value) values ('intl_fx_date', '') on conflict (key) do nothing;

create or replace function sehat_intl_savings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fx', coalesce((select value::jsonb from site_settings where key = 'intl_fx'), '{}'::jsonb),
    'fx_date', (select nullif(value, '') from site_settings where key = 'intl_fx_date'),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'currency', currency) order by sort, name)
                           from intl_countries c where active
                             and exists (select 1 from intl_price_refs r where r.country = c.code and r.active)), '[]'::jsonb),
    'procedures', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name) order by sort)
                            from intl_procedures where active), '[]'::jsonb),
    'refs', coalesce((select jsonb_agg(jsonb_build_object(
                        'country', country, 'level', level, 'procedure_code', procedure_code, 'low', low, 'high', high,
                        'currency', currency, 'year', year, 'source', source, 'note', note))
                      from intl_price_refs where active), '[]'::jsonb))
$$;
revoke all on function sehat_intl_savings() from public;
grant execute on function sehat_intl_savings() to anon, authenticated;

-- Exchange rates also get a date, set with them.
create or replace function sehat_intl_admin_settings(p_fee numeric, p_fx jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 30 then raise exception 'The fee is 0 to 30%%.' using errcode = '22023'; end if;
  if p_fx is null or jsonb_typeof(p_fx) <> 'object' then raise exception 'Rates must be a list.' using errcode = '22023'; end if;
  insert into site_settings (key, value) values ('intl_fee_pct', p_fee::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into site_settings (key, value) values ('intl_fx', p_fx::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into site_settings (key, value) values ('intl_fx_date', to_char(current_date, 'DD Mon YYYY'))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ── Seed ────────────────────────────────────────────────────────────────────
insert into intl_countries (code, name, currency, sort) values
  ('US', 'United States', 'USD', 10), ('GB', 'United Kingdom', 'GBP', 20), ('CA', 'Canada', 'CAD', 30),
  ('AU', 'Australia', 'AUD', 40), ('AE', 'United Arab Emirates', 'AED', 50), ('SA', 'Saudi Arabia', 'SAR', 60)
on conflict (code) do update set name = excluded.name, currency = excluded.currency, sort = excluded.sort;

-- Exchange rates of 3 Nov 2026 (open.er-api.com), rupees per unit — only
-- where an admin has not set them yet.
update site_settings set value = '{"USD":94.93,"GBP":127.28,"EUR":106.29,"CAD":67.89,"AUD":66.49,"AED":25.85,"SAR":25.32,"NPR":0.63,"BDT":0.76}', updated_at = now()
 where key = 'intl_fx' and value in ('', '{}');
update site_settings set value = '03 Nov 2026', updated_at = now()
 where key = 'intl_fx_date' and value = '';

-- 3 Nov 2026 research: India (private hospital and aggregator package prices;
-- government CGHS rates and NPPA implant/stent caps left out as they are not
-- what a foreign patient pays), USA, Canada, Australia. Australian figures are
-- Medibank hospital charges only — doctors' fees are extra.
insert into intl_price_refs (country, level, procedure_code, low, high, currency, year, source, note) values
  ('IN', 'metro', 'cataract', 32500, 39000, 'INR', 2026, 'https://www.pristyncare.com/cost/cataract/', null),
  ('IN', 'regional', 'cataract', 20000, 32000, 'INR', 2026, 'https://www.pristyncare.com/chandigarh/cost/cataract/', 'Chandigarh, lens extra'),
  ('IN', 'metro', 'cataract', 10500, 120000, 'INR', 2026, 'https://bajajfinservhealth.in/surgeries/cost/cataract-surgery-cost-in-india', 'Delhi NCR'),
  ('IN', 'regional', 'cataract', 18000, 26000, 'INR', 2026, 'https://bajajfinservhealth.in/surgeries/cost/cataract-surgery-cost-in-india', 'Jaipur'),
  ('IN', 'smaller', 'cataract', 10000, 90000, 'INR', 2026, 'https://eyemantra.in/haryana/hisar/cataract-surgery-cost-hisar/', 'Hisar'),
  ('IN', 'metro', 'lasik', 30000, 70000, 'INR', 2026, 'https://www.pristyncare.com/cost/lasik-eye-surgery/', null),
  ('IN', 'smaller', 'lasik', 20000, 120000, 'INR', 2026, 'https://eyemantra.in/haryana/hisar/lasik-surgery-cost-hisar/', 'Hisar, per-eye price doubled for both eyes'),
  ('IN', 'metro', 'dental_implant', 20000, 60000, 'INR', 2026, 'https://www.bajajfinservhealth.in/surgeries/cost/dental-implant-cost-in-india', 'Delhi NCR'),
  ('IN', 'regional', 'dental_implant', 15000, 65000, 'INR', 2026, 'https://www.bajajfinservhealth.in/surgeries/cost/dental-implant-cost-in-india', 'Jaipur'),
  ('IN', 'metro', 'knee_replacement', 280000, 322000, 'INR', 2026, 'https://www.pristyncare.com/delhi/cost/knee-replacement/', 'Delhi'),
  ('IN', 'regional', 'knee_replacement', 160000, 300000, 'INR', 2026, 'https://www.pristyncare.com/chandigarh/cost/knee-replacement/', 'Chandigarh'),
  ('IN', 'regional', 'knee_replacement', 175000, 690000, 'INR', 2024, 'https://www.hexahealth.com/treatment/knee-replacement-surgery-cost-in-chandigarh', 'Chandigarh'),
  ('IN', 'metro', 'knee_replacement', 169000, 310000, 'INR', 2026, 'https://www.bajajfinservhealth.in/surgeries/cost/knee-replacement-cost-in-india', 'Bengaluru'),
  ('IN', 'metro', 'knee_replacement', 312500, 312500, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/knee-replacement-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'metro', 'hip_replacement', 280500, 320500, 'INR', 2026, 'https://www.pristyncare.com/cost/hip-replacement/', null),
  ('IN', 'metro', 'hip_replacement', 500000, 500000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/hip-replacement-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'regional', 'hip_replacement', 280000, 280000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/hip-replacement-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'regional', 'angioplasty', 58000, 185000, 'INR', 2026, 'https://www.bajajfinservhealth.in/surgeries/cost/angioplasty-cost-in-india', 'Jaipur'),
  ('IN', 'metro', 'angioplasty', 480000, 480000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/angioplasty-with-stent-cost-in-india', 'insurer, with stent'),
  ('IN', 'regional', 'angioplasty', 250000, 250000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/angioplasty-with-stent-cost-in-india', 'insurer, with stent'),
  ('IN', 'metro', 'heart_bypass', 120000, 440000, 'INR', 2026, 'https://www.bajajfinservhealth.in/surgeries/cost/triple-bypass-cost-in-india', null),
  ('IN', 'metro', 'heart_bypass', 550000, 550000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/bypass-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'regional', 'heart_bypass', 300000, 300000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/bypass-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'india', 'heart_valve', 73500, 315000, 'INR', 2026, 'https://www.bajajfinservhealth.in/surgeries/cost/mvr-dvr-cost-in-india', 'mitral valve'),
  ('IN', 'metro', 'heart_valve', 750000, 750000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/heart-valve-replacement-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'regional', 'heart_valve', 400000, 400000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/heart-valve-replacement-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'metro', 'ivf', 120000, 250000, 'INR', 2026, 'https://www.pristyncare.com/cost/ivf/', 'Delhi, medicines extra'),
  ('IN', 'regional', 'ivf', 150000, 150000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/ivf-treatment-cost-in-india', 'insurer, indicative'),
  ('IN', 'metro', 'gallbladder', 60000, 93500, 'INR', 2026, 'https://www.pristyncare.com/cost/gallstone/', null),
  ('IN', 'regional', 'gallbladder', 85000, 85000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/gallbladder-stone-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'metro', 'hernia', 80500, 120500, 'INR', 2026, 'https://www.pristyncare.com/cost/hernia/', null),
  ('IN', 'regional', 'hernia', 85000, 85000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/hernia-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'metro', 'hysterectomy', 85000, 122000, 'INR', 2026, 'https://www.pristyncare.com/cost/hysterectomy/', null),
  ('IN', 'regional', 'hysterectomy', 80000, 240000, 'INR', 2026, 'https://www.bajajfinservhealth.in/surgeries/cost/hysterectomy-cost-in-india', 'Jaipur'),
  ('IN', 'metro', 'hysterectomy', 190000, 190000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/hysterectomy-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'india', 'spine_fusion', 130000, 400000, 'INR', 2026, 'https://www.pristyncare.com/cost/spine-surgery/', null),
  ('IN', 'regional', 'spine_fusion', 250000, 250000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/spine-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'metro', 'bariatric', 250000, 290000, 'INR', 2026, 'https://www.pristyncare.com/cost/bariatric-surgery/', null),
  ('IN', 'regional', 'bariatric', 300000, 300000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/bariatric-surgery-cost-in-india', 'insurer, indicative'),
  ('IN', 'india', 'prostate', 55000, 120000, 'INR', 2026, 'https://www.pristyncare.com/cost/prostate-enlargement/', 'TURP'),
  ('IN', 'regional', 'prostate', 140000, 140000, 'INR', 2026, 'https://www.manipalcigna.com/cost-of-treatment/prostate-enlargement-surgery-cost-in-india', 'insurer, indicative'),
  ('US', null, 'cataract', 4800, 4800, 'USD', 2026, 'https://surgerycenterok.com/pricing/', 'low-cost cash price, one eye'),
  ('US', null, 'cataract', 3500, 3500, 'USD', 2021, 'https://medicaltourism.com/compare-prices', 'per eye'),
  ('US', null, 'lasik', 2460, 5250, 'USD', 2024, 'https://www.carecredit.com/well-u/health-wellness/lasik-eye-surgery-cost-lasik-financing/', 'both eyes'),
  ('US', null, 'lasik', 4000, 4000, 'USD', 2021, 'https://medicaltourism.com/compare-prices', 'both eyes'),
  ('US', null, 'dental_implant', 3158, 6533, 'USD', 2026, 'https://www.aspendental.com/implants/tooth-implant-cost', 'implant, abutment and crown'),
  ('US', null, 'knee_replacement', 17679, 17679, 'USD', 2026, 'https://surgerycenterok.com/pricing/', 'low-cost cash price'),
  ('US', null, 'knee_replacement', 35000, 35000, 'USD', 2021, 'https://medicaltourism.com/compare-prices', null),
  ('US', null, 'hip_replacement', 17579, 17579, 'USD', 2026, 'https://surgerycenterok.com/pricing/', 'low-cost cash price'),
  ('US', null, 'hip_replacement', 40364, 40364, 'USD', 2021, 'https://medicaltourism.com/compare-prices', null),
  ('US', null, 'angioplasty', 28200, 28200, 'USD', 2021, 'https://medicaltourism.com/compare-prices', null),
  ('US', null, 'heart_bypass', 70000, 200000, 'USD', 2026, 'https://coveredusa.org/en/blog/cabg-cost-cpt-33533-drg-233', 'billed cost'),
  ('US', null, 'heart_bypass', 123000, 123000, 'USD', 2021, 'https://medicaltourism.com/compare-prices', null),
  ('US', null, 'heart_valve', 170000, 170000, 'USD', 2021, 'https://medicaltourism.com/compare-prices', null),
  ('US', null, 'ivf', 12400, 12400, 'USD', 2021, 'https://medicaltourism.com/compare-prices', 'one cycle'),
  ('US', null, 'gallbladder', 6836, 6836, 'USD', 2026, 'https://surgerycenterok.com/pricing/', 'low-cost cash price'),
  ('US', null, 'hernia', 2900, 23000, 'USD', 2026, 'https://kffhealthnews.org/health-care-costs/hernia-surgery-search-globe-for-deal-bill-of-the-month-july-2026/', null),
  ('US', null, 'hernia', 5787, 5787, 'USD', 2026, 'https://surgerycenterok.com/pricing/', 'mesh not included'),
  ('US', null, 'hysterectomy', 9190, 12055, 'USD', 2026, 'https://surgerycenterok.com/pricing/', null),
  ('US', null, 'hysterectomy', 15400, 15400, 'USD', 2021, 'https://medicaltourism.com/compare-prices', null),
  ('US', null, 'spine_fusion', 32850, 37000, 'USD', 2026, 'https://surgerycenterok.com/pricing/', '1 level'),
  ('US', null, 'spine_fusion', 110000, 110000, 'USD', 2021, 'https://medicaltourism.com/compare-prices', null),
  ('US', null, 'bariatric', 16500, 16500, 'USD', 2021, 'https://medicaltourism.com/compare-prices', 'gastric sleeve'),
  ('US', null, 'prostate', 4910, 4910, 'USD', 2026, 'https://surgerycenterok.com/pricing/', 'low-cost cash price'),
  ('CA', null, 'cataract', 2000, 5000, 'CAD', 2026, 'https://www.treatcompare.com/ca/cataract-surgery-wait-times-cost', 'private clinic'),
  ('CA', null, 'lasik', 3000, 6000, 'CAD', 2026, 'https://lifetimescanada.com/blog/vision/cost-of-lasik-eye-surgery-in-canada-2026-is-it-worth-it', 'both eyes'),
  ('CA', null, 'dental_implant', 3000, 6500, 'CAD', 2026, 'https://skymarksmilecentre.ca/knowledge-centre/post/how-much-do-dental-implants-cost-ontario/', null),
  ('CA', null, 'knee_replacement', 20000, 28000, 'CAD', 2023, 'https://bioethics.com/archives/68292', 'private clinic'),
  ('CA', null, 'knee_replacement', 33000, 33000, 'CAD', 2025, 'https://ici.radio-canada.ca/rci/en/news/2190886/why-some-canadians-are-using-their-savings-gofundme-to-pay-for-private-surgeries', 'one patient, Toronto'),
  ('CA', null, 'hip_replacement', 20000, 28000, 'CAD', 2023, 'https://bioethics.com/archives/68292', 'private clinic'),
  ('CA', null, 'ivf', 11500, 20500, 'CAD', 2026, 'https://www.olivefertility.com/pricing', 'with medicines'),
  ('AU', null, 'cataract', 4184, 5188, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/cataracts/', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'lasik', 5000, 9425, 'AUD', 2025, 'https://www.canstar.com.au/health-insurance/laser-eye-surgery-cost', 'both eyes'),
  ('AU', null, 'dental_implant', 3000, 7000, 'AUD', 2026, 'https://www.finder.com.au/health-insurance/dental/dental-implants', null),
  ('AU', null, 'knee_replacement', 22189, 26852, 'AUD', 2024, 'https://www.medibank.com.au/health-support/hospital-assist/costs/knee-replacement', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'hip_replacement', 24092, 29208, 'AUD', 2024, 'https://www.medibank.com.au/health-support/hospital-assist/costs/hip-replacement', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'angioplasty', 11713, 15222, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/coronary-artery-stents/', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'heart_bypass', 52247, 71246, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/coronary-artery-graft/', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'heart_valve', 51332, 74569, 'AUD', 2024, 'https://www.medibank.com.au/health-support/hospital-assist/costs/valve-replacement', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'ivf', 12388, 12388, 'AUD', 2025, 'https://www.canstar.com.au/health-insurance/ivf-cost/', 'one cycle, before Medicare rebate'),
  ('AU', null, 'gallbladder', 7467, 9242, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/gall-bladder-surgery/', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'hernia', 5284, 7103, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/inguinal-femoral-hernia-repair/', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'hysterectomy', 11340, 16167, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/hysterectomy/', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'spine_fusion', 40840, 57214, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/spinal-fusion/', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'bariatric', 12527, 16753, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/sleeve-gastrectomy/', 'hospital charges only, doctors'' fees extra'),
  ('AU', null, 'prostate', 8066, 20885, 'AUD', 2024, 'https://www.medibank.com.au/health-support/going-to-hospital/procedure-costs/prostate-surgery/', 'hospital charges only, doctors'' fees extra')
on conflict (country, procedure_code, source, low, high) do nothing;

notify pgrst, 'reload schema';
