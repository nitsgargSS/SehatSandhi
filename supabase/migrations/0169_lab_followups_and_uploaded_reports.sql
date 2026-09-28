-- ============================================================================
-- Sehatsandhi — the lab's CRM: repeat tests, follow-ups, campaigns; and
-- uploaded reports sent to the patient as they are
--
-- Run AFTER 0168. Safe to re-run.
--
-- ── REPEAT TESTS ────────────────────────────────────────────────────────────
-- A diabetic's HbA1c is due every three months, a thyroid patient's TSH every
-- six. Each test carries a repeat interval (repeat_days; the catalogue sets
-- sensible ones, the lab changes them). When a result is APPROVED, the
-- patient's next test is scheduled in lab_followups — sooner, at half the
-- interval (never under 30 days), when any value was out of range.
-- When that test is ordered again for the patient, the follow-up is marked
-- "booked" by itself; the new report closes it and plans the next one.
-- Both happen in triggers on lab_order_items, so every way an order is
-- created or approved keeps the follow-ups right.
--
-- The lab screen lists what is due this week, overdue, abnormal-not-repeated
-- and lapsed patients, with one-tap WhatsApp (the lab's own WhatsApp, click
-- to chat — no template needed) and call, and a campaign list to download.
--
-- ── UPLOADED REPORTS ────────────────────────────────────────────────────────
-- Decided 28 Sep 2026: no AI reading. A lab uploads a report file (PDF or a
-- photo) for a patient — a report from its own machine, or one done at
-- another lab — and it goes to the patient on WhatsApp EXACTLY as uploaded,
-- as a link to that file (/lab/file/<token>, served by lab-file-view). Nothing
-- is read out of it, changed or re-printed. The lab keeps it, and can resend
-- it whenever the patient asks, for as long as it is kept:
-- businesses.lab_report_retention_days (365 by default; an admin sets it by
-- plan). After that the existing daily document purge (0058/0059) deletes the
-- file, and the link stops working.
--
-- The file is a patient_documents row (kind lab_report) with retain_until set
-- to the lab's retention, so it rides the storage, purge and access rules that
-- already exist. It is recorded through sehat_lab_upload_report, not a direct
-- insert: a lab technician (nurse role, linked to no doctor) may upload but
-- could not read a direct insert back under 0149's rule.
-- ============================================================================

alter table lab_catalogue add column if not exists repeat_days integer check (repeat_days is null or repeat_days between 7 and 1095);
alter table lab_tests add column if not exists repeat_days integer check (repeat_days is null or repeat_days between 7 and 1095);

update lab_catalogue c set repeat_days = v.d from (values
  ('CBC',180),('PTINR',30),('FBS',90),('PPBS',90),('HBA1C',90),('LIPID',180),('LFT',180),('KFT',180),
  ('CREAT',90),('URIC',90),('ELEC',90),('CALC',180),('IRON',90),('THY',180),('TSH',180),('VITD',90),
  ('B12',90),('INSF',180),('PSA',365),('RAF',180),('URINE',180),('ECG',365),('ECHO',365)
) as v(code, d) where c.code = v.code;

-- Tests already imported from the catalogue pick the interval up, unless set.
update lab_tests t set repeat_days = c.repeat_days
  from lab_catalogue c where t.catalogue_code = c.code and t.repeat_days is null and c.repeat_days is not null;

-- 0168's import copies repeat_days from now on.
create or replace function sehat_lab_copy_repeat_days()
returns trigger language plpgsql as $$
begin
  if new.repeat_days is null and new.catalogue_code is not null then
    select repeat_days into new.repeat_days from lab_catalogue where code = new.catalogue_code;
  end if;
  return new;
end $$;
drop trigger if exists a_lab_copy_repeat_days on lab_tests;
create trigger a_lab_copy_repeat_days before insert on lab_tests
  for each row execute function sehat_lab_copy_repeat_days();

-- The test editor saves it through 0168's save RPC (p_test.repeat_days).
create or replace function sehat_lab_set_repeat_days(p_test uuid, p_days integer)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from lab_tests where id = p_test;
  if v_biz is null then raise exception 'No such test.' using errcode = 'P0002'; end if;
  perform sehat_lab_check(v_biz, 'manage');
  update lab_tests set repeat_days = case when p_days > 0 then p_days end where id = p_test;
end $$;
revoke all on function sehat_lab_set_repeat_days(uuid, integer) from public, anon;
grant execute on function sehat_lab_set_repeat_days(uuid, integer) to authenticated;


-- ============================================================================
-- 1. Follow-ups
-- ============================================================================

create table if not exists lab_followups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  test_id uuid references lab_tests(id) on delete cascade,
  test_name text not null,
  from_order_id uuid references lab_orders(id) on delete set null,
  due_on date not null,
  reason text not null default 'routine' check (reason in ('routine','abnormal','manual')),
  status text not null default 'due' check (status in ('due','reminded','booked','done','dismissed')),
  reminded_at timestamptz,
  reminded_count integer not null default 0,
  booked_order_id uuid references lab_orders(id) on delete set null,
  note text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lab_followups_due_idx on lab_followups (business_id, status, due_on);
create index if not exists lab_followups_member_idx on lab_followups (patient_member_id, test_id);
-- One open follow-up per patient per test.
create unique index if not exists lab_followups_one_open on lab_followups (business_id, patient_member_id, test_id)
  where status in ('due','reminded','booked');

-- A test ordered again: its open follow-up is booked.
create or replace function sehat_lab_followup_on_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select business_id, patient_member_id into o from lab_orders where id = new.order_id;
  update lab_followups set status = 'booked', booked_order_id = new.order_id, updated_at = now()
   where business_id = o.business_id and patient_member_id = o.patient_member_id
     and test_id = new.test_id and status in ('due','reminded');
  return new;
end $$;
drop trigger if exists z_lab_followup_on_order on lab_order_items;
create trigger z_lab_followup_on_order after insert on lab_order_items
  for each row execute function sehat_lab_followup_on_order();

-- A result approved: close what was open for this test and plan the next.
create or replace function sehat_lab_followup_on_approve()
returns trigger language plpgsql security definer set search_path = public as $$
declare o record; t record; v_abn boolean; v_days integer;
begin
  if new.status <> 'approved' or old.status = 'approved' or new.test_id is null then return new; end if;
  select id, business_id, patient_member_id into o from lab_orders where id = new.order_id;
  select id, name, repeat_days into t from lab_tests where id = new.test_id;

  update lab_followups set status = 'done', updated_at = now()
   where business_id = o.business_id and patient_member_id = o.patient_member_id
     and test_id = new.test_id and status in ('due','reminded','booked');

  if t.repeat_days is null then return new; end if;
  v_abn := exists (select 1 from lab_results r where r.order_item_id = new.id and r.flag in ('H','L'));
  v_days := case when v_abn then greatest(30, t.repeat_days / 2) else t.repeat_days end;
  insert into lab_followups (business_id, patient_member_id, test_id, test_name, from_order_id, due_on, reason, created_by_name)
  values (o.business_id, o.patient_member_id, t.id, t.name, o.id, current_date + v_days,
          case when v_abn then 'abnormal' else 'routine' end, 'Scheduled on approval');
  return new;
end $$;
drop trigger if exists z_lab_followup_on_approve on lab_order_items;
create trigger z_lab_followup_on_approve after update of status on lab_order_items
  for each row execute function sehat_lab_followup_on_approve();

-- Add one by hand ("repeat lipids in 3 months" from a doctor's note).
create or replace function sehat_lab_add_followup(p_business uuid, p_member uuid, p_test uuid, p_due date, p_note text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  perform sehat_lab_check(p_business, 'staff');
  select name into v_name from lab_tests where id = p_test and business_id = p_business;
  if v_name is null then raise exception 'No such test at this lab.' using errcode = 'P0002'; end if;
  if p_due is null then raise exception 'Give the due date.' using errcode = '22023'; end if;
  update lab_followups set status = 'dismissed', note = coalesce(note || ' · ', '') || 'replaced', updated_at = now()
   where business_id = p_business and patient_member_id = p_member and test_id = p_test and status in ('due','reminded','booked');
  insert into lab_followups (business_id, patient_member_id, test_id, test_name, due_on, reason, note, created_by_name)
  values (p_business, p_member, p_test, v_name, p_due, 'manual', nullif(btrim(coalesce(p_note,'')), ''), sehat_lab_staff_name(p_business))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function sehat_lab_add_followup(uuid, uuid, uuid, date, text) from public, anon;
grant execute on function sehat_lab_add_followup(uuid, uuid, uuid, date, text) to authenticated;

-- p_action: reminded | reschedule (p_due) | dismiss.
create or replace function sehat_lab_followup_action(p_id uuid, p_action text, p_due date default null, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare f record;
begin
  select * into f from lab_followups where id = p_id for update;
  if not found then raise exception 'No such follow-up.' using errcode = 'P0002'; end if;
  perform sehat_lab_check(f.business_id, 'staff');
  if p_action = 'reminded' then
    update lab_followups set status = case when status = 'due' then 'reminded' else status end,
           reminded_at = now(), reminded_count = reminded_count + 1, updated_at = now(),
           note = coalesce(nullif(btrim(coalesce(p_note,'')), ''), note)
     where id = p_id;
  elsif p_action = 'reschedule' then
    if p_due is null then raise exception 'Give the new date.' using errcode = '22023'; end if;
    update lab_followups set due_on = p_due, status = 'due', updated_at = now(),
           note = coalesce(nullif(btrim(coalesce(p_note,'')), ''), note) where id = p_id;
  elsif p_action = 'dismiss' then
    update lab_followups set status = 'dismissed', updated_at = now(),
           note = coalesce(nullif(btrim(coalesce(p_note,'')), ''), note) where id = p_id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end $$;
revoke all on function sehat_lab_followup_action(uuid, text, date, text) from public, anon;
grant execute on function sehat_lab_followup_action(uuid, text, date, text) to authenticated;

-- Not security_invoker, deliberately: lab work is department-wide (0168), but
-- the patient tables it joins are narrowed per nurse (0149), which silently
-- dropped rows from a technician's list. The view runs as its owner and
-- filters to the caller's own lab itself.
create or replace view lab_followup_detail as
  select f.*,
         pm.full_name as patient_name, pm.age_years as patient_age, pa.phone as patient_phone,
         (f.due_on - current_date) as days_to_due,
         (select o.order_no from lab_orders o where o.id = f.from_order_id) as from_order_no,
         (select o.reported_at from lab_orders o where o.id = f.from_order_id) as last_tested_at,
         (select o.order_no from lab_orders o where o.id = f.booked_order_id) as booked_order_no
    from lab_followups f
    join patient_members pm on pm.id = f.patient_member_id
    join patients pa on pa.id = pm.patient_id
   where sehat_caller_owns_business(f.business_id);
alter view lab_followup_detail set (security_invoker = false);
grant select on lab_followup_detail to authenticated;

-- The numbers at the top of the screen, and the conversion that matters:
-- of those reminded in the period, how many came back.
create or replace function sehat_lab_crm_summary(p_business uuid, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
begin
  perform sehat_lab_check(p_business, 'staff');
  return jsonb_build_object(
    'due_7d', (select count(*) from lab_followups where business_id = p_business and status in ('due','reminded') and due_on between current_date and current_date + 7),
    'overdue', (select count(*) from lab_followups where business_id = p_business and status in ('due','reminded') and due_on < current_date),
    'abnormal_open', (select count(*) from lab_followups where business_id = p_business and status in ('due','reminded') and reason = 'abnormal'),
    'reminded', (select count(*) from lab_followups where business_id = p_business and reminded_at >= v_since),
    'came_back', (select count(*) from lab_followups where business_id = p_business and reminded_at >= v_since and status in ('booked','done')),
    'booked_revenue', (select coalesce(sum(c.amount), 0) from lab_followups f join lab_orders o on o.id = f.booked_order_id
                         join patient_charges c on c.business_id = o.business_id and c.patient_member_id = o.patient_member_id
                                               and c.category = 'lab' and c.description like '%(' || o.order_no || ')'
                        where f.business_id = p_business and f.reminded_at >= v_since),
    'lapsed_12m', (select count(*) from (select o.patient_member_id from lab_orders o
                    where o.business_id = p_business and o.status <> 'cancelled'
                    group by o.patient_member_id having max(o.created_at) < now() - interval '365 days') x)
  );
end $$;
revoke all on function sehat_lab_crm_summary(uuid, integer) from public, anon;
grant execute on function sehat_lab_crm_summary(uuid, integer) to authenticated;

-- A campaign list. p_segment: overdue | due_7d | due_30d | abnormal | lapsed.
-- Names and numbers of this lab's own patients, for its own staff to contact.
create or replace function sehat_lab_segment(p_business uuid, p_segment text)
returns table (patient_member_id uuid, patient_name text, patient_phone text, detail text, due_on date, last_tested_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_lab_check(p_business, 'staff');
  if p_segment = 'lapsed' then
    return query
      select pm.id, pm.full_name, pa.phone, 'Last test ' || to_char(max(o.created_at) at time zone 'Asia/Kolkata', 'DD Mon YYYY'),
             null::date, max(o.created_at)
        from lab_orders o join patient_members pm on pm.id = o.patient_member_id join patients pa on pa.id = pm.patient_id
       where o.business_id = p_business and o.status <> 'cancelled'
       group by pm.id, pm.full_name, pa.phone
      having max(o.created_at) < now() - interval '365 days'
       order by max(o.created_at) desc;
  else
    return query
      select f.patient_member_id, pm.full_name, pa.phone,
             string_agg(f.test_name || case when f.reason = 'abnormal' then ' (abnormal)' else '' end, ', ' order by f.due_on),
             min(f.due_on), max((select o.reported_at from lab_orders o where o.id = f.from_order_id))
        from lab_followups f join patient_members pm on pm.id = f.patient_member_id join patients pa on pa.id = pm.patient_id
       where f.business_id = p_business and f.status in ('due','reminded')
         and case p_segment
               when 'overdue' then f.due_on < current_date
               when 'due_7d' then f.due_on between current_date and current_date + 7
               when 'due_30d' then f.due_on between current_date and current_date + 30
               when 'abnormal' then f.reason = 'abnormal'
               else false end
       group by f.patient_member_id, pm.full_name, pa.phone
       order by min(f.due_on);
  end if;
end $$;
revoke all on function sehat_lab_segment(uuid, text) from public, anon;
grant execute on function sehat_lab_segment(uuid, text) to authenticated;


-- ============================================================================
-- 2. Uploaded reports
-- ============================================================================

alter table businesses add column if not exists lab_report_retention_days integer not null default 365
  check (lab_report_retention_days between 30 and 3650);

create table if not exists lab_uploaded_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  order_id uuid references lab_orders(id) on delete set null,
  document_id uuid not null references patient_documents(id) on delete cascade,
  title text not null,
  mime_type text,
  size_bytes integer,
  report_date date,
  public_token uuid not null default gen_random_uuid(),
  expires_on date not null,
  sent_at timestamptz,
  sent_channels text[] not null default '{}',
  send_error text,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists lab_uploaded_reports_token on lab_uploaded_reports (public_token);
create index if not exists lab_uploaded_reports_business_idx on lab_uploaded_reports (business_id, created_at desc);
create index if not exists lab_uploaded_reports_member_idx on lab_uploaded_reports (patient_member_id, created_at desc);

-- The file is already in storage (patient-documents/<business>/<member>/…,
-- which owner, doctor and nurse may write). This records it, sets how long it
-- is kept, makes its link, and — when it is the result of an order — marks the
-- order reported. Returns {id, token}.
create or replace function sehat_lab_upload_report(
  p_business uuid, p_member uuid, p_storage_path text, p_title text,
  p_mime text default null, p_size integer default null, p_report_date date default null, p_order uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_doc uuid; v_id uuid; v_token uuid; v_until date; v_days integer;
begin
  perform sehat_lab_check(p_business, 'results');
  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> p_business::text or split_part(p_storage_path, '/', 2) <> p_member::text then
    raise exception 'The file is not in this patient''s folder.' using errcode = '22023';
  end if;
  if not exists (select 1 from business_patients bp where bp.business_id = p_business and bp.patient_member_id = p_member) then
    raise exception 'Register the patient at this lab first.' using errcode = 'P0002';
  end if;
  if p_order is not null and not exists (select 1 from lab_orders o where o.id = p_order and o.business_id = p_business
                                          and o.patient_member_id = p_member and o.status <> 'cancelled') then
    raise exception 'That order is not this patient''s here.' using errcode = 'P0002';
  end if;
  if coalesce(p_size, 0) > 20 * 1024 * 1024 then raise exception 'The file is larger than 20 MB.' using errcode = '22023'; end if;

  select lab_report_retention_days into v_days from businesses where id = p_business;
  v_until := current_date + coalesce(v_days, 365);

  insert into patient_documents (business_id, patient_member_id, kind, title, storage_path, mime_type, size_bytes, document_date, retain_until)
  values (p_business, p_member, 'lab_report', coalesce(nullif(btrim(coalesce(p_title,'')), ''), 'Lab report'),
          p_storage_path, p_mime, p_size, p_report_date, v_until)
  returning id into v_doc;

  insert into lab_uploaded_reports (business_id, patient_member_id, order_id, document_id, title, mime_type, size_bytes,
                                    report_date, expires_on, uploaded_by_name)
  values (p_business, p_member, p_order, v_doc, coalesce(nullif(btrim(coalesce(p_title,'')), ''), 'Lab report'),
          p_mime, p_size, p_report_date, v_until, sehat_lab_staff_name(p_business))
  returning id, public_token into v_id, v_token;

  if p_order is not null then
    update lab_orders set status = 'reported', reported_at = now() where id = p_order and status <> 'reported';
  end if;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_on', v_until);
end $$;
revoke all on function sehat_lab_upload_report(uuid, uuid, text, text, text, integer, date, uuid) from public, anon;
grant execute on function sehat_lab_upload_report(uuid, uuid, text, text, text, integer, date, uuid) to authenticated;

-- How long uploaded reports are kept, by plan. Admin only.
create or replace function sehat_admin_set_lab_retention(p_business uuid, p_days integer)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is not null and not sehat_is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  update businesses set lab_report_retention_days = greatest(30, least(coalesce(p_days, 365), 3650)) where id = p_business;
end $$;
revoke all on function sehat_admin_set_lab_retention(uuid, integer) from public, anon;
grant execute on function sehat_admin_set_lab_retention(uuid, integer) to authenticated;

create or replace view lab_uploaded_report_detail as
  select u.*, pm.full_name as patient_name, pa.phone as patient_phone,
         (select o.order_no from lab_orders o where o.id = u.order_id) as order_no,
         (select d.purged_at from patient_documents d where d.id = u.document_id) as purged_at,
         (select d.storage_path from patient_documents d where d.id = u.document_id) as storage_path
    from lab_uploaded_reports u
    join patient_members pm on pm.id = u.patient_member_id
    join patients pa on pa.id = pm.patient_id
   where sehat_lab_reads_results(u.business_id);
alter view lab_uploaded_report_detail set (security_invoker = false);
grant select on lab_uploaded_report_detail to authenticated;


-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table lab_followups enable row level security;
drop policy if exists "clinic_reads_lab_followups" on lab_followups;
create policy "clinic_reads_lab_followups" on lab_followups for select using (sehat_caller_owns_business(business_id));

-- Uploaded reports: the people who handle results (owner, doctor, nurse).
alter table lab_uploaded_reports enable row level security;
drop policy if exists "clinic_reads_lab_uploaded_reports" on lab_uploaded_reports;
create policy "clinic_reads_lab_uploaded_reports" on lab_uploaded_reports for select using (sehat_lab_reads_results(business_id));

grant select on lab_followups, lab_uploaded_reports to authenticated;
revoke insert, update, delete on lab_followups, lab_uploaded_reports from anon, authenticated;

-- 0168's order list had the same problem (a technician saw 4 of 5 orders).
drop view if exists lab_order_detail;
create view lab_order_detail as
  select o.*,
         pm.full_name as patient_name, pm.age_years as patient_age, pm.gender as patient_gender, pa.phone as patient_phone,
         bp.mrn,
         (select count(*) from lab_order_items i where i.order_id = o.id)::integer as item_count,
         (select count(*) from lab_order_items i where i.order_id = o.id and i.status = 'pending')::integer as pending_count,
         (select count(*) from lab_order_items i where i.order_id = o.id and i.status = 'entered')::integer as entered_count,
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'package_name', i.package_name, 'status', i.status,
                                                       'report_kind', i.report_kind, 'test_id', i.test_id, 'category', i.category) order by i.sort_order)
                     from lab_order_items i where i.order_id = o.id), '[]'::jsonb) as items,
         (select jsonb_build_object('id', r.id, 'report_no', r.report_no, 'version', r.version, 'token', r.public_token,
                                    'approved_by_name', r.approved_by_name, 'approved_at', r.approved_at,
                                    'sent_at', r.sent_at, 'sent_channels', r.sent_channels, 'send_error', r.send_error)
            from lab_reports r where r.order_id = o.id order by r.version desc limit 1) as latest_report
    from lab_orders o
    join patient_members pm on pm.id = o.patient_member_id
    join patients pa on pa.id = pm.patient_id
    left join business_patients bp on bp.business_id = o.business_id and bp.patient_member_id = o.patient_member_id
   where sehat_caller_owns_business(o.business_id);
grant select on lab_order_detail to authenticated;

notify pgrst, 'reload schema';

-- ── NOT HERE ────────────────────────────────────────────────────────────────
-- • Automatic scheduled WhatsApp reminders. They need an approved AiSensy
--   template and the API key on production; until then reminders go from the
--   lab's own WhatsApp with one tap, and are recorded.
