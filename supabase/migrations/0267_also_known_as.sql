-- ============================================================================
-- 0267 — "Also known as": a maiden name, or any other name a patient goes by
-- ============================================================================
-- Asked for on 26 Oct 2026. A woman registered as "Mrs. Anjana Sharma" may be
-- searched for by her maiden name, "Anjana Gupta", or a patient known by a
-- nickname or a spelling of their own. 0266 finds any word of the registered
-- name; this adds a second name to search on.
--
--   patient_members.also_known_as   optional, up to 80 letters.
--   sehat_set_also_known_as         any staff member sets or clears it; the
--                                   change is logged like every other detail
--                                   (patient_detail_changes).
--   sehat_search_patients           also matches it, word by word as 0266,
--                                   and returns it so the list can show it.
--   patient_summary                 carries it, for the patient's header.
-- ============================================================================

alter table patient_members add column if not exists also_known_as text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_members_also_known_as_len') then
    alter table patient_members add constraint patient_members_also_known_as_len
      check (also_known_as is null or char_length(also_known_as) between 2 and 80);
  end if;
end $$;

create or replace function sehat_set_also_known_as(p_business uuid, p_member uuid, p_name text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old text;
  v_new text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  if not exists (select 1 from business_patients where business_id = p_business and patient_member_id = p_member) then
    raise exception 'That patient is not registered here.' using errcode = 'P0002';
  end if;
  if v_new is not null and (length(v_new) < 2 or length(v_new) > 80) then
    raise exception 'Enter the other name (2 to 80 letters).' using errcode = '22023';
  end if;
  select also_known_as into v_old from patient_members where id = p_member for update;
  if v_old is not distinct from v_new then return; end if;
  update patient_members set also_known_as = v_new, updated_at = now() where id = p_member;
  insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
  values (p_business, p_member, 'also known as', v_old, v_new, auth.uid(), sehat_mo_actor_name(p_business));
end $$;
revoke all on function sehat_set_also_known_as(uuid, uuid, text) from public, anon;
grant execute on function sehat_set_also_known_as(uuid, uuid, text) to authenticated;

-- The search, with the other name. Its result gains a column, so it is
-- dropped and made again (callers name the columns they read).
drop function if exists sehat_search_patients(text, uuid);
create function sehat_search_patients(p_query text, p_business uuid default null)
returns table (
  patient_member_id uuid, business_id uuid, full_name text, relation text,
  phone text, age_years integer, gender text, mrn text,
  last_seen_at timestamptz, visit_count integer, also_known_as text
)
language sql stable security definer set search_path = public as $$
  with q as (select btrim(coalesce(p_query, '')) as raw,
                    regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g') as digits,
                    sehat_name_words(p_query) as words)
  select m.id, bp.business_id, m.full_name, m.relation,
         p.phone, m.age_years, m.gender, bp.mrn,
         bp.last_seen_at, bp.visit_count, m.also_known_as
    from business_patients bp
    join patient_members m on m.id = bp.patient_member_id
    join patients p on p.id = m.patient_id
   cross join q
   where bp.business_id in (select sehat_caller_business_ids())
     and (p_business is null or bp.business_id = p_business)
     and m.status = 'active'
     and length(q.raw) >= 2
     and (
       m.full_name ilike '%' || q.raw || '%'
       -- 0266: any word, in any order, titles and dots ignored.
       or (length(q.digits) = 0 and sehat_name_matches(m.full_name, q.raw))
       -- 0267: the other name — a maiden name, a nickname.
       or (m.also_known_as is not null and length(q.digits) = 0
           and (m.also_known_as ilike '%' || q.raw || '%' or sehat_name_matches(m.also_known_as, q.raw)))
       -- 0193: only a query with digits in it is a phone search.
       or (length(q.digits) >= 3 and p.phone like '%' || q.digits || '%')
       or (length(q.digits) >= 3 and exists (select 1 from patient_phones x where x.patient_member_id = m.id and x.phone like '%' || q.digits || '%'))
       or upper(coalesce(bp.mrn, '')) = upper(q.raw)
     )
   order by
     ((sehat_name_words(m.full_name))[1] like coalesce(q.words[1], '') || '%') desc,
     bp.last_seen_at desc nulls last, m.full_name
   limit 50;
$$;
revoke all on function sehat_search_patients(text, uuid) from public, anon;
grant execute on function sehat_search_patients(text, uuid) to authenticated;

-- The header above a patient shows it, and the edit form starts from it.
create or replace view patient_summary as
  select
    m.id as patient_member_id,
    bp.business_id,
    m.full_name, m.relation, m.gender, m.age_years, m.date_of_birth,
    m.blood_group, m.abha_number,
    p.phone, p.lang, p.pin_code, p.area,
    bp.mrn, bp.source, bp.first_seen_at, bp.last_seen_at, bp.visit_count,
    (select count(*) from patient_visits v
      where v.patient_member_id = m.id and v.business_id = bp.business_id) as visits_here,
    -- A safety warning, shown to whoever is dealing with the patient.
    (select array_agg(a.substance order by a.severity desc nulls last)
       from patient_allergies a
      where a.patient_member_id = m.id and a.business_id = bp.business_id and a.is_active) as allergies,
    -- A diagnosis. Null for reception rather than absent, so the column keeps
    -- its shape and every caller keeps working.
    case when sehat_caller_is_clinical(bp.business_id) then
      (select array_agg(c.condition order by c.created_at)
         from patient_conditions c
        where c.patient_member_id = m.id and c.business_id = bp.business_id and c.status = 'active')
    end as conditions,
    case when sehat_caller_is_clinical(bp.business_id) then
      (select max(v.follow_up_due) from patient_visits v
        where v.patient_member_id = m.id and v.business_id = bp.business_id
          and v.follow_up_due >= current_date)
    end as next_follow_up,
    sehat_has_consent(m.id, 'recording', bp.business_id) as recording_consent,
    -- 0267: another name the patient goes by (a maiden name), last so the view can grow.
    m.also_known_as
  from business_patients bp
  join patient_members m on m.id = bp.patient_member_id
  join patients p on p.id = m.patient_id
 where bp.business_id in (select sehat_caller_business_ids());

grant select on patient_summary to authenticated;

notify pgrst, 'reload schema';
