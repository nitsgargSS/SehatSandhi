-- ============================================================================
-- 0222 — A doctor's further specialities, said at registration
-- ============================================================================
-- AFTER 0221. Safe to re-run.
--
-- 0221 lets a doctor list two more specialities and the problems they treat,
-- and their profile screen saves both by updating their own row. Registration
-- cannot: it happens before anybody has logged in, in one call
-- (sehat_register_business_with_doctors) that knows nothing of the two new
-- columns. Rather than rewrite that function for two optional lists, the
-- wizard sends them straight afterwards:
--
--   sehat_set_new_doctor_specialities   for a doctor named by registration
--        number, attached to the business just made. Only within thirty
--        minutes of both being created — the window in which the person at
--        the wizard is, by any reasonable reading, the one who registered
--        them. After that it is the profile screen's job, which asks who you
--        are.
--
-- What the lists may hold is 0221's trigger's business, here as anywhere.
-- ============================================================================

create or replace function sehat_set_new_doctor_specialities(
  p_business uuid, p_reg_number text, p_other text[], p_subs text[]
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update practitioners p
     set other_specialities = coalesce(p_other, '{}'),
         sub_specialities = coalesce(p_subs, '{}')
   where upper(btrim(p.reg_number)) = upper(btrim(coalesce(p_reg_number, '')))
     and btrim(coalesce(p_reg_number, '')) <> ''
     and p.created_at > now() - interval '30 minutes'
     and exists (select 1 from business_practitioners bp
                   join businesses b on b.id = bp.business_id
                  where bp.practitioner_id = p.id and b.id = p_business
                    and b.created_at > now() - interval '30 minutes');
  return found;
end $$;
revoke all on function sehat_set_new_doctor_specialities(uuid, text, text[], text[]) from public;
grant execute on function sehat_set_new_doctor_specialities(uuid, text, text[], text[]) to anon, authenticated;

notify pgrst, 'reload schema';
