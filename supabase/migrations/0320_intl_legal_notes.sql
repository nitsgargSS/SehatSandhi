-- ============================================================================
-- 0320 — International: legal notes and the patient's acceptance
-- ============================================================================
-- AFTER 0319. Safe to re-run.
--
-- Asked 3 Nov 2026: treatments that Indian law allows for patients from
-- abroad only on conditions show those conditions first; the patient accepts
-- them and a declaration (they will follow Indian law, take part in nothing
-- illegal, and Sehatsandhi is not responsible for anyone breaking it) before
-- comparing or asking for a quote. The acceptance is stored with the request.
--
--   intl_procedures   legal_title, legal_points (jsonb array of lines),
--                     legal_sources (jsonb [{label,url}]), legal_version.
--   intl_enquiries    legal_ack, legal_version, legal_ack_at, legal_text —
--                     the exact notes and declaration accepted.
--   site_settings 'intl_legal_declaration'   the declaration lines (the same
--                     as DECLARATION in src/pages/international/IntlLegal.tsx).
--   sehat_intl_enquire()   refuses such a request without legal_ack.
--
-- Wording from the 3 Nov 2026 research (sources linked on each treatment).
-- General information, not legal advice: a lawyer should review it.
-- ============================================================================

alter table intl_procedures add column if not exists legal_title text;
alter table intl_procedures add column if not exists legal_points jsonb;
alter table intl_procedures add column if not exists legal_sources jsonb;
alter table intl_procedures add column if not exists legal_version text;

alter table intl_enquiries add column if not exists legal_ack boolean not null default false;
alter table intl_enquiries add column if not exists legal_version text;
alter table intl_enquiries add column if not exists legal_ack_at timestamptz;
alter table intl_enquiries add column if not exists legal_text text;

insert into site_settings (key, value) values ('intl_legal_declaration', $j$["I have read the legal notes above and will follow them and all Indian laws that apply to my treatment.", "I will not take part in anything illegal — including paying for or selling an organ, giving false documents, or asking for a treatment the law does not allow.", "I understand that the hospital and the government committees decide whether the treatment can go ahead, and that Sehatsandhi only helps with information and travel.", "I understand that Sehatsandhi is not responsible for any wrongdoing, loss or legal consequence that comes from breaking Indian law, by me or anyone acting for me."]$j$::jsonb::text)
on conflict (key) do update set value = excluded.value, updated_at = now();

update intl_procedures set legal_title = 'Organ transplant for patients from abroad: what Indian law requires',
  legal_points = $j$["Transplants are governed by the Transplantation of Human Organs and Tissues Act, 1994 and its Rules, 2014. Buying or selling an organ is a crime in India.", "For a patient from abroad, the living donor must be a near relative: spouse, son, daughter, father, mother, brother, sister, grandparent or grandchild. An Indian who is not a near relative cannot donate to a foreign patient.", "Every transplant for a foreign patient needs approval from the hospital's government-constituted Authorisation Committee, even between near relatives. The committee examines these cases with extra care.", "A senior official of your country's embassy or high commission in India must certify the donor–recipient relationship (Form 21). Hospitals and state authorities also ask for affidavits, identity proof, police verification and usually a DNA test of the relationship.", "Organs from deceased donors go first to patients on Indian waiting lists; a foreign patient receives one only if no suitable Indian patient is waiting.", "Paying for an organ, using a broker, or giving false relationship documents is punishable with 5 to 10 years in prison and a fine of ₹20 lakh to ₹1 crore.", "The treatment is only at a hospital registered as a transplant centre. The hospital and the committee decide whether it can go ahead; Sehatsandhi cannot influence that decision."]$j$::jsonb, legal_sources = $j$[{"label": "THOTA Rules 2014", "url": "https://www.legitquest.com/act/transplantation-of-human-organs-and-tissues-rules-2014/9f25"}, {"label": "THOTA Act s.19 (penalties)", "url": "https://www.advocatekhoj.com/library/bareacts/transplantationofhumanorgans/19.php"}, {"label": "Health Ministry note for foreign nationals, 2024", "url": "https://www.itnnews.co.in/indian-transplant-newsletter/issue72/Foreign-Nationals-must-be-Informed-about-Indias-Organ-Transplant-Regulations-says-Union-Health-Ministry-1311.htm"}, {"label": "Living donor checklist (Goa SOTTO)", "url": "http://www.sotto.goa.gov.in/living-donor-transplant-checklist/"}]$j$::jsonb, legal_version = '2026-11-03'
 where code in ('kidney_transplant', 'liver_transplant');
update intl_procedures set legal_title = 'Bone marrow transplant: what Indian law requires',
  legal_points = $j$["Bone marrow (blood stem cell) transplant is an approved treatment for blood cancers, thalassaemia and some other blood disorders. It is done only at hospitals equipped and registered for it.", "The donor is usually a matched family member, or an unrelated donor from a registry. The hospital confirms the documents and approvals each case needs; when a donor is unrelated, rules for foreign patients can be stricter.", "No payment may be made to any donor. Buying cells or using a broker is illegal.", "Stem cell treatment for other conditions (for example autism, spinal cord injury, Parkinson's or Alzheimer's) is not an approved treatment in India and is allowed only inside a free, approved clinical trial. Sehatsandhi does not arrange it."]$j$::jsonb, legal_sources = $j$[{"label": "Stem cell therapy limited to approved uses (2026)", "url": "https://www.outlookindia.com/national/stem-cell-therapy-centre-bars-routine-use-for-autism-cites-supreme-court-order"}, {"label": "NMC and Health Ministry advisory (2026)", "url": "https://telanganatoday.com/stem-cell-therapy-warning-nmc-health-ministry-bar-unproven-treatments"}]$j$::jsonb, legal_version = '2026-11-03'
 where code = 'bone_marrow';
update intl_procedures set legal_title = 'IVF and fertility treatment: what Indian law requires',
  legal_points = $j$["IVF is governed by the Assisted Reproductive Technology (Regulation) Act, 2021, at clinics registered under it. It is for a married couple or a woman, within the law's age limits (women 21–50, men 21–55).", "Donor eggs or sperm can come only through a registered ART bank in India. Bringing embryos, eggs or sperm into India is not allowed, and buying or selling them is illegal.", "Testing embryos (PGT) is allowed only to screen for known genetic diseases.", "Choosing or finding out the sex of the baby is a crime in India, except to diagnose a sex-linked disease. Do not ask for it — no clinic may do it.", "Surrogacy in India is only for Indian couples, on medical grounds and without payment; it is not available to foreign nationals. Sehatsandhi does not arrange surrogacy."]$j$::jsonb, legal_sources = $j$[{"label": "ART (Regulation) Act 2021", "url": "https://prsindia.org/files/bills_acts/acts_parliament/2021/The%20Assisted%20Reproductive%20Technology%20(Regulation)%20Act,%202021.pdf"}, {"label": "Surrogacy (Regulation) Act 2021", "url": "https://www.thc.nic.in/Central%20Governmental%20Acts/Surrogacy%20(Regulation)%20Act,%202021.pdf"}, {"label": "PC-PNDT penalties", "url": "https://pcpndt.delhi.gov.in/violation-penalties"}]$j$::jsonb, legal_version = '2026-11-03'
 where code = 'ivf';

create or replace function sehat_intl_catalogue()
returns jsonb language sql stable security definer set search_path = public as $$
  with fee as (select sehat_intl_fee_pct() as pct)
  select jsonb_build_object(
    'fee_pct', (select pct from fee),
    'fx', coalesce((select value::jsonb from site_settings where key = 'intl_fx'), '{}'::jsonb),
    'procedures', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'speciality', p.speciality, 'grp', p.grp,
        'hospital_days', p.hospital_days, 'india_days', p.india_days, 'summary', p.summary, 'reports', p.reports,
        'legal_title', p.legal_title, 'legal_points', p.legal_points, 'legal_sources', p.legal_sources, 'legal_version', p.legal_version)
        order by p.sort) from intl_procedures p where p.active), '[]'::jsonb),
    'hospitals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name,
        'city', coalesce(nullif(b.own_city, ''), nullif(b.own_district, '')),
        'state', b.own_state,
        'city_level', coalesce(h.city_level, sehat_intl_city_level(coalesce(nullif(b.own_city, ''), b.own_district))),
        'star', h.star, 'nabh', h.nabh, 'jci', h.jci, 'beds', h.beds, 'icu_beds', h.icu_beds,
        'panels', to_jsonb(h.panels), 'languages', to_jsonb(h.languages), 'specialities', to_jsonb(h.specialities),
        'about', h.about, 'photo_url', b.photo_url,
        'cover_path', (select m.path from intl_media m
                       where m.business_id = b.id and m.status = 'approved' and m.kind = 'photo'
                       order by m.sort, m.uploaded_at limit 1),
        'media', coalesce((select jsonb_agg(jsonb_build_object(
            'kind', m.kind, 'path', m.path,
            'youtube_id', m.youtube_id, 'category', m.category, 'caption', m.caption) order by m.sort, m.uploaded_at)
            from intl_media m where m.business_id = b.id and m.status = 'approved'), '[]'::jsonb),
        'nearest_airport', h.nearest_airport, 'airport_hours', h.airport_hours,
        'site_url', (select case when s.tier = 'full' and s.custom_domain is not null then 'https://www.' || s.custom_domain
                                 else '/s/' || s.slug end
                       from business_sites s where s.business_id = b.id and s.is_live),
        'packages', coalesce((select jsonb_agg(jsonb_build_object(
            'procedure_code', k.procedure_code,
            'price_min', (ceil(k.price_min * (1 + (select pct from fee) / 100.0) / 100.0) * 100)::integer,
            'price_max', (ceil(k.price_max * (1 + (select pct from fee) / 100.0) / 100.0) * 100)::integer,
            'room_type', k.room_type, 'included', k.included, 'excluded', k.excluded,
            'hospital_days', k.hospital_days, 'india_days', k.india_days, 'fly_after_days', k.fly_after_days,
            'doctor_name', k.doctor_name, 'valid_until', k.valid_until))
            from intl_packages k where k.business_id = b.id and k.active and k.valid_until >= current_date), '[]'::jsonb))
        order by b.name)
        from intl_hospitals h join businesses b on b.id = h.business_id
        where h.status = 'listed' and b.status = 'active'), '[]'::jsonb)
  )
$$;

create or replace function sehat_intl_enquire(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := left(btrim(coalesce(p->>'name', '')), 120);
  v_phone text := nullif(left(regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'), 20), '');
  v_email text := nullif(left(lower(btrim(coalesce(p->>'email', ''))), 120), '');
  v_proc text := nullif(p->>'procedure_code', '');
  v_short uuid[];
  v_token text;
  v_comp integer := least(greatest(coalesce(nullif(p->>'companions', '')::integer, 0), 0), 2);
  v_prefs jsonb := coalesce(p->'prefs', '{}'::jsonb);
  v_legal intl_procedures;
begin
  if coalesce(btrim(p->>'website'), '') <> '' then return jsonb_build_object('ok', true, 'token', null); end if;
  if length(v_name) < 2 then return jsonb_build_object('ok', false, 'error', 'Please tell us your name.'); end if;
  if v_phone is null and v_email is null then
    return jsonb_build_object('ok', false, 'error', 'Please give a WhatsApp number or email so we can reply.');
  end if;
  if v_phone is not null and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Please include your country code, for example +44 7700 900123.');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'That email address does not look right.');
  end if;
  if v_proc is not null and not exists (select 1 from intl_procedures where code = v_proc) then v_proc := null; end if;
  if v_proc is null and length(btrim(coalesce(p->>'problem', ''))) < 3 then
    return jsonb_build_object('ok', false, 'error', 'Please choose a treatment or tell us briefly what is troubling you.');
  end if;
  if coalesce((p->>'consent_share')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'Please agree that we may share your reports with the hospitals you chose.');
  end if;
  if coalesce((p->>'ack_estimate')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'Please confirm you understand prices are estimates.');
  end if;
  -- 0320: a treatment with legal conditions needs the patient's acceptance.
  select * into v_legal from intl_procedures where code = v_proc and jsonb_array_length(coalesce(legal_points, '[]')) > 0;
  if v_legal.code is not null and coalesce((p->>'legal_ack')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'Please read the legal notes for this treatment and accept the declaration.');
  end if;
  if jsonb_typeof(v_prefs) <> 'object' or length(v_prefs::text) > 4000 then v_prefs := '{}'::jsonb; end if;
  -- Shortlist: up to 3 listed hospitals.
  v_short := coalesce(array(
    select h.business_id from intl_hospitals h
     where h.status = 'listed'
       and h.business_id::text in (select jsonb_array_elements_text(coalesce(p->'shortlist', '[]')))
     limit 3), '{}');

  if (select count(*) from intl_enquiries
       where created_at > now() - interval '1 day'
         and ((v_phone is not null and phone = v_phone) or (v_email is not null and email = v_email))) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'We already have your requests. Our coordinator will reply on WhatsApp soon.');
  end if;
  if (select count(*) from intl_enquiries where created_at > now() - interval '1 hour') >= 120 then
    return jsonb_build_object('ok', false, 'error', 'We are receiving many requests. Please try again in a few minutes or message us on WhatsApp.');
  end if;

  insert into intl_enquiries (name, country, phone, email, procedure_code, problem, urgency, travel_when,
                              companions, budget, prefs, shortlist, consent_share, ack_estimate, page,
                              legal_ack, legal_version, legal_ack_at, legal_text)
  values (v_name, nullif(left(btrim(coalesce(p->>'country', '')), 80), ''), v_phone, v_email, v_proc,
          nullif(left(btrim(coalesce(p->>'problem', '')), 3000), ''),
          case when p->>'urgency' in ('planned', 'soon', 'urgent') then p->>'urgency' end,
          nullif(left(btrim(coalesce(p->>'travel_when', '')), 80), ''),
          v_comp, nullif(left(btrim(coalesce(p->>'budget', '')), 80), ''), v_prefs, v_short, true, true,
          nullif(left(coalesce(p->>'page', ''), 200), ''),
          v_legal.code is not null, v_legal.legal_version, case when v_legal.code is not null then now() end,
          case when v_legal.code is not null then
            v_legal.legal_title || E'\n- ' || array_to_string(array(select jsonb_array_elements_text(v_legal.legal_points)), E'\n- ')
            || E'\n\nDeclaration accepted:\n- ' || array_to_string(array(select jsonb_array_elements_text(
                 (select value::jsonb from site_settings where key = 'intl_legal_declaration'))), E'\n- ') end)
  returning token into v_token;
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

notify pgrst, 'reload schema';
