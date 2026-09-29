-- ============================================================================
-- Sehatsandhi — which kinds of tests a business does
--
-- Run AFTER 0176. Safe to re-run.
--
-- Decided 29 Sep 2026:
--
--   • Labs are not all alike. At registration a lab chooses what it is — a
--     pathology lab (blood, urine, stool) or a radiology & imaging centre
--     (X-ray, ultrasound, CT, MRI, and the ECG / echo / TMT such centres run).
--     A business that does both registers two listings. Its catalogue, test
--     lists and reports follow the choice.
--   • Clinics and hospitals do tests in-house without registering a lab: a
--     cardiologist has an echo machine, an orthopaedic clinic an X-ray. The
--     kinds they do are recorded here too, and the Lab tab shows just those
--     tests. Switching them on for a clinic stays with a Sehatsandhi admin
--     for now: it is to become a paid add-on (₹1,000 per kind), bought from
--     Plan like WhatsApp — not something a clinic turns on free.
--
--   businesses.lab_categories — the kinds done here. NULL = not chosen yet:
--   every existing lab keeps seeing everything until it chooses.
-- ============================================================================

alter table businesses add column if not exists lab_categories text[];
do $$ begin
  alter table businesses add constraint businesses_lab_categories_known
    check (lab_categories is null or lab_categories <@ array['pathology','radiology','cardiology']::text[]);
exception when duplicate_object then null; end $$;

-- A lab's owner or manager (or an admin) sets its kind; a lab must keep one.
-- A clinic's kinds are set by an admin (paid add-on to come); none = lab off.
create or replace function sehat_set_lab_tests(p_business uuid, p_categories text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_vertical text;
  v_cats text[] := array(select distinct c from unnest(coalesce(p_categories, '{}')) c where c is not null order by c);
begin
  if not (sehat_caller_manages_business(p_business) or sehat_is_admin()) then
    raise exception 'Only the owner or a manager can change this.' using errcode = '42501';
  end if;
  if not v_cats <@ array['pathology','radiology','cardiology']::text[] then
    raise exception 'Unknown kind of test.' using errcode = 'P0001';
  end if;
  select vertical into v_vertical from businesses where id = p_business;
  if v_vertical is null then raise exception 'No such business.' using errcode = 'P0002'; end if;

  if v_vertical <> 'lab' and not sehat_is_admin() then
    raise exception 'In-clinic tests are switched on by Sehatsandhi. Message us on WhatsApp.' using errcode = '42501';
  end if;

  if v_vertical = 'lab' then
    if cardinality(v_cats) = 0 then
      raise exception 'Choose what kind of lab this is.' using errcode = 'P0001';
    end if;
    update businesses set lab_categories = v_cats where id = p_business;
  else
    update businesses
       set lab_categories = v_cats,
           lab_module = cardinality(v_cats) > 0,
           lab_module_set_by = coalesce((select email from auth.users where id = auth.uid()), 'owner')
     where id = p_business;
  end if;
  return (select jsonb_build_object('lab_categories', lab_categories, 'lab_module', lab_module or vertical = 'lab')
            from businesses where id = p_business);
end $$;
revoke all on function sehat_set_lab_tests(uuid, text[]) from public, anon;
grant execute on function sehat_set_lab_tests(uuid, text[]) to authenticated;

-- 0168's import, taking only the kinds this business does ('other' always).
create or replace function sehat_lab_import_catalogue(p_business uuid, p_codes text[] default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare c record; v_test uuid; n integer := 0; p jsonb; i integer;
        v_cats text[] := (select lab_categories from businesses where id = p_business);
begin
  perform sehat_lab_check(p_business, 'manage');
  for c in select * from lab_catalogue
            where (p_codes is null or code = any(p_codes))
              and (p_codes is not null or v_cats is null or cardinality(v_cats) = 0
                   or category = any(v_cats) or category = 'other')
            order by sort_order loop
    continue when exists (select 1 from lab_tests t where t.business_id = p_business and lower(t.name) = lower(c.name));
    insert into lab_tests (business_id, catalogue_code, name, category, department, sample_type, report_kind, price, tat_hours)
    values (p_business, c.code, c.name, c.category, c.department, c.sample_type, c.report_kind, coalesce(c.default_price, 0), c.tat_hours)
    returning id into v_test;
    i := 0;
    for p in select * from jsonb_array_elements(c.parameters) loop
      insert into lab_test_parameters (test_id, name, unit, kind, options, ref_low, ref_high, ref_low_f, ref_high_f, ref_text, sort_order)
      values (v_test, p->>'name', p->>'unit', coalesce(p->>'kind', 'number'),
              case when p ? 'options' then array(select jsonb_array_elements_text(p->'options')) end,
              (p->>'ref_low')::numeric, (p->>'ref_high')::numeric, (p->>'ref_low_f')::numeric, (p->>'ref_high_f')::numeric,
              p->>'ref_text', i);
      i := i + 1;
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

notify pgrst, 'reload schema';
