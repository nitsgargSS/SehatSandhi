-- ============================================================================
-- Sehatsandhi — the category a business picks at signup is kept
--
-- Run AFTER 0125. Safe to re-run.
--
-- The business wizard has always asked "Category / speciality" and never saved
-- the answer: the box was free text and the value was dropped before the
-- registration call. It is now a dropdown per business type (an eye clinic,
-- a radiology lab, an ALS ambulance) with "Other" for anything not listed, and
-- lands here. Admin sees it in the new-registration email and the listing.
--
-- Registration runs with no session, so like 0084 and 0118 this is an
-- anonymous twin as narrow as they are: a listing still pending, unpaid and
-- under a day old. The worst a stranger holding the id could do is relabel a
-- listing that admin has not yet reviewed.
-- ============================================================================

alter table businesses add column if not exists category text;

do $$ begin
  alter table businesses add constraint businesses_category_len
    check (category is null or char_length(category) between 1 and 80);
exception when duplicate_object then null; end $$;

create or replace function sehat_signup_set_category(p_business uuid, p_category text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v text := nullif(btrim(coalesce(p_category, '')), '');
begin
  if v is not null and char_length(v) > 80 then raise exception 'Category is too long.'; end if;
  update businesses b
     set category = v
   where b.id = p_business
     and b.status = 'pending'
     and b.created_at > now() - interval '1 day'
     and not exists (select 1 from payments p where p.business_id = b.id and p.status = 'paid');
end $$;

revoke all on function sehat_signup_set_category(uuid, text) from public;
grant execute on function sehat_signup_set_category(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
