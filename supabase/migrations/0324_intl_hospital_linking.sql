-- ============================================================================
-- 0324 — International: link regular hospital and doctor pages both ways
-- ============================================================================
-- AFTER 0323. Safe to re-run.
--
-- Asked 4 Nov 2026: hospitals and doctors on regular Sehatsandhi should lead
-- to the International pages, and back.
--
--   sehat_intl_listed(ids)         which of these businesses are listed on
--                                  Sehatsandhi International (a doctor's profile
--                                  shows "treats patients from abroad").
--   sehat_intl_hospital_doctors(id) a listed hospital's doctors (public
--                                  profile fields only), for its International
--                                  page to link to their regular profiles.
-- ============================================================================

create or replace function sehat_intl_listed(p_ids uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(h.business_id), '{}')
    from intl_hospitals h join businesses b on b.id = h.business_id
   where h.business_id = any(coalesce(p_ids, '{}')) and h.status = 'listed' and b.status = 'active'
$$;

create or replace function sehat_intl_hospital_doctors(p_business uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.practitioner_id, 'name', d.full_name, 'qualification', d.qualification, 'speciality', d.speciality)
           order by d.is_primary desc nulls last, d.sort_order nulls last, d.full_name), '[]'::jsonb)
    from public_business_doctors d
   where d.business_id = p_business
     and exists (select 1 from intl_hospitals h where h.business_id = p_business and h.status = 'listed')
$$;

revoke all on function sehat_intl_listed(uuid[]) from public;
revoke all on function sehat_intl_hospital_doctors(uuid) from public;
grant execute on function sehat_intl_listed(uuid[]), sehat_intl_hospital_doctors(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
