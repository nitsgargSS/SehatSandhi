-- ============================================================================
-- 0313 — International: every document checked, audit links, weekly backup
-- ============================================================================
-- AFTER 0312. Safe to re-run.
--
-- Decided 3 Nov 2026. A hospital's international listing depends on its
-- documents, so the database, not the screen, decides when it may be listed.
--
-- 1. intl_check_items   the A–F checklist (same keys as src/lib/intlContent.ts):
--                       which items are required, need a document, need an expiry.
-- 2. intl_documents     every upload is a row and is never overwritten: a new
--                       upload of the same item marks the previous one
--                       'replaced'. Sehatsandhi verifies or rejects each one.
-- 3. intl_doc_events    who did what and when — uploads, checks, reminders,
--                       pauses, listings. The audit trail.
-- 4. sehat_intl_readiness(business, 'submit' | 'list') — what is missing.
--      submit: every required document uploaded, not rejected, in date, and
--              every required non-document item ticked.
--      list:   all that, and every required document verified.
--    Sending for review and listing both refuse while anything is missing.
-- 5. A daily sweep: reminders 30 and 7 days before a document expires; on
--    the day a required one expires the listing pauses by itself, and comes
--    back by itself once the renewal is verified.
-- 6. Audit links: an admin gives a government body or an agency a read-only
--    link (/audit/<token>) to chosen hospitals, for a few days, with an
--    optional passcode. Every open and download is logged; a link can be
--    revoked at any time. Files are served by the intl-audit-file function.
-- 7. Weekly backup of the intl-docs bucket by the intl-docs-backup function
--    (to an S3-compatible bucket when configured, else a private backup
--    bucket in this project); runs are recorded in intl_backup_runs.
-- Plus: documents are read by admins and the hospital only (not managers),
-- and nobody but an admin can delete a document file.
-- ============================================================================

-- ── 1. The checklist ────────────────────────────────────────────────────────
create table if not exists intl_check_items (
  key text primary key,
  grp text not null,
  label text not null,
  needs_doc boolean not null default false,
  needs_expiry boolean not null default false,
  required boolean not null default true,
  sort integer not null default 100
);
insert into intl_check_items (key, grp, label, needs_doc, needs_expiry, required, sort) values
  ('A1','A','Hospital registration (Clinical Establishments Act / state rules) with bed count', true, true, true, 101),
  ('A2','A','Fire NOC', true, true, true, 102),
  ('A3','A','Building occupancy / completion certificate and structural safety', true, false, true, 103),
  ('A4','A','Bio-medical waste authorisation and agreement with a treatment facility', true, true, true, 104),
  ('A5','A','Pollution Control Board consents (air and water)', true, true, true, 105),
  ('A6','A','AERB licence for every X-ray, CT, cath lab or C-arm', true, true, true, 106),
  ('A7','A','PC-PNDT registration (if you do ultrasound)', true, true, false, 107),
  ('A8','A','Drug licence for the in-house pharmacy', true, true, true, 108),
  ('A9','A','Blood centre licence, or written tie-up with a licensed blood centre', true, true, true, 109),
  ('A10','A','Oxygen / medical gas storage licence (PESO)', true, true, true, 110),
  ('A11','A','Lift licence', true, true, false, 111),
  ('A12','A','Registration numbers of every doctor (NMC / state council) and nurse', true, false, true, 112),
  ('A13','A','Professional indemnity insurance for the hospital and its surgeons', true, true, true, 113),
  ('A14','A','Narcotic drugs licence (for post-surgery pain medicines)', true, true, false, 114),
  ('A15','A','GST registration and PAN of the hospital', true, false, true, 115),
  ('B1','B','NABH accreditation certificate (full or entry-level), or proof of application', true, true, true, 201),
  ('B2','B','NABL accreditation of the in-house lab', true, true, false, 202),
  ('B3','B','CGHS empanelment', true, false, false, 203),
  ('B4','B','ECHS empanelment', true, false, false, 204),
  ('B5','B','Ayushman Bharat (PM-JAY) / state scheme empanelment', true, false, false, 205),
  ('B6','B','Railways, ESIC or PSU panels', true, false, false, 206),
  ('B7','B','Cashless tie-ups with private insurers / TPAs', false, false, false, 207),
  ('B8','B','JCI accreditation', true, false, false, 208),
  ('C1','C','IPD: at least 30 functional beds (50 for multi-speciality), with daily consultant rounds', false, false, true, 301),
  ('C2','C','ICU: at least 5 beds with ventilators, monitors and defibrillator; intensivist or trained ICU doctor; 1 nurse per 2 ICU beds', false, false, true, 302),
  ('C3','C','Duty doctor (RMO) on site 24x7; anaesthetist on call within 30 minutes', false, false, true, 303),
  ('C4','C','24x7 emergency with triage, crash cart and an ALS ambulance', false, false, true, 304),
  ('C5','C','Modular OT with HEPA filters (laminar airflow for joint, spine and implant surgery); separate recovery area', false, false, true, 305),
  ('C6','C','CSSD with autoclave logs and sterility indicators', false, false, true, 306),
  ('C7','C','In-house lab, 24x7 for emergency tests', false, false, true, 307),
  ('C8','C','X-ray and ultrasound in-house; CT in-house or tie-up within 15 minutes', false, false, true, 308),
  ('C9','C','In-house pharmacy, 24x7', false, false, true, 309),
  ('C10','C','Blood available within 1 hour', false, false, true, 310),
  ('C11','C','Central oxygen pipeline to ICU, OT and wards, with backup cylinders', false, false, true, 311),
  ('C12','C','Generator and UPS for ICU and OT', false, false, true, 312),
  ('C13','C','Infection control committee, hand-hygiene audits, surgical site infection rate recorded monthly', false, false, true, 313),
  ('C14','C','Electronic records and IPD billing on Sehatsandhi for every international patient', false, false, true, 314),
  ('D1','D','At least 4 private rooms for international patients: AC, attached bathroom with western toilet, hot water', false, false, true, 401),
  ('D2','D','Companion bed or sofa-bed in the room; at least 1 deluxe room or suite (2 for 5-star)', false, false, true, 402),
  ('D3','D','Free Wi-Fi, TV, fridge or kettle, wardrobe, charging points by the bed', false, false, true, 403),
  ('D4','D','Nurse call bell at bed and in bathroom; grab rails in bathroom', false, false, true, 404),
  ('D5','D','Clean linen daily, room cleaned twice a day, pest control records', false, false, true, 405),
  ('D6','D','Dietitian plans meals; vegetarian, non-vegetarian and simple continental; Jain and halal on request', false, false, true, 406),
  ('D7','D','RO drinking water; kitchen with FSSAI licence', false, false, true, 407),
  ('D8','D','Lift, ramps, wheelchairs, clean public toilets, parking, CCTV and 24x7 security', false, false, true, 408),
  ('D9','D','Family lounge; at least 1 checked hotel within 2 km for companions', false, false, true, 409),
  ('E1','E','Named English-speaking coordinator on WhatsApp 9 AM–9 PM IST, with a backup', false, false, true, 501),
  ('E2','E','English and Hindi at the desk; interpreter arranged on request', false, false, true, 502),
  ('E3','E','Registered on the Medical and Ayush Visa Portal (e-FRRO); visa letter within 2–3 working days, plus up to 2 attendants', true, false, true, 503),
  ('E4','E','Reports every foreign in-patient to the FRRO within 24 hours (Immigration and Foreigners Act 2025)', false, false, true, 504),
  ('E5','E','Written quotes: treatment, days, room, included and not included, valid 30 days, sent through Sehatsandhi', false, false, true, 505),
  ('E6','E','Final bill within 10% of the quote unless a written reason is shared first', false, false, true, 506),
  ('E7','E','Consent forms in English, explained by the surgeon', false, false, true, 507),
  ('E8','E','Itemised English bill; international cards and bank transfer; receipts for every payment', false, false, true, 508),
  ('E9','E','English discharge summary, digital copies of all reports and images, fit-to-fly note', false, false, true, 509),
  ('E10','E','Online follow-ups after the patient goes home', false, false, true, 510),
  ('E11','E','A named senior person answers any complaint within 48 hours', false, false, true, 511),
  ('F_ortho','F','Joint replacement / spine: laminar-flow OT, C-arm (AERB), daily physiotherapy', false, false, false, 601),
  ('F_cardiac','F','Heart: cath lab (AERB), cardiac ICU; cardiac surgeon and perfusionist for bypass', true, false, false, 602),
  ('F_ivf','F','IVF: ART clinic and bank registration (ART Act 2021), PC-PNDT, registered embryologist', true, true, false, 603),
  ('F_transplant','F','Transplant: THOTA transplant centre registration and authorisation committee', true, true, false, 604),
  ('F_cancer','F','Cancer: AERB for radiotherapy; medical, surgical and radiation oncologists', true, false, false, 605),
  ('F_eye','F','Eye: phaco machine, OCT and visual field tests', false, false, false, 606),
  ('F_dental','F','Dental: Dental Council registration of dentists, sterilisation', true, false, false, 607)
on conflict (key) do update set grp = excluded.grp, label = excluded.label, needs_doc = excluded.needs_doc,
  needs_expiry = excluded.needs_expiry, required = excluded.required, sort = excluded.sort;

alter table intl_check_items enable row level security;
drop policy if exists intl_check_items_read on intl_check_items;
create policy intl_check_items_read on intl_check_items for select using (true);
revoke insert, update, delete on intl_check_items from anon, authenticated;
grant select on intl_check_items to anon, authenticated;

-- ── 2. Documents and 3. events ──────────────────────────────────────────────
alter table intl_hospitals add column if not exists auto_paused boolean not null default false;

create table if not exists intl_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references intl_hospitals(business_id) on delete cascade,
  item_key text not null references intl_check_items(key),
  path text not null unique,
  file_name text,
  size_bytes integer,
  expires date,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'replaced')),
  reason text,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz
);
-- At most one current (not replaced) document per item.
create unique index if not exists intl_documents_current_idx on intl_documents (business_id, item_key) where status <> 'replaced';
create index if not exists intl_documents_expiry_idx on intl_documents (expires) where status <> 'replaced';

create table if not exists intl_doc_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references intl_hospitals(business_id) on delete cascade,
  document_id uuid references intl_documents(id) on delete set null,
  item_key text,
  action text not null,
  note text,
  actor uuid,
  actor_name text,
  at timestamptz not null default now()
);
create index if not exists intl_doc_events_biz_idx on intl_doc_events (business_id, at desc);

alter table intl_documents enable row level security;
alter table intl_doc_events enable row level security;
drop policy if exists intl_documents_read on intl_documents;
create policy intl_documents_read on intl_documents for select to authenticated
  using (sehat_is_admin() or sehat_caller_is_business(business_id));
drop policy if exists intl_doc_events_read on intl_doc_events;
create policy intl_doc_events_read on intl_doc_events for select to authenticated
  using (sehat_is_admin() or sehat_caller_is_business(business_id));
revoke all on intl_documents, intl_doc_events from anon;
revoke insert, update, delete on intl_documents, intl_doc_events from authenticated;
grant select on intl_documents, intl_doc_events to authenticated;

-- Files: the hospital and admins read; the hospital uploads; only admins delete.
drop policy if exists intl_docs_read on storage.objects;
create policy intl_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'intl-docs'
    and (sehat_is_admin() or sehat_caller_is_business(nullif(split_part(name, '/', 1), '')::uuid)));
drop policy if exists intl_docs_delete on storage.objects;
create policy intl_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'intl-docs' and sehat_is_admin());

-- Bring 0312's checklist documents into the table (as waiting for a check).
insert into intl_documents (business_id, item_key, path, expires, uploaded_at)
select h.business_id, e.key, e.value->>'doc', nullif(e.value->>'expires', '')::date, h.updated_at
  from intl_hospitals h, jsonb_each(h.checklist) e
 where coalesce(e.value->>'doc', '') <> '' and exists (select 1 from intl_check_items i where i.key = e.key and i.needs_doc)
on conflict do nothing;

-- Who is acting, in words, for the record.
create or replace function sehat_intl_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(nullif(full_name, ''), email) || ' (Sehatsandhi)' from admin_users where auth_uid = auth.uid() and is_active limit 1),
    (select coalesce(nullif(raw_user_meta_data->>'full_name', ''), email, phone) from auth.users where id = auth.uid()),
    'System')
$$;
revoke all on function sehat_intl_actor_name() from public, anon, authenticated;

create or replace function sehat_intl_log(p_business uuid, p_action text, p_note text default null,
                                          p_doc uuid default null, p_item text default null)
returns void language sql volatile security definer set search_path = public as $$
  insert into intl_doc_events (business_id, document_id, item_key, action, note, actor, actor_name)
  values (p_business, p_doc, p_item, p_action, p_note, auth.uid(), sehat_intl_actor_name())
$$;
revoke all on function sehat_intl_log(uuid, text, text, uuid, text) from public, anon, authenticated;

-- ── Emails ──────────────────────────────────────────────────────────────────
alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (kind = any (array[
  'business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite', 'nurse_unassigned',
  'wa_broadcast_rejected', 'signup_reminder', 'wa_broadcast_waiting', 'clinic_booking_cancelled',
  'demo_request', 'clinic_site_message', 'intl_notice']));

-- p_to: 'hospital' (its coordinator, else the business email) or 'admin'.
create or replace function sehat_intl_notify(p_business uuid, p_to text, p_subject text, p_lines text[])
returns void language sql volatile security definer set search_path = public as $$
  insert into email_outbox (kind, business_id, payload)
  values ('intl_notice', p_business, jsonb_build_object('to', p_to, 'subject', p_subject, 'lines', to_jsonb(p_lines)))
$$;
revoke all on function sehat_intl_notify(uuid, text, text, text[]) from public, anon, authenticated;

-- ── 4. Readiness ────────────────────────────────────────────────────────────
create or replace function sehat_intl_readiness(p_business uuid, p_level text default 'list')
returns jsonb language sql stable security definer set search_path = public as $$
  with h as (select checklist from intl_hospitals where business_id = p_business),
  cur as (select * from intl_documents where business_id = p_business and status <> 'replaced')
  select coalesce(jsonb_agg(jsonb_build_object('key', i.key, 'label', i.label, 'why', w.why) order by i.sort), '[]'::jsonb)
  from intl_check_items i
  left join cur d on d.item_key = i.key
  cross join lateral (select case
      when not i.needs_doc then
        case when coalesce((select (checklist->i.key->>'ok')::boolean from h), false) then null else 'Not ticked' end
      when d.id is null then 'No document uploaded'
      when d.status = 'rejected' then 'Rejected: ' || coalesce(d.reason, 'see note')
      when i.needs_expiry and d.expires is null then 'No expiry date'
      when i.needs_expiry and d.expires < current_date then 'Expired on ' || to_char(d.expires, 'DD Mon YYYY')
      when p_level = 'list' and d.status <> 'verified' then 'Waiting for Sehatsandhi to check'
      else null end as why) w
  where i.required and w.why is not null
$$;

-- ── Hospital: upload ────────────────────────────────────────────────────────
create or replace function sehat_intl_doc_add(p_business uuid, p_item text, p_path text, p_expires date default null,
                                              p_name text default null, p_size integer default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  i intl_check_items; v_id uuid; v_old intl_documents; h intl_hospitals;
begin
  perform sehat_intl_check(p_business);
  select * into i from intl_check_items where key = p_item;
  if i.key is null or not i.needs_doc then raise exception 'This item does not take a document.' using errcode = '22023'; end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> p_business::text
     or not exists (select 1 from storage.objects where bucket_id = 'intl-docs' and name = p_path) then
    raise exception 'The file did not upload. Please try again.' using errcode = 'P0002';
  end if;
  if i.needs_expiry and p_expires is null then raise exception 'Enter the expiry date for this document.' using errcode = '22023'; end if;
  if p_expires is not null and p_expires < current_date then raise exception 'This document has already expired.' using errcode = '22023'; end if;

  insert into intl_hospitals (business_id) values (p_business) on conflict (business_id) do nothing;
  select * into v_old from intl_documents where business_id = p_business and item_key = p_item and status <> 'replaced';
  if v_old.id is not null then
    update intl_documents set status = 'replaced' where id = v_old.id;
  end if;
  insert into intl_documents (business_id, item_key, path, file_name, size_bytes, expires, uploaded_by, uploaded_by_name)
  values (p_business, p_item, p_path, left(p_name, 200), p_size, p_expires, auth.uid(), sehat_intl_actor_name())
  returning id into v_id;
  update intl_hospitals set checklist = jsonb_set(checklist, array[p_item], coalesce(checklist->p_item, '{}'::jsonb) || '{"ok":true}'::jsonb),
                            updated_at = now()
   where business_id = p_business;
  perform sehat_intl_log(p_business, case when v_old.id is null then 'uploaded' else 'replaced' end,
                         coalesce(p_name, '') || case when p_expires is not null then ' · expires ' || to_char(p_expires, 'DD Mon YYYY') else '' end,
                         v_id, p_item);

  select * into h from intl_hospitals where business_id = p_business;
  if h.status in ('submitted', 'reviewing', 'listed', 'paused') then
    perform sehat_intl_notify(p_business, 'admin',
      'Document to check — ' || (select name from businesses where id = p_business),
      array[(select name from businesses where id = p_business) || ' uploaded ' || p_item || ': ' || i.label || '.',
            case when v_old.id is not null then 'It replaces the earlier document, which was ' || v_old.status || '.' else 'New document.' end,
            'Check it in Admin → International → Hospitals.']);
  end if;
  return v_id;
end $$;

-- ── Hospital: send for review (now refuses while anything is missing) ──────
create or replace function sehat_intl_submit(p_business uuid, p_signatory text, p_version text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare h intl_hospitals; v_missing jsonb;
begin
  perform sehat_intl_check(p_business);
  select * into h from intl_hospitals where business_id = p_business;
  if h.business_id is null then raise exception 'Save your details first.' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_signatory, ''))) < 3 then
    raise exception 'Type the full name of the person accepting the agreement.' using errcode = '22023';
  end if;
  if h.coordinator_name is null or h.coordinator_phone is null then
    raise exception 'Add your international patient coordinator first.' using errcode = '22023';
  end if;
  if coalesce(h.beds, 0) < 1 then raise exception 'Add your number of beds first.' using errcode = '22023'; end if;
  v_missing := sehat_intl_readiness(p_business, 'submit');
  if jsonb_array_length(v_missing) > 0 then
    raise exception '% required checklist item(s) still missing, starting with %: %.',
      jsonb_array_length(v_missing), v_missing->0->>'key', v_missing->0->>'why' using errcode = 'P0001';
  end if;
  update intl_hospitals set
    agreement_version = left(coalesce(p_version, 'v1'), 40),
    agreement_signatory = left(btrim(p_signatory), 120),
    agreement_accepted_at = now(),
    agreement_accepted_by = auth.uid(),
    status = case when status in ('draft', 'rejected') then 'submitted' else status end,
    submitted_at = case when status in ('draft', 'rejected') then now() else submitted_at end,
    updated_at = now()
  where business_id = p_business;
  perform sehat_intl_log(p_business, 'submitted', 'Agreement ' || left(coalesce(p_version, 'v1'), 40) || ' accepted by ' || left(btrim(p_signatory), 120));
  perform sehat_intl_notify(p_business, 'admin', 'New international application — ' || (select name from businesses where id = p_business),
    array[(select name from businesses where id = p_business) || ' sent its application for review.',
          'Check each document and book the video walkthrough in Admin → International → Hospitals.']);
end $$;

-- ── Admin: check a document ─────────────────────────────────────────────────
create or replace function sehat_intl_doc_review(p_doc uuid, p_ok boolean, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare d intl_documents; h intl_hospitals; v_label text;
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into d from intl_documents where id = p_doc;
  if d.id is null or d.status = 'replaced' then raise exception 'This document has been replaced; check the newer one.' using errcode = 'P0002'; end if;
  if not p_ok and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Write the reason, so the hospital knows what to fix.' using errcode = '22023';
  end if;
  update intl_documents set status = case when p_ok then 'verified' else 'rejected' end,
    reason = case when p_ok then null else left(btrim(p_reason), 500) end,
    reviewed_by = auth.uid(), reviewed_by_name = sehat_intl_actor_name(), reviewed_at = now()
  where id = p_doc;
  select label into v_label from intl_check_items where key = d.item_key;
  perform sehat_intl_log(d.business_id, case when p_ok then 'verified' else 'rejected' end,
                         case when p_ok then null else btrim(p_reason) end, d.id, d.item_key);
  if not p_ok then
    perform sehat_intl_notify(d.business_id, 'hospital', 'A document needs fixing — Sehatsandhi International',
      array['Sehatsandhi could not accept this document: ' || d.item_key || ' — ' || v_label || '.',
            'Reason: ' || btrim(p_reason),
            'Please upload a corrected document in your dashboard → International → Checklist.']);
  end if;

  -- A listing paused only because a document expired comes back by itself.
  select * into h from intl_hospitals where business_id = d.business_id;
  if p_ok and h.status = 'paused' and h.auto_paused and h.video_checked_at is not null and h.star is not null
     and jsonb_array_length(sehat_intl_readiness(d.business_id, 'list')) = 0 then
    update intl_hospitals set status = 'listed', auto_paused = false, admin_note = null, updated_at = now() where business_id = d.business_id;
    perform sehat_intl_log(d.business_id, 'relisted', 'Every required document is in date and checked again.');
    perform sehat_intl_notify(d.business_id, 'hospital', 'Your international listing is back on — Sehatsandhi',
      array['Thank you for renewing your document. Your hospital is listed again for international patients.']);
  end if;
end $$;

-- ── Admin: status (listing now needs every document verified) ──────────────
create or replace function sehat_intl_admin_review(p_business uuid, p_status text, p_star text default null,
                                                   p_city_level text default null, p_note text default null,
                                                   p_docs_checked boolean default null, p_video_checked boolean default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare h intl_hospitals; v_missing jsonb; v_video boolean;
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into h from intl_hospitals where business_id = p_business;
  if h.business_id is null then raise exception 'No application from this hospital.' using errcode = 'P0002'; end if;
  if p_status not in ('submitted', 'reviewing', 'listed', 'paused', 'rejected') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if p_star is not null and p_star not in ('4', '5') then raise exception 'Star level is 4 or 5.' using errcode = '22023'; end if;
  if p_city_level is not null and p_city_level not in ('metro', 'regional', 'smaller') then raise exception 'Unknown city level.' using errcode = '22023'; end if;
  v_video := coalesce(p_video_checked, h.video_checked_at is not null);
  v_missing := sehat_intl_readiness(p_business, 'list');
  if p_status = 'listed' then
    if h.agreement_accepted_at is null then raise exception 'The hospital has not accepted the agreement.' using errcode = 'P0001'; end if;
    if jsonb_array_length(v_missing) > 0 then
      raise exception 'Cannot list yet: % required item(s) not ready, starting with %: %.',
        jsonb_array_length(v_missing), v_missing->0->>'key', v_missing->0->>'why' using errcode = 'P0001';
    end if;
    if not v_video then raise exception 'Tick "video walkthrough done" first.' using errcode = 'P0001'; end if;
    if coalesce(p_star, h.star) is null then raise exception 'Set the star level (4 or 5) first.' using errcode = 'P0001'; end if;
  end if;
  update intl_hospitals set
    status = p_status,
    auto_paused = false,
    star = coalesce(p_star, star),
    city_level = case when p_city_level is null then city_level else p_city_level end,
    admin_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), admin_note),
    docs_checked_at = case when jsonb_array_length(v_missing) = 0 then coalesce(docs_checked_at, now()) else null end,
    video_checked_at = case when v_video then coalesce(video_checked_at, now()) else null end,
    listed_at = case when p_status = 'listed' then coalesce(listed_at, now()) else listed_at end,
    updated_at = now()
  where business_id = p_business;
  if p_status is distinct from h.status then
    perform sehat_intl_log(p_business, p_status, nullif(btrim(coalesce(p_note, '')), ''));
    perform sehat_intl_notify(p_business, 'hospital', 'Your international application: ' ||
      case p_status when 'listed' then 'listed' when 'paused' then 'paused' when 'rejected' then 'not approved'
                    when 'reviewing' then 'under review' else 'received' end || ' — Sehatsandhi',
      array[case p_status
              when 'listed' then 'Your hospital is now listed for international patients on sehatsandhi.com/international.'
              when 'paused' then 'Your international listing is paused for now.'
              when 'rejected' then 'Your application was not approved yet. You can fix the items and send it again.'
              when 'reviewing' then 'We are checking your documents. We will contact your coordinator to book the video walkthrough.'
              else 'We have your application.' end,
            coalesce('Note from Sehatsandhi: ' || nullif(btrim(coalesce(p_note, '')), ''), '')]);
  end if;
  if coalesce(p_video_checked, false) and h.video_checked_at is null then
    perform sehat_intl_log(p_business, 'video_checked');
  end if;
end $$;

-- ── 5. Daily: reminders and expiry ──────────────────────────────────────────
create or replace function sehat_intl_expiry_sweep()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare r record; n integer := 0; v_name text;
begin
  -- Reminders: 30 and 7 days before, once each per document.
  for r in
    select d.*, i.label, k.days
      from intl_documents d join intl_check_items i on i.key = d.item_key
      join intl_hospitals h on h.business_id = d.business_id
      cross join (values (30), (7)) k(days)
     where d.status <> 'replaced' and d.expires = current_date + k.days
       and h.status in ('submitted', 'reviewing', 'listed', 'paused')
       and not exists (select 1 from intl_doc_events e where e.document_id = d.id and e.action = 'reminder_' || k.days)
  loop
    insert into intl_doc_events (business_id, document_id, item_key, action, note, actor_name)
    values (r.business_id, r.id, r.item_key, 'reminder_' || r.days, 'Expires ' || to_char(r.expires, 'DD Mon YYYY'), 'System');
    perform sehat_intl_notify(r.business_id, 'hospital', 'Renew in ' || r.days || ' days: ' || r.label,
      array['Your document ' || r.item_key || ' — ' || r.label || ' — expires on ' || to_char(r.expires, 'DD Mon YYYY') || '.',
            case when exists (select 1 from intl_check_items where key = r.item_key and required)
                 then 'If it is not renewed by then, your international listing pauses on that day.' else '' end,
            'Upload the renewed document in your dashboard → International → Checklist.']);
    n := n + 1;
  end loop;

  -- Expired required documents pause a listed hospital.
  for r in
    select distinct on (h.business_id) h.business_id, d.id as doc_id, d.item_key, d.expires, i.label
      from intl_hospitals h join intl_documents d on d.business_id = h.business_id and d.status <> 'replaced'
      join intl_check_items i on i.key = d.item_key and i.required and i.needs_expiry
     where h.status = 'listed' and d.expires < current_date
     order by h.business_id, d.expires
  loop
    select name into v_name from businesses where id = r.business_id;
    update intl_hospitals set status = 'paused', auto_paused = true,
      admin_note = 'Paused automatically: ' || r.item_key || ' (' || r.label || ') expired on ' || to_char(r.expires, 'DD Mon YYYY')
                   || '. Upload the renewal; the listing comes back once it is checked.',
      updated_at = now()
     where business_id = r.business_id;
    insert into intl_doc_events (business_id, document_id, item_key, action, note, actor_name)
    values (r.business_id, r.doc_id, r.item_key, 'paused', 'Expired on ' || to_char(r.expires, 'DD Mon YYYY'), 'System');
    perform sehat_intl_notify(r.business_id, 'hospital', 'International listing paused — document expired',
      array[r.item_key || ' — ' || r.label || ' — expired on ' || to_char(r.expires, 'DD Mon YYYY') || '.',
            'Your listing is paused. Upload the renewal in your dashboard → International; it comes back once Sehatsandhi checks it.']);
    perform sehat_intl_notify(r.business_id, 'admin', 'Listing paused (expired document) — ' || v_name,
      array[v_name || ': ' || r.item_key || ' expired on ' || to_char(r.expires, 'DD Mon YYYY') || '. The listing paused automatically.']);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_intl_expiry_sweep() from public, anon, authenticated;

-- ── 6. Audit links ──────────────────────────────────────────────────────────
create table if not exists intl_audit_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  label text not null,
  business_ids uuid[] not null default '{}',
  expires_at timestamptz not null,
  passcode_hash text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
create table if not exists intl_audit_log (
  id bigint generated always as identity primary key,
  link_id uuid not null references intl_audit_links(id) on delete cascade,
  action text not null,
  business_id uuid,
  document_id uuid,
  ip text,
  user_agent text,
  at timestamptz not null default now()
);
create index if not exists intl_audit_log_link_idx on intl_audit_log (link_id, at desc);

alter table intl_audit_links enable row level security;
alter table intl_audit_log enable row level security;
drop policy if exists intl_audit_links_read on intl_audit_links;
create policy intl_audit_links_read on intl_audit_links for select to authenticated using (sehat_is_admin());
drop policy if exists intl_audit_log_read on intl_audit_log;
create policy intl_audit_log_read on intl_audit_log for select to authenticated using (sehat_is_admin());
revoke all on intl_audit_links, intl_audit_log from anon;
revoke insert, update, delete on intl_audit_links, intl_audit_log from authenticated;
grant select on intl_audit_links, intl_audit_log to authenticated;

create or replace function sehat_intl_audit_create(p_label text, p_businesses uuid[], p_days integer, p_passcode text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_token text;
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_label, ''))) < 3 then raise exception 'Say who the link is for.' using errcode = '22023'; end if;
  if coalesce(p_days, 0) not between 1 and 30 then raise exception 'A link lasts 1 to 30 days.' using errcode = '22023'; end if;
  if p_passcode is not null and btrim(p_passcode) <> '' and length(btrim(p_passcode)) < 6 then
    raise exception 'A passcode needs at least 6 characters.' using errcode = '22023';
  end if;
  insert into intl_audit_links (label, business_ids, expires_at, passcode_hash, created_by, created_by_name)
  values (left(btrim(p_label), 120), coalesce(p_businesses, '{}'), now() + make_interval(days => p_days),
          case when coalesce(btrim(p_passcode), '') = '' then null else extensions.crypt(btrim(p_passcode), extensions.gen_salt('bf')) end,
          auth.uid(), sehat_intl_actor_name())
  returning token into v_token;
  return v_token;
end $$;

create or replace function sehat_intl_audit_revoke(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  update intl_audit_links set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end $$;

-- The caller's address and browser, as PostgREST passes them through.
create or replace function sehat_intl_req(p_what text)
returns text language sql stable as $$
  select left(case p_what
    when 'ip' then split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1)
    else coalesce(current_setting('request.headers', true)::json->>'user-agent', '') end, 300)
$$;

-- Check a link. Never raises (a raise would also undo the log of a wrong
-- passcode): returns {ok, link_id, error, passcode}. Wrong passcodes are
-- logged; 10 in an hour lock the link for that hour.
create or replace function sehat_intl_audit_check(p_token text, p_passcode text, p_ip text, p_ua text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l intl_audit_links;
begin
  select * into l from intl_audit_links where token = p_token and length(coalesce(p_token, '')) >= 24;
  if l.id is null or l.revoked_at is not null or l.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This link has expired or been withdrawn. Please ask Sehatsandhi for a new one.');
  end if;
  if (select count(*) from intl_audit_log where link_id = l.id and action = 'bad_passcode' and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'passcode', true, 'error', 'Too many wrong passcodes. Try again in an hour.');
  end if;
  if l.passcode_hash is not null and (coalesce(btrim(p_passcode), '') = '' or extensions.crypt(btrim(p_passcode), l.passcode_hash) <> l.passcode_hash) then
    if coalesce(btrim(p_passcode), '') <> '' then
      insert into intl_audit_log (link_id, action, ip, user_agent) values (l.id, 'bad_passcode', p_ip, p_ua);
    end if;
    return jsonb_build_object('ok', false, 'passcode', true,
      'error', case when coalesce(btrim(p_passcode), '') = '' then null else 'That passcode is not right.' end);
  end if;
  update intl_audit_links set last_used_at = now() where id = l.id;
  return jsonb_build_object('ok', true, 'link_id', l.id);
end $$;
revoke all on function sehat_intl_audit_check(text, text, text, text) from public, anon, authenticated;

create or replace function sehat_intl_audit_scope(p_link uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select h.business_id from intl_hospitals h, intl_audit_links l
   where l.id = p_link
     and ((cardinality(l.business_ids) = 0 and h.status in ('submitted', 'reviewing', 'listed', 'paused'))
          or h.business_id = any(l.business_ids))
$$;
revoke all on function sehat_intl_audit_scope(uuid) from public, anon, authenticated;

-- What the audit page shows. Logged as 'open'.
create or replace function sehat_intl_audit_open(p_token text, p_passcode text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c jsonb; l intl_audit_links;
begin
  c := sehat_intl_audit_check(p_token, p_passcode, sehat_intl_req('ip'), sehat_intl_req('ua'));
  if not (c->>'ok')::boolean then return c; end if;
  select * into l from intl_audit_links where id = (c->>'link_id')::uuid;
  insert into intl_audit_log (link_id, action, ip, user_agent) values (l.id, 'open', sehat_intl_req('ip'), sehat_intl_req('ua'));
  return jsonb_build_object(
    'ok', true, 'label', l.label, 'expires_at', l.expires_at, 'issued_by', 'Sehatsandhi (NG Technologies)', 'issued_at', l.created_at,
    'items', (select jsonb_agg(jsonb_build_object('key', key, 'grp', grp, 'label', label, 'needs_doc', needs_doc,
                                                  'needs_expiry', needs_expiry, 'required', required) order by sort) from intl_check_items),
    'hospitals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'address', b.address,
        'city', coalesce(nullif(b.own_city, ''), b.own_district), 'state', b.own_state,
        'reg_number', b.reg_number, 'gstin', b.gstin,
        'status', h.status, 'star', h.star, 'nabh', h.nabh, 'beds', h.beds, 'icu_beds', h.icu_beds,
        'agreement_version', h.agreement_version, 'agreement_signatory', h.agreement_signatory, 'agreement_accepted_at', h.agreement_accepted_at,
        'video_checked_at', h.video_checked_at, 'listed_at', h.listed_at,
        'checklist', h.checklist,
        'missing', sehat_intl_readiness(h.business_id, 'list'),
        'documents', coalesce((select jsonb_agg(jsonb_build_object(
            'id', d.id, 'item_key', d.item_key, 'file_name', d.file_name, 'expires', d.expires, 'status', d.status,
            'reason', d.reason, 'uploaded_at', d.uploaded_at, 'uploaded_by_name', d.uploaded_by_name,
            'reviewed_by_name', d.reviewed_by_name, 'reviewed_at', d.reviewed_at) order by d.item_key, d.uploaded_at desc)
            from intl_documents d where d.business_id = h.business_id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'item_key', e.item_key,
            'note', e.note, 'by', e.actor_name) order by e.at desc)
            from (select * from intl_doc_events where business_id = h.business_id order by at desc limit 300) e), '[]'::jsonb))
        order by b.name)
      from intl_hospitals h join businesses b on b.id = h.business_id
      where h.business_id in (select sehat_intl_audit_scope(l.id))), '[]'::jsonb));
end $$;

-- For the intl-audit-file function (service role): check the link, log each
-- file, and return the storage paths of the requested documents it may see.
-- A bad link or passcode returns no rows.
create or replace function sehat_intl_audit_files(p_token text, p_passcode text, p_ids uuid[], p_action text,
                                                  p_ip text default null, p_ua text default null)
returns table (id uuid, path text, file_name text, item_key text, business_name text)
language plpgsql volatile security definer set search_path = public as $$
declare c jsonb; v_link uuid;
begin
  c := sehat_intl_audit_check(p_token, p_passcode, p_ip, p_ua);
  if not (c->>'ok')::boolean or cardinality(coalesce(p_ids, '{}')) = 0 or cardinality(p_ids) > 200 then return; end if;
  v_link := (c->>'link_id')::uuid;
  insert into intl_audit_log (link_id, action, business_id, document_id, ip, user_agent)
  select v_link, case when p_action = 'zip' then 'download_zip' else 'download' end, d.business_id, d.id, p_ip, p_ua
    from intl_documents d where d.id = any(p_ids) and d.business_id in (select sehat_intl_audit_scope(v_link));
  return query select d.id, d.path, d.file_name, d.item_key, b.name
    from intl_documents d join businesses b on b.id = d.business_id
   where d.id = any(p_ids) and d.business_id in (select sehat_intl_audit_scope(v_link));
end $$;
revoke all on function sehat_intl_audit_files(text, text, uuid[], text, text, text) from public, anon, authenticated;
grant execute on function sehat_intl_audit_files(text, text, uuid[], text, text, text) to service_role;

-- ── 7. Backup ───────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('intl-docs-backup', 'intl-docs-backup', false)
on conflict (id) do nothing;
-- No policies on intl-docs-backup: only the service role (the backup function) touches it.

create table if not exists intl_backup_files (
  path text primary key,
  size_bytes bigint,
  target text not null,
  copied_at timestamptz not null default now()
);
create table if not exists intl_backup_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  target text,
  copied integer not null default 0,
  already integer not null default 0,
  failed integer not null default 0,
  error text
);
alter table intl_backup_files enable row level security;
alter table intl_backup_runs enable row level security;
drop policy if exists intl_backup_runs_read on intl_backup_runs;
create policy intl_backup_runs_read on intl_backup_runs for select to authenticated using (sehat_is_admin());
revoke all on intl_backup_files, intl_backup_runs from anon, authenticated;
grant select on intl_backup_runs to authenticated;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function sehat_intl_readiness(uuid, text) from public, anon;
revoke all on function sehat_intl_doc_add(uuid, text, text, date, text, integer) from public, anon;
revoke all on function sehat_intl_doc_review(uuid, boolean, text) from public, anon;
revoke all on function sehat_intl_audit_create(text, uuid[], integer, text) from public, anon;
revoke all on function sehat_intl_audit_revoke(uuid) from public, anon;
revoke all on function sehat_intl_audit_open(text, text) from public;
grant execute on function sehat_intl_readiness(uuid, text), sehat_intl_doc_add(uuid, text, text, date, text, integer),
  sehat_intl_doc_review(uuid, boolean, text), sehat_intl_audit_create(text, uuid[], integer, text),
  sehat_intl_audit_revoke(uuid) to authenticated;
grant execute on function sehat_intl_audit_open(text, text) to anon, authenticated;

-- ── Schedules ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('intl-expiry', 'intl-docs-backup');
  -- 02:30 UTC = 08:00 in India.
  perform cron.schedule('intl-expiry', '30 2 * * *', $job$ select sehat_intl_expiry_sweep() $job$);
  -- Sundays 21:30 UTC = Monday 03:00 in India.
  perform cron.schedule('intl-docs-backup', '30 21 * * 0', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/intl-docs-backup',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000)
  $job$);
end $$;

notify pgrst, 'reload schema';
