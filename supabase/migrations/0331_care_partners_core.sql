-- ============================================================================
-- 0331 — Care Partner Program, Phase 1: partners, learning, Help Center
-- ============================================================================
-- AFTER 0329. Safe to re-run. Independent of 0330 (EMI invoices).
-- Brief: https://claude.ai/artifact/Wc4MJ5dGZBzQeATsbtyJKj · Plan: docs/2026-11-partner-program-plan.md
--
-- Care Partners introduce Sehatsandhi to businesses and earn Partner Rewards
-- (Phase 5). This phase: their own login (partner-otp, WhatsApp code), the
-- registration with eligibility checks, the status machine, the learning page
-- (modules with a YouTube video and a PDF each, progress), the contracts list,
-- the Help Center FAQ, and the admin CMS for all of it.
--
--   site_settings 'partner_program_enabled'  'off' until the launch gates are met
--                  (lawyer's opinion, content for Modules 1–10, CA sign-off).
--   site_settings 'partner_*'                every OPEN value of the brief.
--   care_partner_login_codes     codes for partner-otp only (kept apart from login_codes,
--                        which the clinic and patient logins share).
--   care_partners        one per partner login; status machine in functions.
--   care_partner_modules, care_partner_progress
--   care_partner_contracts       versioned documents; one current per kind.
--   care_partner_faq, care_partner_faq_synonyms
--   storage 'partner-content'  private: module PDFs and contracts (signed URLs).
--
-- Names use care_ because "partner" already means three things here (0255
-- marketing partners, metric "partners" = businesses, international partners).
-- Partners become rows in 0255's marketing_partners (kind 'care') when their
-- Partner ID is issued in Phase 3, so money keeps one system.
--
-- Tables are read-only to clients (RLS select); every write is a checked
-- function. Nothing is sent to any doctor or business by this phase.
-- ============================================================================

-- ── Settings (all OPEN values of the brief; admin edits them) ───────────────
insert into site_settings (key, value) values
  ('partner_program_enabled', 'off'),
  ('partner_cert_fee', '100'),
  ('partner_pass_mark', '80'),
  ('partner_module_questions', '5'),
  ('partner_final_questions', '15'),
  ('partner_retake_hours', '48'),
  ('partner_doc_min_seconds', '60'),
  ('partner_video_done_pct', '90'),
  ('partner_lead_lock_days', '90'),
  ('partner_lead_cap_new', '10'),
  ('partner_claim_days', '7'),
  ('partner_refund_window_days', '14'),
  ('partner_min_payout', '500'),
  ('partner_inactive_days', '90'),
  ('partner_ticket_sla_hours', '48'),
  ('partner_start_reward_cap', '15000'),
  ('partner_renewal_grace_days', '60'),
  ('partner_contact_email', 'contact@sehatsandhi.com')
on conflict (key) do nothing;

create or replace function sehat_partner_program_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'on' from site_settings where key = 'partner_program_enabled'), false)
$$;
revoke all on function sehat_partner_program_enabled() from public;
grant execute on function sehat_partner_program_enabled() to anon, authenticated, service_role;

-- The public settings, for {{variables}} in FAQ answers and page text.
create or replace function sehat_care_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(substr(key, 9), value), '{}'::jsonb)
           || jsonb_build_object('site', sehat_site_url(), 'reward_window_days',
                (select value from site_settings where key = 'partner_refund_window_days'))
    from site_settings where key like 'partner\_%' escape '\'
$$;
revoke all on function sehat_care_settings() from public;
grant execute on function sehat_care_settings() to anon, authenticated, service_role;

create or replace function sehat_care_setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(regexp_replace(value, '[^0-9]', '', 'g'), '')::int from site_settings where key = 'partner_' || p_key), p_default)
$$;
revoke all on function sehat_care_setting_int(text, int) from public, anon, authenticated;

-- ── Login codes for partner-otp (service role only) ─────────────────────────
create table if not exists care_partner_login_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists care_login_codes_phone_idx on care_partner_login_codes (phone, created_at desc);
alter table care_partner_login_codes enable row level security;
revoke all on care_partner_login_codes from anon, authenticated;

-- ── Partners ────────────────────────────────────────────────────────────────
create table if not exists care_partners (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references auth.users(id) on delete cascade,
  phone               text not null unique check (phone ~ '^91[6-9][0-9]{9}$'),
  full_name           text not null,
  email               text,
  city                text not null,
  state               text not null,
  language            text not null default 'hi' check (language in ('hi', 'en')),
  date_of_birth       date not null,
  occupation          text,
  status              text not null default 'registered' check (status in
                        ('registered', 'learning', 'quiz_passed', 'fee_paid', 'active', 'paused', 'suspended', 'terminated')),
  status_reason       text,
  status_changed_at   timestamptz not null default now(),
  level               text not null default 'associate' check (level in ('associate', 'senior', 'elite')),
  partner_code        text unique check (partner_code is null or partner_code ~ '^SP-[2-9A-HJ-NP-Z]{6}$'),
  marketing_partner_id uuid references marketing_partners(id) on delete set null,   -- Phase 3: kind 'care'
  kyc_status          text not null default 'not_started' check (kyc_status in ('not_started', 'submitted', 'verified', 'rejected')),
  pan_hash            text unique, bank_hash text unique,
  pan_last4           text, bank_last4 text, kyc_verified_at timestamptz,
  agreement_version   text, agreement_signed_at timestamptz,
  certified_at        timestamptz, valid_until date,
  declared_not_doctor boolean not null,
  declared_employer_ok boolean not null,
  consent_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table care_partners enable row level security;
drop policy if exists care_partners_read on care_partners;
create policy care_partners_read on care_partners for select to authenticated
  using (user_id = auth.uid() or sehat_is_admin());

-- ── Learning ────────────────────────────────────────────────────────────────
create table if not exists care_partner_modules (
  id             uuid primary key default gen_random_uuid(),
  sort_order     integer not null default 0,
  slug           text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  title_hi       text not null, title_en text not null,
  desc_hi        text, desc_en text,
  youtube_id_hi  text check (youtube_id_hi is null or youtube_id_hi ~ '^[A-Za-z0-9_-]{11}$'),
  youtube_id_en  text check (youtube_id_en is null or youtube_id_en ~ '^[A-Za-z0-9_-]{11}$'),
  video_seconds  integer,
  pdf_path_hi    text, pdf_path_en text,
  est_minutes    integer,
  is_published   boolean not null default false,
  updated_at     timestamptz not null default now()
);

create table if not exists care_partner_progress (
  partner_id          uuid not null references care_partners(id) on delete cascade,
  module_id           uuid not null references care_partner_modules(id) on delete cascade,
  video_max_pct       integer not null default 0 check (video_max_pct between 0 and 100),
  video_completed_at  timestamptz,
  doc_opened_at       timestamptz,
  doc_read_at         timestamptz,
  quiz_passed_at      timestamptz,                     -- Phase 2
  updated_at          timestamptz not null default now(),
  primary key (partner_id, module_id)
);

alter table care_partner_modules enable row level security;
alter table care_partner_progress enable row level security;
drop policy if exists care_modules_read on care_partner_modules;
create policy care_modules_read on care_partner_modules for select to authenticated
  using (sehat_is_admin() or (is_published and exists (select 1 from care_partners p where p.user_id = auth.uid())));
drop policy if exists care_module_progress_read on care_partner_progress;
create policy care_module_progress_read on care_partner_progress for select to authenticated
  using (sehat_is_admin() or exists (select 1 from care_partners p where p.id = partner_id and p.user_id = auth.uid()));

-- ── Contracts (versioned; acceptance comes in Phase 3) ──────────────────────
create table if not exists care_partner_contracts (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('partner_agreement', 'code_of_conduct', 'reward_policy', 'privacy_notice', 'fee_terms')),
  version        text not null,
  title_hi       text not null, title_en text not null,
  pdf_path_hi    text, pdf_path_en text,
  effective_from date,
  is_current     boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (kind, version)
);
create unique index if not exists care_contracts_one_current on care_partner_contracts (kind) where is_current;
alter table care_partner_contracts enable row level security;
drop policy if exists care_contracts_read on care_partner_contracts;
create policy care_contracts_read on care_partner_contracts for select to authenticated
  using (sehat_is_admin() or (is_current and exists (select 1 from care_partners p where p.user_id = auth.uid())));

-- ── Help Center ─────────────────────────────────────────────────────────────
create table if not exists care_partner_faq (
  id           text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  category     text not null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  keywords_en  text[] not null default '{}',
  keywords_hi  text[] not null default '{}',
  question_en  text not null, question_hi text not null,
  answer_en    text not null, answer_hi text not null,     -- may contain {{variables}}
  link_path    text,
  helpful_yes  integer not null default 0,
  helpful_no   integer not null default 0,
  updated_at   timestamptz not null default now()
);
create table if not exists care_partner_faq_synonyms (
  term       text not null,
  canonical  text not null,
  lang       text not null default 'any',
  primary key (term, canonical)
);
alter table care_partner_faq enable row level security;
alter table care_partner_faq_synonyms enable row level security;
drop policy if exists care_faq_read on care_partner_faq;
create policy care_faq_read on care_partner_faq for select to anon, authenticated using (is_active or sehat_is_admin());
drop policy if exists care_faq_synonyms_read on care_partner_faq_synonyms;
create policy care_faq_synonyms_read on care_partner_faq_synonyms for select to anon, authenticated using (true);

-- "Did this help?" — anyone, one tap; counts only.
create or replace function sehat_care_faq_helpful(p_id text, p_yes boolean)
returns void language sql volatile security definer set search_path = public as $$
  update care_partner_faq set helpful_yes = helpful_yes + case when p_yes then 1 else 0 end,
                      helpful_no  = helpful_no  + case when p_yes then 0 else 1 end
   where id = p_id and is_active
$$;
revoke all on function sehat_care_faq_helpful(text, boolean) from public;
grant execute on function sehat_care_faq_helpful(text, boolean) to anon, authenticated;

-- ── Storage: module PDFs and contracts (private, signed URLs) ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-content', 'partner-content', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists partner_content_read on storage.objects;
create policy partner_content_read on storage.objects for select to authenticated
  using (bucket_id = 'partner-content'
         and (sehat_is_admin() or exists (select 1 from care_partners p where p.user_id = auth.uid())));
drop policy if exists partner_content_write on storage.objects;
create policy partner_content_write on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-content' and sehat_is_admin());
drop policy if exists partner_content_update on storage.objects;
create policy partner_content_update on storage.objects for update to authenticated
  using (bucket_id = 'partner-content' and sehat_is_admin());
drop policy if exists partner_content_delete on storage.objects;
create policy partner_content_delete on storage.objects for delete to authenticated
  using (bucket_id = 'partner-content' and sehat_is_admin());

-- ── Who is calling ──────────────────────────────────────────────────────────
-- The phone comes from the partner login's own address (91XXXXXXXXXX@partner.
-- sehatsandhi.in, made by partner-otp), never from the browser.
create or replace function sehat_care_my_phone()
returns text language sql stable security definer set search_path = public as $$
  select substring(coalesce(auth.jwt() ->> 'email', '') from '^(91[6-9][0-9]{9})@partner\.sehatsandhi\.in$')
$$;
revoke all on function sehat_care_my_phone() from public, anon, authenticated;

create or replace function sehat_care_me_row()
returns care_partners language sql stable security definer set search_path = public as $$
  select * from care_partners where user_id = auth.uid()
$$;
revoke all on function sehat_care_me_row() from public, anon, authenticated;

create or replace function sehat_care_set_status(p_partner uuid, p_status text, p_reason text default null)
returns void language sql volatile security definer set search_path = public as $$
  update care_partners set status = p_status, status_reason = p_reason, status_changed_at = now(), updated_at = now()
   where id = p_partner and status is distinct from p_status
$$;
revoke all on function sehat_care_set_status(uuid, text, text) from public, anon, authenticated;

-- What to do next — one sentence and one button, from the status (brief §14.1).
create or replace function sehat_care_next_step(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_done int; v_next care_partner_modules;
begin
  if p.id is null then
    return jsonb_build_object('key', 'register', 'path', '/partner/register',
      'en', 'Fill in your details to start the free training.', 'hi', 'मुफ़्त ट्रेनिंग शुरू करने के लिए अपनी जानकारी भरें।');
  end if;
  if p.status in ('paused', 'suspended', 'terminated') then
    return jsonb_build_object('key', p.status, 'path', '/partner/help',
      'en', case p.status when 'paused' then 'Your Partner ID is paused. See Help to find out why and what to do.'
                          when 'suspended' then 'Your account is suspended. Write to us from the Help page.'
                          else 'Your partnership has ended.' end,
      'hi', case p.status when 'paused' then 'आपका Partner ID रोका गया है। कारण और आगे का कदम जानने के लिए Help देखें।'
                          when 'suspended' then 'आपका खाता निलंबित है। Help पेज से हमें लिखें।'
                          else 'आपकी साझेदारी समाप्त हो गई है।' end);
  end if;
  select count(*), count(*) filter (where pr.video_completed_at is not null and pr.doc_read_at is not null)
    into v_total, v_done
    from care_partner_modules m left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
   where m.is_published;
  if p.status in ('registered', 'learning') then
    select m.* into v_next from care_partner_modules m
      left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
     where m.is_published and (pr.video_completed_at is null or pr.doc_read_at is null)
     order by m.sort_order limit 1;
    if v_next.id is not null then
      return jsonb_build_object('key', 'module', 'path', '/partner/learn#' || v_next.slug, 'done', v_done, 'total', v_total,
        'en', format('Next: %s — watch the video and read the PDF.', v_next.title_en),
        'hi', format('अगला: %s — वीडियो देखें और PDF पढ़ें।', v_next.title_hi));
    end if;
    return jsonb_build_object('key', 'exam_soon', 'path', '/partner/learn', 'done', v_done, 'total', v_total,
      'en', 'You have finished the modules available now. Quizzes and the final exam open soon.',
      'hi', 'अभी उपलब्ध सभी मॉड्यूल पूरे हो गए। क्विज़ और फ़ाइनल परीक्षा जल्द खुलेंगे।');
  end if;
  return jsonb_build_object('key', p.status, 'path', '/partner/learn',
    'en', 'Keep going — the next steps open soon.', 'hi', 'आगे बढ़ते रहें — अगले कदम जल्द खुलेंगे।');
end $$;
revoke all on function sehat_care_next_step(care_partners) from public, anon, authenticated;

-- The signed-in partner, their next step and progress. Works before registration.
create or replace function sehat_care_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p care_partners; v_phone text := sehat_care_my_phone();
begin
  if v_phone is null then return jsonb_build_object('signed_in', false); end if;
  p := sehat_care_me_row();
  return jsonb_build_object(
    'signed_in', true, 'phone', v_phone, 'registered', p.id is not null,
    'program_enabled', sehat_partner_program_enabled(),
    'partner', case when p.id is null then null else jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'city', p.city, 'state', p.state, 'language', p.language,
      'status', p.status, 'status_reason', p.status_reason, 'level', p.level, 'partner_code', p.partner_code,
      'created_at', p.created_at) end,
    'next', sehat_care_next_step(p));
end $$;
revoke all on function sehat_care_me() from public, anon;
grant execute on function sehat_care_me() to authenticated;

-- ── Registration (brief §1 eligibility) ─────────────────────────────────────
create or replace function sehat_care_register(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone text := sehat_care_my_phone();
  v_name text := btrim(coalesce(p->>'full_name', ''));
  v_email text := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  v_dob date; v_id uuid;
begin
  if not sehat_partner_program_enabled() and not sehat_is_admin() then
    raise exception 'The Partner Program is not open yet.' using errcode = 'P0001';
  end if;
  if v_phone is null then raise exception 'Please sign in with your mobile number first.' using errcode = '42501'; end if;
  if exists (select 1 from care_partners where user_id = auth.uid() or phone = v_phone) then
    raise exception 'You are already registered.' using errcode = 'P0001';
  end if;
  if length(v_name) < 3 then raise exception 'Please enter your full name.' using errcode = '22023'; end if;
  if btrim(coalesce(p->>'city', '')) = '' or btrim(coalesce(p->>'state', '')) = '' then
    raise exception 'Please enter your city and state.' using errcode = '22023';
  end if;
  begin v_dob := (p->>'date_of_birth')::date; exception when others then v_dob := null; end;
  if v_dob is null or v_dob > current_date - interval '18 years' then
    raise exception 'You must be 18 or older to join.' using errcode = '22023';
  end if;
  if v_dob < current_date - interval '100 years' then raise exception 'Please check your date of birth.' using errcode = '22023'; end if;
  if coalesce((p->>'is_doctor')::boolean, true) then
    raise exception 'Registered medical practitioners cannot join the Partner Program.' using errcode = 'P0001';
  end if;
  if not coalesce((p->>'employer_ok')::boolean, false) then
    raise exception 'Please confirm this work does not break your employer''s rules.' using errcode = '22023';
  end if;
  if not coalesce((p->>'consent')::boolean, false) then
    raise exception 'Please accept the terms and privacy notice.' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please check your email address.' using errcode = '22023';
  end if;
  -- Not a doctor or a business owner already on Sehatsandhi (same phone or email).
  if exists (select 1 from businesses b where sehat_normalise_phone(b.phone) = v_phone
                                           or (v_email is not null and lower(b.email) = v_email))
     or exists (select 1 from practitioners pr
                 where (sehat_normalise_phone(pr.phone) = v_phone or (v_email is not null and lower(pr.email) = v_email))
                   and (nullif(btrim(coalesce(pr.reg_number, '')), '') is not null
                        or exists (select 1 from business_practitioners bp where bp.practitioner_id = pr.id and bp.role in ('doctor', 'owner')))) then
    raise exception 'This number or email belongs to a doctor or business on Sehatsandhi, so it cannot join the Partner Program.' using errcode = 'P0001';
  end if;

  insert into care_partners (user_id, phone, full_name, email, city, state, language, date_of_birth, occupation,
                             declared_not_doctor, declared_employer_ok, consent_at)
  values (auth.uid(), v_phone, v_name, v_email, btrim(p->>'city'), btrim(p->>'state'),
          case when p->>'language' = 'en' then 'en' else 'hi' end, v_dob, nullif(btrim(coalesce(p->>'occupation', '')), ''),
          true, true, now())
  returning id into v_id;
  return sehat_care_me();
end $$;
revoke all on function sehat_care_register(jsonb) from public, anon;
grant execute on function sehat_care_register(jsonb) to authenticated;

-- ── Learning progress ───────────────────────────────────────────────────────
-- p_event: 'video' (p_pct = furthest point reached, 0–100), 'doc_open', 'doc_read'.
-- A speed bump, not proof (brief §4.2): the furthest point only ever rises, and
-- "I have read this" needs the PDF opened at least partner_doc_min_seconds before.
create or replace function sehat_care_progress(p_module uuid, p_event text, p_pct integer default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; m care_partner_modules; pr care_partner_progress;
        v_done_pct int := sehat_care_setting_int('video_done_pct', 90);
        v_min_sec int := sehat_care_setting_int('doc_min_seconds', 60);
begin
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  if p.status in ('paused', 'suspended', 'terminated') then raise exception 'Your account cannot do this right now.' using errcode = 'P0001'; end if;
  select * into m from care_partner_modules where id = p_module and is_published;
  if m.id is null then raise exception 'No such module.' using errcode = 'P0002'; end if;

  insert into care_partner_progress (partner_id, module_id) values (p.id, m.id) on conflict do nothing;
  select * into pr from care_partner_progress where partner_id = p.id and module_id = m.id for update;

  if p_event = 'video' then
    update care_partner_progress set
      video_max_pct = greatest(video_max_pct, least(greatest(coalesce(p_pct, 0), 0), 100)),
      video_completed_at = coalesce(video_completed_at, case when greatest(video_max_pct, coalesce(p_pct, 0)) >= v_done_pct then now() end),
      updated_at = now()
     where partner_id = p.id and module_id = m.id;
  elsif p_event = 'doc_open' then
    update care_partner_progress set doc_opened_at = coalesce(doc_opened_at, now()), updated_at = now()
     where partner_id = p.id and module_id = m.id;
  elsif p_event = 'doc_read' then
    if pr.doc_opened_at is null then raise exception 'Open the PDF first.' using errcode = 'P0001'; end if;
    if pr.doc_read_at is null and pr.doc_opened_at > now() - make_interval(secs => v_min_sec) then
      raise exception 'Please take a little more time to read the PDF.' using errcode = 'P0001';
    end if;
    update care_partner_progress set doc_read_at = coalesce(doc_read_at, now()), updated_at = now()
     where partner_id = p.id and module_id = m.id;
  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;

  if p.status = 'registered' then perform sehat_care_set_status(p.id, 'learning'); end if;
  select * into pr from care_partner_progress where partner_id = p.id and module_id = m.id;
  return to_jsonb(pr);
end $$;
revoke all on function sehat_care_progress(uuid, text, integer) from public, anon;
grant execute on function sehat_care_progress(uuid, text, integer) to authenticated;

-- ── Admin ───────────────────────────────────────────────────────────────────
create or replace function sehat_care_admin_only()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
end $$;
revoke all on function sehat_care_admin_only() from public, anon, authenticated;

create or replace function sehat_admin_care_partners(p_status text default null)
returns table (id uuid, full_name text, phone text, email text, city text, state text, language text, occupation text,
               status text, status_reason text, level text, partner_code text, created_at timestamptz,
               modules_done integer, modules_total integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_care_admin_only();
  return query
    select p.id, p.full_name, p.phone, p.email, p.city, p.state, p.language, p.occupation,
           p.status, p.status_reason, p.level, p.partner_code, p.created_at,
           (select count(*)::int from care_partner_progress pr join care_partner_modules m on m.id = pr.module_id
             where pr.partner_id = p.id and m.is_published and pr.video_completed_at is not null and pr.doc_read_at is not null),
           (select count(*)::int from care_partner_modules m where m.is_published)
      from care_partners p
     where p_status is null or p.status = p_status
     order by p.created_at desc
     limit 1000;
end $$;
revoke all on function sehat_admin_care_partners(text) from public, anon;
grant execute on function sehat_admin_care_partners(text) to authenticated;

-- Pause / suspend / terminate, or restore to where the partner's progress puts them.
create or replace function sehat_admin_care_partner_status(p_partner uuid, p_action text, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; v_to text;
begin
  perform sehat_care_admin_only();
  select * into p from care_partners where id = p_partner;
  if p.id is null then raise exception 'No such partner.' using errcode = 'P0002'; end if;
  if p_action in ('paused', 'suspended', 'terminated') then
    if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason.' using errcode = '22023'; end if;
    if p.status = 'terminated' then raise exception 'This partnership has already ended.' using errcode = 'P0001'; end if;
    v_to := p_action;
  elsif p_action = 'restore' then
    if p.status not in ('paused', 'suspended') then raise exception 'Only a paused or suspended partner can be restored.' using errcode = 'P0001'; end if;
    v_to := case when p.agreement_signed_at is not null then 'active'
                 when p.partner_code is not null then 'fee_paid'
                 when exists (select 1 from care_partner_progress pr where pr.partner_id = p.id) then 'learning'
                 else 'registered' end;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform sehat_care_set_status(p.id, v_to, nullif(btrim(coalesce(p_reason, '')), ''));
  perform sehat_log_staff_action('care_partner_' || p_action, 'care_partner', p.id, p.full_name,
                                 jsonb_build_object('from', p.status, 'to', v_to, 'reason', p_reason));
end $$;
revoke all on function sehat_admin_care_partner_status(uuid, text, text) from public, anon;
grant execute on function sehat_admin_care_partner_status(uuid, text, text) to authenticated;

create or replace function sehat_admin_care_module_save(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
        yt_hi text := nullif(btrim(coalesce(p->>'youtube_id_hi', '')), '');
        yt_en text := nullif(btrim(coalesce(p->>'youtube_id_en', '')), '');
begin
  perform sehat_care_admin_only();
  -- A full YouTube link is accepted and reduced to its 11-character id.
  yt_hi := coalesce(substring(yt_hi from '(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})'), yt_hi);
  yt_en := coalesce(substring(yt_en from '(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})'), yt_en);
  if btrim(coalesce(p->>'title_en', '')) = '' or btrim(coalesce(p->>'title_hi', '')) = '' then
    raise exception 'Both titles are needed.' using errcode = '22023';
  end if;
  if coalesce((p->>'is_published')::boolean, false)
     and (coalesce(yt_hi, yt_en) is null or coalesce(nullif(p->>'pdf_path_hi', ''), nullif(p->>'pdf_path_en', '')) is null) then
    raise exception 'A module needs a video and a PDF before it can be published.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into care_partner_modules (sort_order, slug, title_hi, title_en, desc_hi, desc_en, youtube_id_hi, youtube_id_en,
                              video_seconds, pdf_path_hi, pdf_path_en, est_minutes, is_published)
    values (coalesce((p->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 10 from care_partner_modules)),
            p->>'slug', btrim(p->>'title_hi'), btrim(p->>'title_en'), p->>'desc_hi', p->>'desc_en', yt_hi, yt_en,
            nullif(p->>'video_seconds', '')::int, nullif(p->>'pdf_path_hi', ''), nullif(p->>'pdf_path_en', ''),
            nullif(p->>'est_minutes', '')::int, coalesce((p->>'is_published')::boolean, false))
    returning id into v_id;
  else
    update care_partner_modules set sort_order = coalesce(nullif(p->>'sort_order', '')::int, sort_order),
           title_hi = btrim(p->>'title_hi'), title_en = btrim(p->>'title_en'), desc_hi = p->>'desc_hi', desc_en = p->>'desc_en',
           youtube_id_hi = yt_hi, youtube_id_en = yt_en, video_seconds = nullif(p->>'video_seconds', '')::int,
           pdf_path_hi = nullif(p->>'pdf_path_hi', ''), pdf_path_en = nullif(p->>'pdf_path_en', ''),
           est_minutes = nullif(p->>'est_minutes', '')::int, is_published = coalesce((p->>'is_published')::boolean, false),
           updated_at = now()
     where id = v_id;
    if not found then raise exception 'No such module.' using errcode = 'P0002'; end if;
  end if;
  perform sehat_log_staff_action('care_module_save', 'care_module', v_id, p->>'title_en', p - 'desc_hi' - 'desc_en');
  return v_id;
end $$;
revoke all on function sehat_admin_care_module_save(jsonb) from public, anon;
grant execute on function sehat_admin_care_module_save(jsonb) to authenticated;

create or replace function sehat_admin_care_faq_save(p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform sehat_care_admin_only();
  if coalesce(p->>'id', '') !~ '^[a-z0-9_]{2,40}$' then raise exception 'Id: 2–40 lowercase letters, digits or _.' using errcode = '22023'; end if;
  if btrim(coalesce(p->>'question_en', '')) = '' or btrim(coalesce(p->>'question_hi', '')) = ''
     or btrim(coalesce(p->>'answer_en', '')) = '' or btrim(coalesce(p->>'answer_hi', '')) = '' then
    raise exception 'Question and answer are needed in both languages.' using errcode = '22023';
  end if;
  insert into care_partner_faq (id, category, sort_order, is_active, keywords_en, keywords_hi, question_en, question_hi, answer_en, answer_hi, link_path)
  values (p->>'id', coalesce(nullif(p->>'category', ''), 'Account & Support'), coalesce(nullif(p->>'sort_order', '')::int, 0),
          coalesce((p->>'is_active')::boolean, true),
          coalesce(array(select jsonb_array_elements_text(p->'keywords_en')), '{}'),
          coalesce(array(select jsonb_array_elements_text(p->'keywords_hi')), '{}'),
          btrim(p->>'question_en'), btrim(p->>'question_hi'), btrim(p->>'answer_en'), btrim(p->>'answer_hi'), nullif(p->>'link_path', ''))
  on conflict (id) do update set category = excluded.category, sort_order = excluded.sort_order, is_active = excluded.is_active,
    keywords_en = excluded.keywords_en, keywords_hi = excluded.keywords_hi, question_en = excluded.question_en,
    question_hi = excluded.question_hi, answer_en = excluded.answer_en, answer_hi = excluded.answer_hi,
    link_path = excluded.link_path, updated_at = now();
  perform sehat_log_staff_action('care_faq_save', 'care_partner_faq', null, (p->>'id') || ': ' || (p->>'question_en'), null);
end $$;
revoke all on function sehat_admin_care_faq_save(jsonb) from public, anon;
grant execute on function sehat_admin_care_faq_save(jsonb) to authenticated;

create or replace function sehat_admin_care_contract_save(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  perform sehat_care_admin_only();
  if btrim(coalesce(p->>'version', '')) = '' then raise exception 'Version is needed.' using errcode = '22023'; end if;
  if coalesce((p->>'is_current')::boolean, false) and coalesce(nullif(p->>'pdf_path_hi', ''), nullif(p->>'pdf_path_en', '')) is null then
    raise exception 'Upload the PDF before making a version current.' using errcode = 'P0001';
  end if;
  insert into care_partner_contracts (kind, version, title_hi, title_en, pdf_path_hi, pdf_path_en, effective_from, is_current)
  values (p->>'kind', btrim(p->>'version'), btrim(p->>'title_hi'), btrim(p->>'title_en'),
          nullif(p->>'pdf_path_hi', ''), nullif(p->>'pdf_path_en', ''), nullif(p->>'effective_from', '')::date, false)
  on conflict (kind, version) do update set title_hi = excluded.title_hi, title_en = excluded.title_en,
    pdf_path_hi = excluded.pdf_path_hi, pdf_path_en = excluded.pdf_path_en, effective_from = excluded.effective_from
  returning id into v_id;
  if coalesce((p->>'is_current')::boolean, false) then
    update care_partner_contracts set is_current = false where kind = p->>'kind' and id <> v_id and is_current;
    update care_partner_contracts set is_current = true where id = v_id;
  end if;
  perform sehat_log_staff_action('care_contract_save', 'care_contract', v_id, (p->>'kind') || ' ' || (p->>'version'),
                                 jsonb_build_object('is_current', coalesce((p->>'is_current')::boolean, false)));
  return v_id;
end $$;
revoke all on function sehat_admin_care_contract_save(jsonb) from public, anon;
grant execute on function sehat_admin_care_contract_save(jsonb) to authenticated;

-- Settings: only partner_* keys; numbers stay numbers; the switch is on/off.
create or replace function sehat_admin_care_settings_save(p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare k text; v text;
begin
  perform sehat_care_admin_only();
  for k, v in select key, value from jsonb_each_text(p) loop
    if k !~ '^partner_[a-z_]+$' or not exists (select 1 from site_settings where key = k) then
      raise exception 'Unknown setting %.', k using errcode = '22023';
    end if;
    if k = 'partner_program_enabled' then
      if v not in ('on', 'off') then raise exception 'The switch is on or off.' using errcode = '22023'; end if;
    elsif k = 'partner_contact_email' then
      if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Check the email address.' using errcode = '22023'; end if;
    elsif v !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception '% must be a number.', k using errcode = '22023';
    end if;
    update site_settings set value = v, updated_at = now() where key = k and value is distinct from v;
  end loop;
  perform sehat_log_staff_action('care_settings_save', 'site_settings', null, 'partner settings', p);
end $$;
revoke all on function sehat_admin_care_settings_save(jsonb) from public, anon;
grant execute on function sehat_admin_care_settings_save(jsonb) to authenticated;

-- ── Seed: the ten modules (unpublished until a video and PDF are added) ─────
insert into care_partner_modules (sort_order, slug, title_en, title_hi, desc_en, desc_hi, est_minutes) values
  (10,  'what-is-sehatsandhi', 'What Sehatsandhi is, and who it is for', 'सेहतसंधि क्या है, और किसके लिए है',
        'The platform, the businesses it serves and the problems it solves.', 'प्लेटफ़ॉर्म, यह किन व्यवसायों के लिए है और कौन-सी समस्याएँ हल करता है।', 15),
  (20,  'product-demo', 'Product demo: what a doctor gets', 'प्रोडक्ट डेमो: डॉक्टर को क्या मिलता है',
        'A walk through the clinic software, listing, WhatsApp and website.', 'क्लिनिक सॉफ़्टवेयर, लिस्टिंग, WhatsApp और वेबसाइट की झलक।', 20),
  (30,  'plans-and-rewards', 'Plans, pricing, and how Partner Rewards work', 'प्लान, कीमतें और पार्टनर रिवॉर्ड कैसे काम करते हैं',
        'The live plans and add-ons, and how Start and Renewal Rewards are worked out.', 'मौजूदा प्लान और ऐड-ऑन, और स्टार्ट व रिन्यूअल रिवॉर्ड कैसे तय होते हैं।', 20),
  (40,  'approaching-a-doctor', 'How to approach a doctor', 'डॉक्टर से कैसे बात करें',
        'Introducing Sehatsandhi, answering common questions and objections.', 'सेहतसंधि का परिचय, आम सवालों और आपत्तियों के जवाब।', 20),
  (50,  'dos-and-donts', 'Dos and don''ts', 'क्या करें और क्या न करें',
        'Approved claims only. Never say government or ABDM approved.', 'सिर्फ़ मान्य बातें कहें। सरकार या ABDM से मंज़ूर होने की बात कभी न कहें।', 15),
  (60,  'using-the-partner-app', 'Using the Partner app: Partner ID, leads and confirmation', 'पार्टनर ऐप: Partner ID, लीड और पुष्टि',
        'Your Partner ID, reserving a doctor, and how the doctor confirms your referral.', 'आपका Partner ID, डॉक्टर को रिज़र्व करना, और डॉक्टर आपके रेफ़रल की पुष्टि कैसे करते हैं।', 15),
  (70,  'payments-and-tax', 'Payments, payouts and tax', 'भुगतान, पेआउट और टैक्स',
        'PAN, TDS, invoices, statements and when rewards are paid.', 'PAN, TDS, इनवॉइस, स्टेटमेंट और रिवॉर्ड कब मिलते हैं।', 15),
  (80,  'ethics-and-privacy', 'Medical ethics and privacy', 'मेडिकल नैतिकता और प्राइवेसी',
        'NMC norms, the DPDP Act, and why partners never handle patient data.', 'NMC नियम, DPDP कानून, और पार्टनर कभी मरीज़ों का डेटा क्यों नहीं छूते।', 15),
  (90,  'communication-rules', 'Communication rules', 'बातचीत के नियम',
        'Only your own number, no mass messaging, never Sehatsandhi''s official WhatsApp.', 'सिर्फ़ अपना नंबर, कोई बल्क मैसेज नहीं, सेहतसंधि का आधिकारिक WhatsApp कभी नहीं।', 10),
  (100, 'code-of-conduct', 'Code of conduct, strikes and termination', 'आचार संहिता, चेतावनी और समाप्ति',
        'What leads to a warning, a pause or the end of the partnership.', 'किन बातों पर चेतावनी, रोक या साझेदारी समाप्त होती है।', 10)
on conflict (slug) do nothing;

-- Contract placeholders: titles only, not current until a reviewed PDF is uploaded.
insert into care_partner_contracts (kind, version, title_en, title_hi) values
  ('partner_agreement', 'draft-1', 'Partner Agreement', 'पार्टनर एग्रीमेंट'),
  ('code_of_conduct',   'draft-1', 'Code of Conduct', 'आचार संहिता'),
  ('reward_policy',     'draft-1', 'Partner Rewards Policy', 'पार्टनर रिवॉर्ड नीति'),
  ('privacy_notice',    'draft-1', 'Privacy notice for partners', 'पार्टनर के लिए प्राइवेसी नोटिस'),
  ('fee_terms',         'draft-1', 'Partner Certification Fee terms', 'पार्टनर सर्टिफ़िकेशन फ़ीस की शर्तें')
on conflict (kind, version) do nothing;

-- Synonyms for the Help Center search (more are added from the admin screen).
insert into care_partner_faq_synonyms (term, canonical) values
  ('fees', 'fee'), ('charge', 'fee'), ('फीस', 'fee'), ('शुल्क', 'fee'), ('paisa', 'fee'),
  ('retake', 'retake'), ('dobara', 'retake'), ('दोबारा', 'retake'),
  ('exam', 'quiz'), ('test', 'quiz'), ('परीक्षा', 'quiz'), ('क्विज़', 'quiz'),
  ('payout', 'payout'), ('payment', 'payout'), ('पैसा', 'payout'), ('भुगतान', 'payout'),
  ('reward', 'reward'), ('rewards', 'reward'), ('इनाम', 'reward'), ('रिवॉर्ड', 'reward'),
  ('id', 'partner_id'), ('badge', 'partner_id'), ('बैज', 'partner_id')
on conflict do nothing;

-- FAQ seed (29 answers from Sehatsandhi_Partner_FAQ_Seed.csv) follows.
insert into care_partner_faq (id, category, sort_order, keywords_en, keywords_hi, question_en, question_hi, answer_en, answer_hi, link_path) values
  ('about', 'Account & Support', 1, array['what is sehatsandhi','about','kya hai','sehatsandhi']::text[], array['सेहतसंधि क्या है','sehatsandhi kya hai','क्या है']::text[], 'What is Sehatsandhi?', 'सेहतसंधि क्या है?', 'Sehatsandhi is a healthcare platform that connects patients with doctors, labs, pharmacy and ambulance partners. As a Care Partner you introduce it to doctors and clinics. Start with Module 1: {{site}}/partner/learn', 'सेहतसंधि एक हेल्थकेयर प्लेटफ़ॉर्म है जो मरीज़ों को डॉक्टर, लैब, फ़ार्मेसी और एम्बुलेंस से जोड़ता है। केयर पार्टनर के रूप में आप इसे डॉक्टरों और क्लीनिकों तक पहुँचाते हैं। शुरुआत Module 1 से करें: {{site}}/partner/learn', '/partner/learn'),
  ('register', 'Account & Support', 2, array['register','sign up','join','how to start','kaise judu']::text[], array['रजिस्टर','जुड़ना','शुरू','कैसे जुड़ें','register kaise']::text[], 'How do I register as a partner?', 'पार्टनर के रूप में रजिस्टर कैसे करूँ?', 'Open the link, enter your mobile number, verify the OTP and fill in your details. Training and the exam are free. Register here: {{site}}/partner/register', 'लिंक खोलें, मोबाइल नंबर डालें, OTP से वेरिफ़ाई करें और अपनी जानकारी भरें। ट्रेनिंग और परीक्षा मुफ़्त हैं। यहाँ रजिस्टर करें: {{site}}/partner/register', '/partner/register'),
  ('fee', 'Fee & ID', 1, array['fee','fees','charge','cost','price','100','certification','kitni']::text[], array['फीस','फ़ीस','शुल्क','चार्ज','कितनी','100 रुपये','प्रमाणन']::text[], 'Is there a fee? How much?', 'क्या कोई फ़ीस है? कितनी?', 'Training and the exam are free. After you pass the exam there is a one-time Partner Certification Fee of Rs {{cert_fee}} (all taxes included) for your Partner ID and badge. It is non-refundable once the ID is issued. Details: {{site}}/partner/pay', 'ट्रेनिंग और परीक्षा मुफ़्त हैं। परीक्षा पास करने के बाद आपके पार्टनर ID और बैज के लिए एक बार ₹{{cert_fee}} (सभी टैक्स सहित) की पार्टनर सर्टिफ़िकेशन फ़ीस है। ID जारी होने के बाद यह वापस नहीं होती। विवरण: {{site}}/partner/pay', '/partner/pay'),
  ('partner_id', 'Fee & ID', 2, array['partner id','id','badge','when will i get id','certificate']::text[], array['पार्टनर आईडी','आईडी','बैज','आईडी कब मिलेगी','सर्टिफ़िकेट']::text[], 'When do I get my Partner ID?', 'मुझे पार्टनर ID कब मिलेगी?', 'You get your Partner ID after you pass the final exam and pay the certification fee. It appears on your dashboard with a badge. Accept the Partner Agreement to activate it: until then you cannot add doctors or earn rewards. {{site}}/partner/dashboard', 'फ़ाइनल परीक्षा पास करने और सर्टिफ़िकेशन फ़ीस भरने के बाद आपको पार्टनर ID मिलती है, जो डैशबोर्ड पर बैज के साथ दिखती है। उसे चालू करने के लिए पार्टनर एग्रीमेंट स्वीकार करें: तब तक आप डॉक्टर नहीं जोड़ सकते और रिवॉर्ड नहीं पा सकते। {{site}}/partner/dashboard', '/partner/dashboard'),
  ('quiz_pass', 'Training & Quiz', 1, array['pass mark','passing','score','how many marks','percent']::text[], array['पास मार्क्स','पासिंग','स्कोर','कितने नंबर','प्रतिशत']::text[], 'What is the pass mark?', 'पास होने के लिए कितने अंक चाहिए?', 'You need at least {{pass_mark}}% in each quiz and in the final exam. Questions come from the module videos and PDFs, so watch and read them first. {{site}}/partner/learn', 'हर क्विज़ और फ़ाइनल परीक्षा में कम से कम {{pass_mark}}% चाहिए। सवाल मॉड्यूल के वीडियो और PDF से आते हैं, इसलिए पहले उन्हें देखें और पढ़ें। {{site}}/partner/learn', '/partner/learn'),
  ('quiz_retake', 'Training & Quiz', 2, array['retake','fail','failed','again','retry','reattempt','quiz kab']::text[], array['दोबारा','फेल','रीटेक','फिर से','क्विज़ कब','दुबारा']::text[], 'When can I retake the quiz?', 'क्विज़ दोबारा कब दे सकता/सकती हूँ?', 'If you did not pass, you can retake after {{retake_hours}} hours. After 3 failed attempts the wait is 7 days. Use the time to re-watch the videos and re-read the PDFs. Your exact retake time is on the exam page: {{site}}/partner/exam', 'अगर आप पास नहीं हुए, तो {{retake_hours}} घंटे बाद दोबारा दे सकते हैं। 3 बार फ़ेल होने पर 7 दिन का इंतज़ार होगा। इस समय में वीडियो फिर से देखें और PDF फिर से पढ़ें। आपका सही समय परीक्षा पेज पर है: {{site}}/partner/exam', '/partner/exam'),
  ('video_not_done', 'Training & Quiz', 3, array['video not complete','not marked','quiz locked','not unlocked','video complete']::text[], array['वीडियो पूरा','क्विज़ लॉक','अनलॉक नहीं','कम्पलीट नहीं','वीडियो']::text[], 'My video is not marked complete or the quiz is locked', 'मेरा वीडियो पूरा नहीं दिख रहा या क्विज़ लॉक है', 'A module quiz unlocks after you watch at least 90% of the video and mark the PDF as read. Do not skip ahead, use the same login, and keep the page open until the video ends. If it still shows incomplete, open a ticket with the module name: {{site}}/partner/tickets', 'मॉड्यूल क्विज़ तब खुलता है जब आप वीडियो का कम से कम 90% देख लें और PDF पढ़ा हुआ मार्क कर दें। वीडियो आगे न बढ़ाएँ, उसी लॉगिन से देखें और वीडियो खत्म होने तक पेज खुला रखें। फिर भी पूरा न दिखे तो मॉड्यूल का नाम लिखकर टिकट खोलें: {{site}}/partner/tickets', '/partner/tickets'),
  ('agreement', 'Fee & ID', 3, array['agreement','contract','terms','policy','sign','code of conduct']::text[], array['एग्रीमेंट','अनुबंध','कॉन्ट्रैक्ट','नियम','शर्तें','साइन']::text[], 'Where can I read the agreement and policies?', 'एग्रीमेंट और पॉलिसी कहाँ पढ़ूँ?', 'All contracts and policies (Partner Agreement, Code of Conduct, Rewards Policy, Privacy) are on the learning page under Contracts & policies. You accept the agreement with an OTP before your ID becomes active. {{site}}/partner/learn', 'सभी अनुबंध और पॉलिसी (पार्टनर एग्रीमेंट, कोड ऑफ़ कंडक्ट, रिवॉर्ड पॉलिसी, प्राइवेसी) लर्निंग पेज पर Contracts & policies में हैं। आपकी ID सक्रिय होने से पहले आप OTP से एग्रीमेंट स्वीकार करते हैं। {{site}}/partner/learn', '/partner/learn'),
  ('rewards_how', 'Rewards & Payouts', 1, array['reward','rewards','commission','earn','earning','how much','income','percentage']::text[], array['रिवॉर्ड','कमीशन','कमाई','कितना मिलेगा','प्रतिशत','income']::text[], 'How do Partner Rewards work?', 'पार्टनर रिवॉर्ड कैसे काम करते हैं?', 'You earn a Start Reward on the 12-month payments of a business you introduced, during the first 12 months after the business confirms your referral, and a Renewal Reward on its renewals after that. The percentage depends on your level. Rewards apply to 12-month plans only, before GST. We cannot promise any amount of earnings. Details: {{site}}/partner/learn', 'आपके द्वारा जोड़े गए बिज़नेस के 12 महीने वाले भुगतान पर, उसके द्वारा आपके रेफ़रल की पुष्टि करने के बाद पहले 12 महीनों में आपको स्टार्ट रिवॉर्ड मिलता है, और उसके बाद हर नवीनीकरण पर रिन्यूअल रिवॉर्ड। प्रतिशत आपके लेवल पर निर्भर है। रिवॉर्ड केवल 12 महीने के प्लान पर, GST से पहले की राशि पर मिलते हैं। हम किसी कमाई की गारंटी नहीं दे सकते। विवरण: {{site}}/partner/learn', '/partner/learn'),
  ('reward_when', 'Rewards & Payouts', 2, array['when paid','payout','payment','paid','pending','approved','when will i get money']::text[], array['पेमेंट कब','भुगतान','पैसे कब','पेंडिंग','अप्रूव','payout']::text[], 'When will I get my reward payment?', 'मेरा रिवॉर्ड भुगतान कब आएगा?', 'A reward is first Pending. It becomes Approved after the doctor''s payment is settled and the {{reward_window_days}}-day refund window passes. Approved rewards are paid in the monthly payout once your KYC and agreement are complete and the total is at least Rs {{min_payout}}. Check status: {{site}}/partner/dashboard', 'रिवॉर्ड पहले Pending रहता है। डॉक्टर का भुगतान सेटल होने और {{reward_window_days}} दिन की रिफ़ंड अवधि बीतने पर वह Approved होता है। KYC और एग्रीमेंट पूरा होने और कुल राशि कम से कम ₹{{min_payout}} होने पर Approved रिवॉर्ड मासिक पेआउट में दिया जाता है। स्थिति देखें: {{site}}/partner/dashboard', '/partner/dashboard'),
  ('kyc', 'Rewards & Payouts', 3, array['kyc','pan','bank','verify','account','documents','aadhaar']::text[], array['केवाईसी','पैन','बैंक','खाता','दस्तावेज़','आधार','वेरिफाई']::text[], 'What KYC do I need?', 'मुझे कौन सा KYC करना होगा?', 'To receive payouts you give your PAN and your own bank account details when you first claim a payout. We check them and they must match your name. We do not collect or store your Aadhaar number. Never share OTPs or documents in the chat or with anyone. Add details here: {{site}}/partner/dashboard', 'पेआउट पाने के लिए आप पहली बार पेआउट लेते समय अपना PAN और अपने बैंक खाते की जानकारी देते हैं। हम उन्हें जाँचते हैं और नाम आपके नाम से मेल खाना चाहिए। हम आपका आधार नंबर न लेते हैं न रखते हैं। OTP या दस्तावेज़ कभी चैट में या किसी को न दें। जानकारी यहाँ दें: {{site}}/partner/dashboard', '/partner/dashboard'),
  ('tds', 'Rewards & Payouts', 4, array['tds','tax','gst','invoice','194h','income tax']::text[], array['टीडीएस','टैक्स','कर','जीएसटी','इनवॉइस']::text[], 'Is tax deducted from my rewards?', 'क्या मेरे रिवॉर्ड से टैक्स कटेगा?', 'Tax (TDS) may be deducted from payouts as required by law, and a statement for each payout is on your dashboard. For personal tax advice please consult your own CA. {{site}}/partner/dashboard', 'कानून के अनुसार पेआउट से TDS कट सकता है, और हर पेआउट का स्टेटमेंट आपके डैशबोर्ड पर है। अपने टैक्स के बारे में सलाह के लिए अपने CA से पूछें। {{site}}/partner/dashboard', '/partner/dashboard'),
  ('add_lead', 'Doctors & Leads', 1, array['add doctor','lead','claim doctor','lock','my doctor','how to add']::text[], array['डॉक्टर जोड़ें','लीड','क्लेम','लॉक','मेरा डॉक्टर']::text[], 'How do I register a doctor under my Partner ID?', 'डॉक्टर को अपने पार्टनर ID में कैसे जोड़ूँ?', 'In your dashboard, add the doctor''s name and phone number as a lead. This reserves the number for you for {{lead_lock_days}} days. Nothing is sent to the doctor. When the doctor signs up, the app asks them to confirm that you referred them. The doctor can also type your Partner ID at signup or payment. You can hold up to {{lead_cap_new}} leads at a time until your first closed doctor. {{site}}/partner/dashboard', 'अपने डैशबोर्ड में डॉक्टर का नाम और फ़ोन नंबर लीड के रूप में जोड़ें। इससे वह नंबर {{lead_lock_days}} दिन के लिए आपके नाम सुरक्षित हो जाता है। डॉक्टर को कोई मैसेज नहीं जाता। डॉक्टर के साइनअप करने पर ऐप उनसे पूछता है कि क्या आपने उन्हें रेफ़र किया। डॉक्टर साइनअप या भुगतान के समय आपकी पार्टनर ID भी डाल सकते हैं। पहला डॉक्टर जुड़ने तक आप एक समय में {{lead_cap_new}} लीड रख सकते हैं। {{site}}/partner/dashboard', '/partner/dashboard'),
  ('doctor_skipped', 'Doctors & Leads', 2, array['doctor paid','forgot id','no partner id','missed','not credited','credit']::text[], array['डॉक्टर ने भुगतान','आईडी भूल','क्रेडिट नहीं','नहीं मिला','छूट गया']::text[], 'The doctor paid without entering my Partner ID', 'डॉक्टर ने मेरी पार्टनर ID डाले बिना भुगतान कर दिया', 'If the doctor was reserved for you and confirms the referral in the app, credit is automatic. If not, open a ticket within {{claim_days}} days of payment with the doctor''s name and phone. We will credit you only after the doctor logs in and confirms your referral. {{site}}/partner/tickets', 'अगर डॉक्टर आपके नाम सुरक्षित था और उसने ऐप में रेफ़रल की पुष्टि की, तो क्रेडिट अपने-आप मिलता है। नहीं तो भुगतान के {{claim_days}} दिन के अंदर डॉक्टर का नाम और फ़ोन लिखकर टिकट खोलें। हम तभी क्रेडिट देंगे जब डॉक्टर लॉगिन करके आपके रेफ़रल की पुष्टि करेगा। {{site}}/partner/tickets', '/partner/tickets'),
  ('monthly', 'Doctors & Leads', 3, array['monthly','6 month','six month','half yearly','monthly plan']::text[], array['मासिक','महीने','6 महीने','छह महीने','मंथली']::text[], 'Do I get a reward on monthly or 6-month plans?', 'क्या मासिक या 6 महीने के प्लान पर रिवॉर्ड मिलता है?', 'No. Partner Rewards apply to 12-month plans only. A doctor can still choose a 1-month or 6-month plan, and then you earn no reward on it. If that doctor buys a 12-month plan within 90 days, you earn the Start Reward on that payment. The 12-month plan is the cheapest per month, so introduce that one. {{site}}/partner/learn', 'नहीं। पार्टनर रिवॉर्ड केवल 12 महीने के प्लान पर मिलते हैं। डॉक्टर 1 महीने या 6 महीने का प्लान भी चुन सकता है, तब आपको उस पर रिवॉर्ड नहीं मिलेगा। अगर वही डॉक्टर 90 दिन के अंदर 12 महीने का प्लान लेता है तो उस भुगतान पर आपको स्टार्ट रिवॉर्ड मिलेगा। 12 महीने का प्लान हर महीने के हिसाब से सबसे सस्ता है, इसलिए वही बताएँ। {{site}}/partner/learn', '/partner/learn'),
  ('refund', 'Rewards & Payouts', 5, array['refund','money back','reversed','clawback','cancel']::text[], array['रिफ़ंड','वापस','रिवर्स','कैंसिल','क्लॉबैक']::text[], 'What if the doctor asks for a refund?', 'अगर डॉक्टर रिफ़ंड माँगे तो?', 'If a doctor''s payment is refunded, the related reward is reversed. If it was already paid, the amount is adjusted from your future rewards. This is explained in the Rewards Policy. {{site}}/partner/learn', 'अगर डॉक्टर का भुगतान रिफ़ंड होता है तो उससे जुड़ा रिवॉर्ड रद्द हो जाता है। अगर वह पहले ही दिया जा चुका है तो राशि आपके आगे के रिवॉर्ड से समायोजित होती है। यह रिवॉर्ड पॉलिसी में समझाया गया है। {{site}}/partner/learn', '/partner/learn'),
  ('cash', 'Rules', 1, array['cash','take money','collect','upi','payment from doctor','pay you']::text[], array['कैश','नकद','पैसे लेना','यूपीआई','डॉक्टर से पैसे']::text[], 'Can I collect money from the doctor?', 'क्या मैं डॉक्टर से पैसे ले सकता/सकती हूँ?', 'No. Never take cash or any payment from a doctor. Doctors pay Sehatsandhi directly on the website. Taking money yourself is a breach of the agreement and can end your partnership. {{site}}/partner/learn', 'नहीं। डॉक्टर से कभी नकद या कोई भी भुगतान न लें। डॉक्टर सीधे वेबसाइट पर सेहतसंधि को भुगतान करते हैं। खुद पैसे लेना एग्रीमेंट का उल्लंघन है और इससे आपकी पार्टनरशिप खत्म हो सकती है। {{site}}/partner/learn', '/partner/learn'),
  ('official_whatsapp', 'Rules', 2, array['whatsapp','official number','message doctors','bulk','spam','broadcast']::text[], array['व्हाट्सएप','आधिकारिक नंबर','मैसेज','बल्क','स्पैम','ब्रॉडकास्ट']::text[], 'Can I message doctors from the Sehatsandhi WhatsApp number?', 'क्या मैं सेहतसंधि के WhatsApp नंबर से डॉक्टरों को मैसेज कर सकता/सकती हूँ?', 'No. Never use Sehatsandhi''s official number to contact doctors. Use your own number, send only to people who agree to hear from you, and do not send bulk or repeated messages. Doctors can block you. {{site}}/partner/learn', 'नहीं। डॉक्टरों से संपर्क के लिए सेहतसंधि का आधिकारिक नंबर कभी इस्तेमाल न करें। अपना नंबर इस्तेमाल करें, केवल उन्हीं को भेजें जो सुनना चाहते हैं, और बल्क या बार-बार मैसेज न भेजें। डॉक्टर आपको ब्लॉक कर सकते हैं। {{site}}/partner/learn', '/partner/learn'),
  ('claims', 'Rules', 3, array['what to say','claims','approved','government','abdm','guarantee','promise']::text[], array['क्या बोलें','दावे','सरकारी','एबीडीएम','गारंटी','वादा']::text[], 'What can I say about Sehatsandhi?', 'मैं सेहतसंधि के बारे में क्या कह सकता/सकती हूँ?', 'Say only what is in the training modules. Do not say Sehatsandhi is government approved or ABDM approved, and do not promise income, patients or results. Misrepresentation can lead to suspension. {{site}}/partner/learn', 'केवल वही कहें जो ट्रेनिंग मॉड्यूल में है। यह न कहें कि सेहतसंधि सरकार से मान्य या ABDM से अप्रूव्ड है, और आमदनी, मरीज़ या नतीजों का वादा न करें। गलत जानकारी देने पर सस्पेंशन हो सकता है। {{site}}/partner/learn', '/partner/learn'),
  ('patient_data', 'Rules', 4, array['patient data','patient','privacy','data','records','dpdp']::text[], array['मरीज़ का डेटा','मरीज','प्राइवेसी','डेटा','रिकॉर्ड']::text[], 'Can I see or collect patient data?', 'क्या मैं मरीज़ों का डेटा देख या ले सकता/सकती हूँ?', 'No. Partners never see or collect patient data. You only see the doctor''s name, specialty, city and plan status. Sharing any patient information is a serious breach. {{site}}/partner/learn', 'नहीं। पार्टनर कभी मरीज़ों का डेटा नहीं देखते या लेते। आपको केवल डॉक्टर का नाम, विशेषज्ञता, शहर और प्लान की स्थिति दिखती है। मरीज़ की कोई भी जानकारी साझा करना गंभीर उल्लंघन है। {{site}}/partner/learn', '/partner/learn'),
  ('recruit', 'Rules', 5, array['recruit','add partners','refer partner','team','network','downline']::text[], array['पार्टनर जोड़ना','टीम','नेटवर्क','रेफ़र पार्टनर']::text[], 'Can I earn by adding other partners?', 'क्या दूसरे पार्टनर जोड़कर कमाई हो सकती है?', 'No. Rewards are paid only on doctors you personally introduce who pay for a plan. There is no reward for adding other partners and no levels of partners above partners. {{site}}/partner/learn', 'नहीं। रिवॉर्ड केवल उन डॉक्टरों पर मिलता है जिन्हें आपने खुद जोड़ा और जिन्होंने प्लान का भुगतान किया। दूसरे पार्टनर जोड़ने पर कोई रिवॉर्ड नहीं है और पार्टनरों के ऊपर कोई पार्टनर लेवल नहीं हैं। {{site}}/partner/learn', '/partner/learn'),
  ('paused', 'Account & Support', 3, array['paused','suspended','blocked','terminated','strike','inactive']::text[], array['पॉज़','सस्पेंड','ब्लॉक','बंद','स्ट्राइक','निष्क्रिय']::text[], 'Why is my Partner ID paused or suspended?', 'मेरी पार्टनर ID पॉज़ या सस्पेंड क्यों है?', 'An ID can be paused if you have no first closed business within {{inactive_days}} days of getting your ID, if your yearly renewal has expired, or if a complaint is under review. You can reactivate by passing a refresher quiz. Open a ticket to find out the reason and next step. {{site}}/partner/tickets', 'ID इन कारणों से पॉज़ हो सकती है: ID मिलने के {{inactive_days}} दिन में पहला बिज़नेस न जुड़ना, सालाना नवीनीकरण की अवधि खत्म होना, या किसी शिकायत की जाँच। रिफ़्रेशर क्विज़ पास करके आप दोबारा चालू कर सकते हैं। कारण और अगला कदम जानने के लिए टिकट खोलें। {{site}}/partner/tickets', '/partner/tickets'),
  ('renewal', 'Fee & ID', 4, array['renew','renewal','validity','expire','expiry','1 year','annual']::text[], array['रिन्यू','नवीनीकरण','वैधता','खत्म','एक साल','सालाना']::text[], 'How long is my Partner ID valid? How do I renew?', 'मेरी पार्टनर ID कितने समय तक वैध है? रिन्यू कैसे करूँ?', 'Your Partner ID is valid for 12 months. To renew, pass a short refresher quiz and pay the renewal fee. We remind you before expiry. {{site}}/partner/dashboard', 'आपकी पार्टनर ID 12 महीने के लिए वैध है। रिन्यू करने के लिए एक छोटी रिफ़्रेशर क्विज़ पास करें और रिन्यूअल फ़ीस भरें। समाप्ति से पहले हम आपको याद दिलाएँगे। {{site}}/partner/dashboard', '/partner/dashboard'),
  ('verify_badge', 'Doctors & Leads', 4, array['verify','badge','qr','genuine','real partner','proof']::text[], array['वेरिफाई','बैज','क्यूआर','असली','प्रमाण']::text[], 'How can a doctor check that I am a real Sehatsandhi partner?', 'डॉक्टर कैसे जाँचें कि मैं असली सेहतसंधि पार्टनर हूँ?', 'Show your badge from the dashboard. The doctor can scan its QR code or open {{site}}/verify/<your Partner ID> to see your name, city and status. {{site}}/partner/dashboard', 'अपने डैशबोर्ड से बैज दिखाएँ। डॉक्टर उसका QR कोड स्कैन कर सकते हैं या {{site}}/verify/<आपकी पार्टनर ID> खोलकर आपका नाम, शहर और स्थिति देख सकते हैं। {{site}}/partner/dashboard', '/partner/dashboard'),
  ('call', 'Account & Support', 4, array['call','phone','number','talk','speak','contact','helpline','whatsapp number']::text[], array['कॉल','फ़ोन','नंबर','बात','संपर्क','हेल्पलाइन']::text[], 'Can I call someone for help?', 'क्या मैं मदद के लिए कॉल कर सकता/सकती हूँ?', 'We do not provide phone support for the Partner Program. Please use the chat on this page, the Help Center ({{site}}/partner/help) or open a ticket ({{site}}/partner/tickets). If the chat cannot answer, email contact@sehatsandhi.com. We reply within {{ticket_sla_hours}} hours.', 'पार्टनर प्रोग्राम के लिए हम फ़ोन सपोर्ट नहीं देते। कृपया इस पेज की चैट, हेल्प सेंटर ({{site}}/partner/help) या टिकट ({{site}}/partner/tickets) का उपयोग करें। चैट जवाब न दे सके तो contact@sehatsandhi.com पर ईमेल करें। हम {{ticket_sla_hours}} घंटे में जवाब देते हैं।', '/partner/help'),
  ('ticket', 'Account & Support', 5, array['ticket','complaint','issue','problem','support','help','raise']::text[], array['टिकट','शिकायत','समस्या','सहायता','मदद','दिक्कत']::text[], 'How do I open a ticket?', 'टिकट कैसे खोलूँ?', 'Log in, go to Tickets, choose a category (Training, Payment, Lead dispute, Technical, Complaint), describe the problem and submit. If your question is not answered by the chat on this page, email contact@sehatsandhi.com. We reply within {{ticket_sla_hours}} hours. {{site}}/partner/tickets', 'लॉगिन करें, Tickets में जाएँ, श्रेणी चुनें (ट्रेनिंग, भुगतान, लीड विवाद, तकनीकी, शिकायत), समस्या लिखें और सबमिट करें। अगर इस पेज की चैट से जवाब न मिले तो contact@sehatsandhi.com पर ईमेल करें। हम {{ticket_sla_hours}} घंटे में जवाब देते हैं। {{site}}/partner/tickets', '/partner/tickets'),
  ('language', 'Account & Support', 6, array['language','hindi','english','change language']::text[], array['भाषा','हिंदी','अंग्रेज़ी','भाषा बदलें','english me']::text[], 'How do I change the language?', 'भाषा कैसे बदलूँ?', 'Use the language toggle on the website, or just write to the chat in your language. PDFs and quizzes are available in both languages. {{site}}/partner/learn', 'वेबसाइट पर भाषा बटन इस्तेमाल करें, या चैट में अपनी भाषा में लिखें। PDF और क्विज़ दोनों भाषाओं में उपलब्ध हैं। {{site}}/partner/learn', '/partner/learn'),
  ('lock_fail', 'Doctors & Leads', 5, array['can''t lock','cannot lock','lock failed','number not accepted','already registered']::text[], array['लॉक नहीं','नंबर नहीं','पहले से रजिस्टर','लॉक फेल']::text[], 'Why can''t I lock a doctor''s number?', 'मैं डॉक्टर का नंबर लॉक क्यों नहीं कर पा रहा/रही?', 'Some numbers cannot be reserved, for example numbers that are already linked to Sehatsandhi, or numbers reserved by another partner. We do not share the reason. Try another doctor, or check your open leads. If you think this is a mistake, open a ticket. {{site}}/partner/tickets', 'कुछ नंबर रिज़र्व नहीं किए जा सकते, जैसे जो पहले से सेहतसंधि से जुड़े हों या किसी दूसरे पार्टनर के नाम सुरक्षित हों। हम कारण साझा नहीं करते। किसी दूसरे डॉक्टर को आज़माएँ या अपनी खुली लीड देखें। गलती लगे तो टिकट खोलें। {{site}}/partner/tickets', '/partner/tickets'),
  ('lead_cap', 'Doctors & Leads', 6, array['lead limit','cap','how many leads','maximum doctors','limit']::text[], array['लीड सीमा','कितने लीड','अधिकतम','लिमिट','कितने डॉक्टर']::text[], 'How many doctors can I reserve at once?', 'मैं एक समय में कितने डॉक्टर रिज़र्व कर सकता/सकती हूँ?', 'Until your first closed business you can hold up to {{lead_cap_new}} reserved doctors at a time. A reservation ends after {{lead_lock_days}} days or when you release it, which frees a slot. After you close a business, your limit goes up. {{site}}/partner/dashboard', 'पहला बिज़नेस जुड़ने तक आप एक समय में {{lead_cap_new}} रिज़र्व डॉक्टर रख सकते हैं। रिज़र्वेशन {{lead_lock_days}} दिन बाद या आपके छोड़ने पर खत्म होता है, जिससे जगह खाली होती है। बिज़नेस जुड़ने के बाद आपकी सीमा बढ़ जाती है। {{site}}/partner/dashboard', '/partner/dashboard')
on conflict (id) do nothing;

notify pgrst, 'reload schema';
