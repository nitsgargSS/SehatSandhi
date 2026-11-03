-- ============================================================================
-- 0318 — International: partner enquiries (travel, visa, hotels, transport…)
-- ============================================================================
-- AFTER 0317. Safe to re-run.
--
-- Asked 3 Nov 2026: businesses in any city that want to work with Sehatsandhi
-- International — travel agents, visa help, hotels and guest houses, airport
-- transfers, interpreters, ambulance, currency exchange and SIM — send an
-- enquiry from /international/partners. Later they will get pages of their
-- own; for now Sehatsandhi follows each one up from the admin panel.
--
--   intl_partner_enquiries   one per enquiry; types[] from a fixed list.
--   sehat_intl_partner_enquire(p jsonb)   the public submit: trimmed and
--       capped, a hidden field for bots, 3 a day per phone or email and
--       60 an hour overall; emails Sehatsandhi (email-send 'intl_notice').
--   sehat_intl_partner_update(...)   admins and managers move the status
--       and keep notes.
-- ============================================================================

create table if not exists intl_partner_enquiries (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  types text[] not null,
  city text,
  state text,
  serves text,
  contact_name text not null,
  phone text,
  email text,
  website text,
  registration text,
  languages text,
  offer text,
  prices text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'shortlisted', 'signed_up', 'not_now')),
  notes text,
  handled_by text,
  page text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (types <@ array['travel_agent', 'visa', 'hotel', 'transport', 'interpreter', 'ambulance', 'forex_sim', 'other']::text[]
         and cardinality(types) between 1 and 8)
);
create index if not exists intl_partner_enquiries_created_idx on intl_partner_enquiries (created_at desc);

alter table intl_partner_enquiries enable row level security;
drop policy if exists intl_partner_enquiries_read on intl_partner_enquiries;
create policy intl_partner_enquiries_read on intl_partner_enquiries for select to authenticated
  using (sehat_is_admin() or sehat_is_staff());
revoke all on intl_partner_enquiries from anon;
revoke insert, update, delete on intl_partner_enquiries from authenticated;
grant select on intl_partner_enquiries to authenticated;

create or replace function sehat_intl_partner_enquire(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := left(btrim(coalesce(p->>'business_name', '')), 160);
  v_contact text := left(btrim(coalesce(p->>'contact_name', '')), 120);
  v_phone text := nullif(left(regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'), 20), '');
  v_email text := nullif(left(lower(btrim(coalesce(p->>'email', ''))), 120), '');
  v_types text[];
  v_id uuid;
  t text := '';
begin
  if coalesce(btrim(p->>'website_hp'), '') <> '' then return jsonb_build_object('ok', true); end if;
  v_types := coalesce(array(
    select distinct x from jsonb_array_elements_text(coalesce(p->'types', '[]')) x
     where x in ('travel_agent', 'visa', 'hotel', 'transport', 'interpreter', 'ambulance', 'forex_sim', 'other')), '{}');
  if length(v_name) < 2 then return jsonb_build_object('ok', false, 'error', 'Please give your business name.'); end if;
  if cardinality(v_types) = 0 then return jsonb_build_object('ok', false, 'error', 'Please choose what your business offers.'); end if;
  if length(v_contact) < 2 then return jsonb_build_object('ok', false, 'error', 'Please give the name of the person we should talk to.'); end if;
  if v_phone is null and v_email is null then return jsonb_build_object('ok', false, 'error', 'Please give a WhatsApp number or email.'); end if;
  if v_phone is not null and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 then
    return jsonb_build_object('ok', false, 'error', 'That phone number looks too short.');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'That email address does not look right.');
  end if;
  if coalesce((p->>'consent')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'Please agree that we may contact you about a partnership.');
  end if;
  if (select count(*) from intl_partner_enquiries where created_at > now() - interval '1 day'
        and ((v_phone is not null and phone = v_phone) or (v_email is not null and email = v_email))) >= 3 then
    return jsonb_build_object('ok', false, 'error', 'We already have your enquiry. We will be in touch soon.');
  end if;
  if (select count(*) from intl_partner_enquiries where created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('ok', false, 'error', 'Please try again in a few minutes.');
  end if;

  insert into intl_partner_enquiries (business_name, types, city, state, serves, contact_name, phone, email, website,
                                      registration, languages, offer, prices, page)
  values (v_name, v_types,
          nullif(left(btrim(coalesce(p->>'city', '')), 80), ''), nullif(left(btrim(coalesce(p->>'state', '')), 80), ''),
          nullif(left(btrim(coalesce(p->>'serves', '')), 300), ''), v_contact, v_phone, v_email,
          nullif(left(btrim(coalesce(p->>'website', '')), 200), ''), nullif(left(btrim(coalesce(p->>'registration', '')), 300), ''),
          nullif(left(btrim(coalesce(p->>'languages', '')), 160), ''), nullif(left(btrim(coalesce(p->>'offer', '')), 2000), ''),
          nullif(left(btrim(coalesce(p->>'prices', '')), 1000), ''), nullif(left(coalesce(p->>'page', ''), 200), ''))
  returning id into v_id;

  insert into email_outbox (kind, business_id, payload)
  values ('intl_notice', null, jsonb_build_object('to', 'admin',
    'subject', 'New partner enquiry — ' || v_name,
    'lines', jsonb_build_array(
      v_name || ' (' || array_to_string(v_types, ', ') || ')' || coalesce(', ' || nullif(btrim(coalesce(p->>'city', '')), ''), '') || ' wants to partner with Sehatsandhi International.',
      'Contact: ' || v_contact || coalesce(' · ' || v_phone, '') || coalesce(' · ' || v_email, ''),
      coalesce('They offer: ' || nullif(left(btrim(coalesce(p->>'offer', '')), 400), ''), ''),
      'See Admin → International → Partner enquiries.')));
  return jsonb_build_object('ok', true);
end $$;

create or replace function sehat_intl_partner_update(p_id uuid, p_status text, p_notes text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_is_staff()) then raise exception 'Sehatsandhi team only.' using errcode = '42501'; end if;
  if p_status not in ('new', 'contacted', 'shortlisted', 'signed_up', 'not_now') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update intl_partner_enquiries set status = p_status,
    notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
    handled_by = sehat_intl_actor_name(), updated_at = now()
  where id = p_id;
end $$;

revoke all on function sehat_intl_partner_enquire(jsonb) from public;
revoke all on function sehat_intl_partner_update(uuid, text, text) from public, anon;
grant execute on function sehat_intl_partner_enquire(jsonb) to anon, authenticated;
grant execute on function sehat_intl_partner_update(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
