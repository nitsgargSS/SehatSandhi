-- ============================================================================
-- 0304 — Messages from a clinic's own website: contact, international, questions
-- ============================================================================
-- AFTER 0303. Safe to re-run.
--
-- Asked 31 Oct 2026 for SN Eye Hospital's site (sneyeshospital.com): a Contact
-- us form, a questionnaire for international patients (all looked after
-- through Capital Super Speciality Hospital, which arranges the room, the
-- e-Medical visa letter and pickup), and "Ask Dr. Swati" questions that the
-- bot cannot answer. All three land in one inbox in the Website tab, and each
-- new one emails the clinic.
--
-- 1. clinic_site_messages: one row per message, `kind` says which form.
--    `details` holds the form's extra answers (travel dates, procedure, room…).
--    For questions, `reply` is the doctor's answer and `publish` puts it on the
--    site's public Q&A, signed `public_name` (the asker's name if they gave
--    one, else "Anonymous").
-- 2. sehat_site_message(key, kind, …): the public submit. Text is trimmed and
--    capped; a hidden field that people never see and bots fill in is
--    accepted and dropped; at most 5 messages per phone or email per site a
--    day, and 60 per site an hour.
-- 3. sehat_public_questions(key): the published Q&A for the site.
-- 4. Owners (and admins) read and answer through the table's RLS.
-- ============================================================================

create table if not exists clinic_site_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('contact', 'international', 'question')),
  name text,
  phone text,
  email text,
  country text,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  lang text check (lang is null or lang in ('en', 'hi')),
  page text,
  status text not null default 'new' check (status in ('new', 'in_progress', 'replied', 'closed')),
  reply text,
  replied_at timestamptz,
  replied_by uuid,
  publish boolean not null default false,
  public_name text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clinic_site_messages_biz_idx on clinic_site_messages (business_id, created_at desc);
create index if not exists clinic_site_messages_public_idx on clinic_site_messages (business_id, published_at desc) where publish;

alter table clinic_site_messages enable row level security;
revoke all on clinic_site_messages from anon;
grant select, update, delete on clinic_site_messages to authenticated;

drop policy if exists site_messages_read on clinic_site_messages;
create policy site_messages_read on clinic_site_messages for select
  using (sehat_caller_is_business(business_id) or sehat_is_admin());
drop policy if exists site_messages_answer on clinic_site_messages;
create policy site_messages_answer on clinic_site_messages for update
  using (sehat_caller_is_owner(business_id) or sehat_is_admin())
  with check (sehat_caller_is_owner(business_id) or sehat_is_admin());
drop policy if exists site_messages_delete on clinic_site_messages;
create policy site_messages_delete on clinic_site_messages for delete
  using (sehat_caller_is_owner(business_id) or sehat_is_admin());

-- An answer stamps when and by whom; publishing stamps when.
create or replace function sehat_site_message_stamp()
returns trigger language plpgsql as $$
begin
  if new.reply is distinct from old.reply and coalesce(btrim(new.reply), '') <> '' then
    new.replied_at := now();
    new.replied_by := auth.uid();
    if new.status in ('new', 'in_progress') then new.status := 'replied'; end if;
  end if;
  if new.publish and not old.publish then new.published_at := now(); end if;
  if not new.publish then new.published_at := null; end if;
  -- Only an answered question can be published.
  if new.publish and (new.kind <> 'question' or coalesce(btrim(new.reply), '') = '') then
    raise exception 'Only an answered question can be published.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists sehat_site_message_stamp on clinic_site_messages;
create trigger sehat_site_message_stamp before update on clinic_site_messages
  for each row execute function sehat_site_message_stamp();

-- New-message email to the clinic (email-send drains it).
alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (kind = any (array[
  'business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite', 'nurse_unassigned',
  'wa_broadcast_rejected', 'signup_reminder', 'wa_broadcast_waiting', 'clinic_booking_cancelled',
  'demo_request', 'clinic_site_message']));

create or replace function sehat_site_message(
  p_key text, p_kind text, p_message text,
  p_name text default null, p_phone text default null, p_email text default null,
  p_country text default null, p_details jsonb default '{}'::jsonb,
  p_lang text default null, p_page text default null, p_website text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_biz uuid := sehat_site_business(p_key);
  v_msg text := left(btrim(coalesce(p_message, '')), 4000);
  v_phone text := nullif(left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), '');
  v_email text := nullif(left(lower(btrim(coalesce(p_email, ''))), 120), '');
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_id uuid;
begin
  if v_biz is null then return jsonb_build_object('ok', false, 'error', 'This website is not set up for messages.'); end if;
  -- The hidden field: bots fill it in, people never see it. Look successful, keep nothing.
  if coalesce(btrim(p_website), '') <> '' then return jsonb_build_object('ok', true); end if;
  if p_kind not in ('contact', 'international', 'question') then return jsonb_build_object('ok', false, 'error', 'Unknown form.'); end if;
  if length(v_msg) < 5 then return jsonb_build_object('ok', false, 'error', 'Please write your message.'); end if;
  if p_kind <> 'question' and v_phone is null and v_email is null then
    return jsonb_build_object('ok', false, 'error', 'Please give a phone number or email so we can reply.');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'That email address does not look right.');
  end if;
  if jsonb_typeof(v_details) <> 'object' or length(v_details::text) > 8000 then v_details := '{}'::jsonb; end if;

  if (select count(*) from clinic_site_messages
       where business_id = v_biz and created_at > now() - interval '1 day'
         and ((v_phone is not null and phone = v_phone) or (v_email is not null and email = v_email))) >= 5
     or (select count(*) from clinic_site_messages
       where business_id = v_biz and created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('ok', false, 'error', 'We have your earlier messages. Please call or WhatsApp us instead.');
  end if;

  insert into clinic_site_messages (business_id, kind, name, phone, email, country, message, details, lang, page)
  values (v_biz, p_kind, nullif(left(btrim(coalesce(p_name, '')), 80), ''), v_phone, v_email,
          nullif(left(btrim(coalesce(p_country, '')), 60), ''), v_msg, v_details,
          case when p_lang in ('en', 'hi') then p_lang end, left(split_part(coalesce(p_page, ''), '?', 1), 200))
  returning id into v_id;

  insert into email_outbox (kind, business_id, payload)
  values ('clinic_site_message', v_biz, jsonb_build_object('message_id', v_id));

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function sehat_site_message(text, text, text, text, text, text, text, jsonb, text, text, text) from public;
grant execute on function sehat_site_message(text, text, text, text, text, text, text, jsonb, text, text, text) to anon, authenticated;

/** The site's published questions and answers, newest first. */
create or replace function sehat_public_questions(p_key text, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'question', m.message, 'answer', m.reply,
           'name', coalesce(nullif(btrim(m.public_name), ''), 'Anonymous'),
           'lang', m.lang, 'on', (m.published_at at time zone 'Asia/Kolkata')::date)
           order by m.published_at desc), '[]'::jsonb)
    from (select * from clinic_site_messages
           where business_id = sehat_site_business(p_key) and publish and kind = 'question'
           order by published_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) m;
$$;
revoke all on function sehat_public_questions(text, integer) from public;
grant execute on function sehat_public_questions(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
