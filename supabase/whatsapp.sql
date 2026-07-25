-- ============================================================================
-- Sehatsandhi — inbound WhatsApp (AISensy) contacts, sessions and opt-in
--
-- Run AFTER supabase/schema.sql and supabase/patients.sql.
-- Safe to re-run: every statement is idempotent.
--
-- THE MODEL: INBOUND-ONLY
-- We never message the hospital-register backlog. Those rows exist so that when
-- a patient messages us FIRST, the bot already knows them — name, area, last
-- visit, doctor seen — and can skip five questions. All contact is
-- user-initiated, so there is no consent problem to solve at send time.
--
-- New opt-ins come from QR posters at reception and on OPD slips, which open a
-- wa.me link with pre-filled text. The patient's own message is the opt-in, and
-- we keep that one message verbatim as the evidence.
--
-- TWO THINGS THAT ARE NOT THE SAME, AND ARE TRACKED SEPARATELY
--
--   1. SERVICE WINDOW (wa_contacts.last_inbound_at)
--      An inbound message lets us reply freely for 24 hours. This is about
--      answering someone who just wrote to us. It expires. It is NOT consent.
--
--   2. MARKETING CONSENT (patients.consent_status / consent_channels)
--      Permission to send business-initiated template messages later. It only
--      exists if the patient actually agreed — which, for a QR entry point,
--      depends on what the pre-filled text said. See wa_entry_points.
--
--   Conflating these is how businesses lose their WhatsApp number: replying in
--   the window is fine, blasting templates to everyone who ever said "hi" is
--   what earns blocks and a quality-rating downgrade.
--
-- WHAT A CLICK GIVES US: nothing. Tapping wa.me only opens WhatsApp on the
-- patient's phone. Nothing reaches us until they hit send. First contact gives
-- us their phone number, their WhatsApp display name (as they set it — often
-- not their real name), a message id, a timestamp, the message, and a referral
-- block if they came via a link or ad. No email, no photo, no contacts, no
-- location unless they explicitly share it.
--
-- MESSAGE RETENTION: structured extract only. Bodies are kept while a session
-- is open because the bot needs the context, then purged — see
-- sehat_purge_closed_session_bodies(). The single exception is the first
-- inbound message, kept permanently on wa_contacts as opt-in evidence.
-- ============================================================================

-- ============================================================================
-- wa_entry_points — one row per QR poster, slip or web button.
--
-- Each gets its own code so you can measure which reception desk actually
-- produces patients. grants_marketing_consent is the important column: it must
-- be true ONLY where the pre-filled text is an unambiguous agreement to receive
-- updates. A generic "I need help" is a service request, not consent.
-- ============================================================================

create table if not exists wa_entry_points (
  code text primary key,                   -- 'qr_sharma_reception', 'opd_slip', 'web_home'
  label text not null,                     -- 'Sharma Hospital — reception poster'
  location text,                           -- hospital / page it lives on
  prefilled_text text not null,            -- exactly what the patient's message will say
  grants_marketing_consent boolean default false,
  is_active boolean default true,
  created_at timestamptz default now()
);

comment on column wa_entry_points.grants_marketing_consent is
  'True only if prefilled_text is an explicit agreement to receive updates. '
  'If the patient merely asks for help, this is false and only the 24h service window applies.';

-- Seed. The wa.me link for each is:
--   https://wa.me/<WA_NUMBER>?text=<url-encoded prefilled_text>
--
-- The first two are the links the site already sends today (App.tsx's floating
-- button, and PatientHome's "Book on WhatsApp" — the latter appends the selected
-- area in brackets). Both are help requests, so neither grants consent. The QR
-- entries are the new opt-in path, where the text IS the agreement.
insert into wa_entry_points (code, label, location, prefilled_text, grants_marketing_consent) values
  ('web_float',            'Website — floating WhatsApp button', 'all pages',
   'Namaste!',                                                                 false),
  ('web_home',             'Homepage — Book on WhatsApp',        'sehatsandhi.com/',
   'Hi Sehatsandhi, I need help',                                              false),
  ('web_ambulance',        'Homepage — Ambulance now',           'sehatsandhi.com/',
   'EMERGENCY: I need an ambulance',                                           false),
  ('qr_reception_consent', 'Reception QR — opt-in poster',        'hospital reception',
   'Yes, I want health updates and booking help from Sehatsandhi on WhatsApp',  true),
  ('opd_slip',             'OPD slip QR — opt-in',               'printed OPD slip',
   'Yes, I want health updates and booking help from Sehatsandhi on WhatsApp',  true)
on conflict (code) do update
  set label = excluded.label,
      location = excluded.location,
      prefilled_text = excluded.prefilled_text,
      grants_marketing_consent = excluded.grants_marketing_consent;

-- ============================================================================
-- wa_contacts — one row per WhatsApp user who has written to us.
--
-- patient_id links to the register row when the number matches, which is what
-- makes the backlog useful without messaging it.
-- ============================================================================

create table if not exists wa_contacts (
  phone text primary key,                  -- wa_id, digits only: 919812345678
  patient_id uuid references patients(id) on delete set null,

  profile_name text,                       -- WhatsApp display name, self-set
  lang text default 'hi',

  entry_code text references wa_entry_points(code),
  referral_source_url text,                -- from the webhook referral block
  referral_headline text,

  first_inbound_at timestamptz default now(),
  last_inbound_at timestamptz default now(),
  inbound_count integer default 1,

  -- opt-in evidence: the one message body we keep permanently, because it is
  -- what proves the patient initiated contact and what they agreed to
  optin_message_id text,
  optin_message_text text,
  optin_at timestamptz,

  matched_register boolean default false,   -- were they already known from a register?
  created_at timestamptz default now()
);

do $$ begin
  alter table wa_contacts add constraint wa_contacts_phone_format
    check (phone ~ '^91[6-9][0-9]{9}$') not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table wa_contacts add constraint wa_contacts_lang_check
    check (lang in ('en', 'hi')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists wa_contacts_patient_idx  on wa_contacts (patient_id);
create index if not exists wa_contacts_last_in_idx  on wa_contacts (last_inbound_at desc);
create index if not exists wa_contacts_entry_idx    on wa_contacts (entry_code);

-- ============================================================================
-- wa_sessions — one bot conversation, as a structured extract.
--
-- This is the durable record: what they wanted, where, what came of it. No
-- symptom free-text lives here.
-- ============================================================================

create table if not exists wa_sessions (
  id uuid primary key default gen_random_uuid(),
  phone text references wa_contacts(phone) on delete cascade,
  patient_id uuid references patients(id) on delete set null,

  -- what the bot resolved from the conversation
  service_category text,                   -- doctors | hospital | pharmacy | lab | insurance | ambulance
  speciality text,                         -- 'cardiology' — a category, not a complaint
  area text,
  pin_code text,
  chosen_doctor_id uuid references doctors(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,

  outcome text default 'open',             -- open | booked | abandoned | referred | no_match
  entry_code text references wa_entry_points(code),

  started_at timestamptz default now(),
  last_activity_at timestamptz default now(),
  closed_at timestamptz,
  bodies_purged_at timestamptz             -- when free text was deleted
);

do $$ begin
  alter table wa_sessions add constraint wa_sessions_outcome_check
    check (outcome in ('open', 'booked', 'abandoned', 'referred', 'no_match')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists wa_sessions_phone_idx  on wa_sessions (phone, started_at desc);
create index if not exists wa_sessions_open_idx   on wa_sessions (outcome) where outcome = 'open';

-- ============================================================================
-- wa_session_messages — working memory only.
--
-- The bot needs recent turns to hold a conversation, so bodies live here while
-- the session is open and are deleted once it closes. Nothing here is a
-- permanent record; anything worth keeping belongs in wa_sessions above.
-- ============================================================================

create table if not exists wa_session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references wa_sessions(id) on delete cascade,
  phone text,
  direction text not null,                 -- inbound | outbound
  message_id text,                         -- provider id, for dedupe on webhook retries
  body text,                               -- PURGED after the session closes
  message_type text default 'text',        -- text | button | image | location | interactive
  created_at timestamptz default now()
);

do $$ begin
  alter table wa_session_messages add constraint wa_session_messages_direction_check
    check (direction in ('inbound', 'outbound')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists wa_session_messages_session_idx on wa_session_messages (session_id, created_at);
-- AISensy retries webhooks; this makes a repeat delivery a no-op.
create unique index if not exists wa_session_messages_message_id_idx
  on wa_session_messages (message_id) where message_id is not null;

-- ============================================================================
-- Inbound handler — what the AISensy webhook calls on every incoming message.
--
-- Does the whole first-contact path atomically:
--   • normalises the phone, ignoring anything that isn't an Indian mobile
--   • matches or creates the patient row (a register match links, not duplicates)
--   • marks the patient verified — they told us the number themselves, which is
--     stronger evidence than a transcription from handwriting
--   • records the first message as opt-in evidence
--   • grants marketing consent ONLY if the entry point's pre-filled text was an
--     explicit agreement, and logs it to patient_consents with the message id
--   • refuses to resurrect anyone who has opted out
--
-- Returns the wa_contacts row so the bot can greet a known patient by name.
-- ============================================================================

create or replace function sehat_wa_handle_inbound(
  p_raw_phone text,
  p_profile_name text default null,
  p_message_id text default null,
  p_message_text text default null,
  p_entry_code text default null,
  p_referral_source_url text default null
)
returns wa_contacts
language plpgsql security definer
set search_path = public
as $$
declare
  v_phone text;
  v_patient_id uuid;
  v_grants boolean := false;
  v_is_new boolean := false;
  v_contact wa_contacts;
begin
  v_phone := sehat_normalise_phone(p_raw_phone);
  if v_phone is null then
    raise exception 'not an Indian mobile number: %', p_raw_phone;
  end if;

  -- Someone who opted out does not get re-enrolled by writing to us. They can
  -- still be replied to inside the service window; they just do not regain
  -- marketing consent here.
  if exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(v_phone)) then
    v_grants := false;
  else
    select coalesce(e.grants_marketing_consent, false) into v_grants
      from wa_entry_points e
     where e.code = p_entry_code and e.is_active;
    v_grants := coalesce(v_grants, false);
  end if;

  -- Match the register, or create the patient. phone is unique on patients, so
  -- an existing register row is reused rather than duplicated.
  select id into v_patient_id from patients where phone = v_phone;

  if v_patient_id is null then
    v_is_new := true;
    insert into patients (phone, name, lang, source, source_detail, verified, status)
    values (v_phone, nullif(p_profile_name, ''), 'hi', 'whatsapp_inbound',
            coalesce(p_entry_code, 'unknown entry point'), true, 'active')
    returning id into v_patient_id;
  else
    -- self-asserted phone beats a handwriting transcription
    update patients
       set verified = true,
           name = coalesce(name, nullif(p_profile_name, '')),
           updated_at = now()
     where id = v_patient_id;
  end if;

  if v_grants then
    update patients
       set consent_status = 'granted',
           consent_channels = array['whatsapp'],
           consent_basis = 'Patient-initiated WhatsApp opt-in via ' || coalesce(p_entry_code, 'QR'),
           consent_at = coalesce(consent_at, now())
     where id = v_patient_id
       and consent_status <> 'granted';

    insert into patient_consents (patient_id, phone, channel, action, basis, evidence_ref, recorded_by)
    values (v_patient_id, v_phone, 'whatsapp', 'granted',
            'Patient sent: ' || coalesce(left(p_message_text, 200), '(no text)'),
            p_message_id, 'system:wa_inbound');
  end if;

  insert into wa_contacts (
    phone, patient_id, profile_name, entry_code, referral_source_url,
    optin_message_id, optin_message_text, optin_at, matched_register
  ) values (
    v_phone, v_patient_id, nullif(p_profile_name, ''), p_entry_code, p_referral_source_url,
    p_message_id, p_message_text, now(), not v_is_new
  )
  on conflict (phone) do update
     set patient_id      = coalesce(wa_contacts.patient_id, excluded.patient_id),
         profile_name    = coalesce(excluded.profile_name, wa_contacts.profile_name),
         last_inbound_at = now(),
         inbound_count   = wa_contacts.inbound_count + 1
  returning * into v_contact;

  return v_contact;
end $$;

revoke all on function sehat_wa_handle_inbound(text, text, text, text, text, text) from anon, authenticated;

-- ============================================================================
-- inbound_patient_context — what the bot reads to recognise a caller.
--
-- This is the payoff for storing the register: a returning patient is greeted
-- by name with their area pre-filled, and the bot asks less.
-- ============================================================================

create or replace view inbound_patient_context as
select
  c.phone,
  c.profile_name,
  c.lang,
  c.inbound_count,
  c.last_inbound_at,
  c.matched_register,
  p.id                as patient_id,
  p.name              as register_name,
  p.area,
  p.pin_code,
  p.city,
  p.gender,
  p.age,
  p.last_visit_date,
  p.visit_count,
  p.consent_status,
  p.consent_channels,
  -- the 24h reply window: about answering them, not about marketing
  (c.last_inbound_at > now() - interval '24 hours') as service_window_open,
  (select v.doctor_seen from patient_visits v
    where v.patient_id = p.id order by v.visit_date desc nulls last limit 1) as last_doctor_seen
from wa_contacts c
left join patients p on p.id = c.patient_id;

alter view inbound_patient_context set (security_invoker = on);

-- Numbers we may reply to freely right now, because they wrote to us recently.
-- Distinct from messageable_whatsapp, which is about business-initiated sends.
create or replace view wa_service_window_open as
select phone, patient_id, profile_name, last_inbound_at,
       last_inbound_at + interval '24 hours' as window_closes_at
from wa_contacts
where last_inbound_at > now() - interval '24 hours';

alter view wa_service_window_open set (security_invoker = on);

-- Which QR poster is actually working.
-- Scalar subqueries rather than two left joins, which would multiply contacts
-- by sessions and inflate every count.
create or replace view wa_entry_point_stats as
select
  e.code,
  e.label,
  e.location,
  e.grants_marketing_consent,
  (select count(*) from wa_contacts c where c.entry_code = e.code)                    as contacts,
  (select count(*) from wa_contacts c where c.entry_code = e.code
      and c.matched_register)                                                          as already_in_register,
  (select count(*) from wa_contacts c where c.entry_code = e.code
      and c.first_inbound_at > now() - interval '30 days')                             as new_last_30d,
  (select count(*) from wa_sessions s where s.entry_code = e.code)                     as sessions,
  (select count(*) from wa_sessions s where s.entry_code = e.code
      and s.outcome = 'booked')                                                        as booked
from wa_entry_points e;

alter view wa_entry_point_stats set (security_invoker = on);

-- ============================================================================
-- Retention — drop message bodies once a session is done.
--
-- Keeps the structured extract in wa_sessions and deletes the free text, so a
-- symptom description never becomes a permanent record. Run it on a schedule:
--
--   select cron.schedule('purge-wa-bodies', '0 3 * * *',
--                        $$select sehat_purge_closed_session_bodies(7)$$);
--
-- (Requires the pg_cron extension — enable it under Database → Extensions.)
-- ============================================================================

create or replace function sehat_purge_closed_session_bodies(p_days integer default 7)
returns integer language plpgsql as $$
declare v_count integer;
begin
  with stale as (
    select id from wa_sessions
     where outcome <> 'open'
       and coalesce(closed_at, last_activity_at) < now() - make_interval(days => p_days)
       and bodies_purged_at is null
  )
  delete from wa_session_messages m using stale s where m.session_id = s.id;

  get diagnostics v_count = row_count;

  update wa_sessions
     set bodies_purged_at = now()
   where outcome <> 'open'
     and coalesce(closed_at, last_activity_at) < now() - make_interval(days => p_days)
     and bodies_purged_at is null;

  return v_count;
end $$;

-- Sessions abandoned mid-conversation never get closed by the bot; close them
-- so their bodies become eligible for purging.
create or replace function sehat_close_stale_sessions(p_hours integer default 48)
returns integer language plpgsql as $$
declare v_count integer;
begin
  update wa_sessions
     set outcome = 'abandoned', closed_at = now()
   where outcome = 'open'
     and last_activity_at < now() - make_interval(hours => p_hours);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ============================================================================
-- RLS — everything here is patient PII. Service-role only, same as patients.
-- The AISensy webhook must authenticate with the service-role key (or call an
-- edge function that holds it). Never from browser code.
-- ============================================================================

alter table wa_contacts         enable row level security;
alter table wa_sessions         enable row level security;
alter table wa_session_messages enable row level security;
alter table wa_entry_points     enable row level security;

revoke all on wa_contacts, wa_sessions, wa_session_messages from anon, authenticated;
revoke all on inbound_patient_context, wa_service_window_open, wa_entry_point_stats from anon, authenticated;

-- Entry points hold no PII and the site needs to build wa.me links from them.
create policy "read_active_entry_points" on wa_entry_points
  for select using (is_active = true);

-- ============================================================================
-- WIRING AISENSY
--
-- On every inbound message, call:
--
--   select * from sehat_wa_handle_inbound(
--     p_raw_phone           => '919812345678',
--     p_profile_name        => 'Ramesh',
--     p_message_id          => 'wamid.HBgM...',
--     p_message_text        => 'Yes, I want health updates ...',
--     p_entry_code          => 'qr_reception_consent',
--     p_referral_source_url => 'https://sehatsandhi.com/'
--   );
--
-- Then read the caller's context to personalise the greeting:
--
--   select * from inbound_patient_context where phone = '919812345678';
--
-- A register match returns register_name, area and last_visit_date, so the bot
-- opens with "Namaste Ramesh — Model Town, same as your last visit on 12 Jul?"
-- instead of asking. matched_register = false means they are new.
--
-- Open a session and record the extract as the conversation resolves:
--
--   insert into wa_sessions (phone, patient_id, service_category, area, pin_code, entry_code)
--   values ('919812345678', '<patient id>', 'doctors', 'Model Town', '135002',
--           'qr_reception_consent')
--   returning id;
--
--   update wa_sessions
--      set speciality = 'cardiology', chosen_doctor_id = '<doctor id>',
--          appointment_id = '<appointment id>', outcome = 'booked',
--          closed_at = now(), last_activity_at = now()
--    where id = '<session id>';
--
-- STOP handling — one insert, and the triggers in patients.sql do the rest
-- (consent flipped to withdrawn, logged, dropped from messageable_whatsapp):
--
--   insert into opt_outs (phone, channel, reason)
--   values ('919812345678', 'whatsapp', 'replied STOP');
--
-- SENDING RULES, RESTATED BECAUSE IT IS EASY TO GET WRONG
--   • Replying to someone in wa_service_window_open — always fine, free text.
--   • Business-initiated template later — only to messageable_whatsapp, which
--     requires consent_status = 'granted' AND no opt-out.
--   • An inbound "hi" from web_home puts them in the service window but grants
--     NO marketing consent, because that entry point's text was a request for
--     help, not an agreement. That is deliberate.
-- ============================================================================
