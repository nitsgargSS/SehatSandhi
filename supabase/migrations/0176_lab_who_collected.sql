-- ============================================================================
-- Sehatsandhi — the lab records who took the sample, and shows who did what
--
-- Run AFTER 0175. Safe to re-run.
--
-- Decided 29 Sep 2026:
--
--   • "Sample collected" names the person who actually drew the blood / ran
--     the scan, chosen from the lab's staff — not whoever clicked. Reception
--     often clicks for the nurse. Left unchosen, it is the person clicking, as
--     before. lab_orders.collected_by keeps the person, collected_by_name the
--     name as it was.
--   • lab_order_detail returns, per test, who entered the result and when
--     (0168 stored it, nothing returned it), so the order shows the chain:
--     ordered → collected by → entered by → uploaded by → approved by.
-- ============================================================================

alter table lab_orders add column if not exists collected_by uuid references practitioners(id) on delete set null;

drop function if exists sehat_lab_mark_collected(uuid);
create or replace function sehat_lab_mark_collected(p_order uuid, p_collector uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o record; v_name text; v_by uuid;
begin
  select * into o from lab_orders where id = p_order for update;
  if not found then raise exception 'No such order.' using errcode = 'P0002'; end if;
  perform sehat_lab_check(o.business_id, 'staff');
  if o.status <> 'ordered' then return; end if;
  if p_collector is not null then
    select p.id, p.full_name into v_by, v_name
      from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
     where bp.business_id = o.business_id and bp.practitioner_id = p_collector and bp.status <> 'suspended';
    if v_by is null then raise exception 'That person is not on this lab''s staff.' using errcode = 'P0002'; end if;
  else
    v_by := (select bp.practitioner_id from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
              where bp.business_id = o.business_id and p.auth_uid = auth.uid() limit 1);
    v_name := sehat_lab_staff_name(o.business_id);
  end if;
  update lab_orders set status = 'collected', collected_at = now(), collected_by = v_by, collected_by_name = v_name
   where id = p_order;
end $$;
revoke all on function sehat_lab_mark_collected(uuid, uuid) from public, anon;
grant execute on function sehat_lab_mark_collected(uuid, uuid) to authenticated;

-- 0169's view, plus entered_by_name / entered_at per test (and collected_by via o.*).
drop view if exists lab_order_detail;
create view lab_order_detail as
  select o.*,
         pm.full_name as patient_name, pm.age_years as patient_age, pm.gender as patient_gender, pa.phone as patient_phone,
         bp.mrn,
         (select count(*) from lab_order_items i where i.order_id = o.id)::integer as item_count,
         (select count(*) from lab_order_items i where i.order_id = o.id and i.status = 'pending')::integer as pending_count,
         (select count(*) from lab_order_items i where i.order_id = o.id and i.status = 'entered')::integer as entered_count,
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'package_name', i.package_name, 'status', i.status,
                                                       'report_kind', i.report_kind, 'test_id', i.test_id, 'category', i.category,
                                                       'entered_by_name', i.entered_by_name, 'entered_at', i.entered_at) order by i.sort_order)
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
