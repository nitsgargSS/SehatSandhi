-- ============================================================================
-- Sehatsandhi — bot visits out of "Where we are being noticed"
--
-- Run AFTER 0122. Safe to re-run.
--
-- Search crawlers, link previewers and cloud monitors load the site like a
-- browser, and were being counted as visitors from US data-centre towns —
-- Altoona (a Meta data centre), Dallas, San Jose, Washington. From 25 Sep 2026
-- they are not recorded at all: the browser skips tracking for bots, and
-- record-visitor-location refuses data-centre networks.
--
-- Visits recorded before that carry no network owner, so they are judged by
-- behaviour: outside India, and did nothing but load a page — no search, no
-- profile view, no WhatsApp tap, no signup page. Marked, not deleted, so the
-- rule can be revisited; the admin report leaves them out.
-- ============================================================================

alter table visitor_locations add column if not exists is_bot boolean not null default false;

update visitor_locations v set is_bot = true
 where coalesce(v.country, '') <> 'IN'
   and not v.is_bot
   and not exists (
     select 1 from site_events e
      where e.session_id = v.session_id
        and e.event_type in ('search', 'doctor_view', 'whatsapp_click', 'business_lead'));

create or replace function sehat_admin_visitor_geo(p_days integer default 30)
returns table(country text, region text, city text, postal_code text, sessions integer,
              page_views integer, searches integer, profile_views integer,
              business_leads integer, last_seen timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 730);
  v_from timestamptz := now() - make_interval(days => v_days);
begin
  if not sehat_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  return query
  select v.country, v.region, v.city, v.postal_code,
         count(distinct v.session_id)::integer,
         count(*) filter (where e.event_type = 'page_view')::integer,
         count(*) filter (where e.event_type = 'search')::integer,
         count(*) filter (where e.event_type = 'doctor_view')::integer,
         count(*) filter (where e.event_type = 'business_lead')::integer,
         max(v.last_active_at)
    from visitor_locations v
    left join site_events e
      on e.session_id = v.session_id and e.created_at >= v_from
   where v.last_active_at >= v_from
     and not v.is_bot                      -- 0123
   group by v.country, v.region, v.city, v.postal_code
   order by 5 desc, 6 desc;
end;
$function$;

notify pgrst, 'reload schema';
