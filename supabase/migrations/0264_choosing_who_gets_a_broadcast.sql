-- ============================================================================
-- 0264 — Choosing who gets a broadcast: everyone, by area, or recent visitors
-- ============================================================================
-- The broadcast screen used to open with one chip per PIN code — fine for a
-- clinic with five areas, a wall for one whose patients come from fifty. It
-- now asks "who?" first: all patients, patients in chosen areas (searched,
-- with area names), or patients seen recently. For that:
--
--   sehat_marketing_audience_pins  also gives each PIN's area name (the
--                                  service area's name, else its district),
--                                  and the people without a PIN as one row;
--   sehat_marketing_audience       takes p_since: only patients last seen at
--                                  the clinic on or after that day (an
--                                  insurance lead: accepted since then). The
--                                  "no PIN" row ('') now actually matches the
--                                  patients without one.
--
-- Same rules as 0239 otherwise: on the list unless they said STOP. Broadcast
-- creation (0247) calls the audience with two arguments and is unchanged.
-- ============================================================================

drop function if exists sehat_marketing_audience(uuid, text[]);
create or replace function sehat_marketing_audience(p_business uuid, p_pins text[] default null, p_since date default null)
returns table (patient_member_id uuid, full_name text, phone text, pin_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()
          or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the clinic''s owner or manager can do this.' using errcode = '42501';
  end if;
  return query
  select distinct on (x.phone) x.member, x.name, x.phone, x.pin from (
    select m.id as member, m.full_name as name, p.phone, p.pin_code as pin, 0 as pri, m.is_self as self_first,
           bp.last_seen_at as seen
      from business_patients bp
      join patient_members m on m.id = bp.patient_member_id
      join patients p on p.id = m.patient_id
     where bp.business_id = p_business
       and bp.status = 'active'
       and coalesce(m.status, 'active') = 'active'
       and p.phone ~ '^91[6-9][0-9]{9}$'
       and sehat_marketing_allowed(m.id, p_business)   -- 0239: on the list unless they said stop
    union all
    -- 0195: an insurance advisor reaches the people whose leads they accepted
    -- in the last 90 days — they asked to be contacted about cover.
    select null::uuid, l.patient_name, l.patient_phone, l.pincode, 1, true, l.accepted_at
      from insurance_leads l
     where l.agent_business_id = p_business and l.code is not null
       and l.status in ('accepted', 'contacted', 'won', 'lost')
       and l.accepted_at > now() - interval '90 days'
       and l.patient_phone ~ '^91[6-9][0-9]{9}$'
  ) x
   where not exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(x.phone))
     and (p_pins is null or cardinality(p_pins) = 0 or coalesce(nullif(btrim(x.pin), ''), '') = any(p_pins))
     and (p_since is null or (x.seen at time zone 'Asia/Kolkata')::date >= p_since)
   order by x.phone, x.pri, x.self_first desc nulls last, x.name;
end $$;
revoke all on function sehat_marketing_audience(uuid, text[], date) from public, anon;
grant execute on function sehat_marketing_audience(uuid, text[], date) to authenticated, service_role;

drop function if exists sehat_marketing_audience_pins(uuid);
create or replace function sehat_marketing_audience_pins(p_business uuid)
returns table (pin_code text, patients bigint, area text)
language sql stable security definer set search_path = public as $$
  select a.pin,
         count(*),
         case when a.pin = '' then null
              else coalesce((select s.area_name from service_areas s where s.pin_code = a.pin order by s.is_active desc limit 1),
                            (select d.district from pincode_directory d where d.pin_code = a.pin limit 1)) end
    from (select coalesce(nullif(btrim(x.pin_code), ''), '') pin from sehat_marketing_audience(p_business, null) x) a
   group by a.pin
   order by (a.pin = ''), 2 desc, 1;
$$;
revoke all on function sehat_marketing_audience_pins(uuid) from public, anon;
grant execute on function sehat_marketing_audience_pins(uuid) to authenticated;

notify pgrst, 'reload schema';
