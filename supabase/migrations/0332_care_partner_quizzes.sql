-- ============================================================================
-- 0332 — Care Partner Program, Phase 2: module quizzes and the final exam
-- ============================================================================
-- AFTER 0331. Safe to re-run. Plan: docs/2026-11-partner-program-plan.md
--
-- Brief §4.4:
--   • A module's quiz opens once its video and PDF are done; the final exam once
--     every published module's quiz is passed. Passing the final moves the
--     partner to 'quiz_passed'.
--   • Each attempt draws N random questions (partner_module_questions, 5;
--     partner_final_questions, 15) and shuffles their options.
--   • Graded here, never in the browser: care_partner_questions.correct is not
--     readable by partners at all; the attempt shows questions without it.
--   • Pass mark partner_pass_mark (80%). After a fail the next attempt waits
--     partner_retake_hours (48); after every partner_fail_lock_after-th fail
--     (3) it waits partner_fail_lock_days (7).
--   • An attempt left open past partner_attempt_minutes (60) counts as a fail,
--     so nobody can look at the questions, walk away and draw fresh ones.
--   • On a pass: every question with the right answer and the explanation.
--     On a fail: the score and the topics to revise — never the answers.
--
-- Also (found in Phase 1): anon gets a refusal, not an empty result, on the
-- partner tables; the synonym 'paisa' means payout, not fee.
-- ============================================================================

insert into site_settings (key, value) values
  ('partner_attempt_minutes', '60'),
  ('partner_fail_lock_after', '3'),
  ('partner_fail_lock_days', '7')
on conflict (key) do nothing;

revoke all on care_partners, care_partner_progress, care_partner_modules, care_partner_contracts from anon;
update care_partner_faq_synonyms set canonical = 'payout' where term = 'paisa' and canonical = 'fee';

-- ── Question bank ───────────────────────────────────────────────────────────
create table if not exists care_partner_questions (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid references care_partner_modules(id) on delete cascade,   -- null = final exam only
  qtype       text not null check (qtype in ('single', 'multi', 'truefalse')),
  text_en     text not null, text_hi text not null,
  options     jsonb not null,          -- [{id, text_en, text_hi}], 2–6 options
  correct     jsonb not null,          -- [option id, …] — never readable by partners
  explain_en  text, explain_hi text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  check (jsonb_typeof(correct) = 'array' and jsonb_array_length(correct) >= 1)
);
create index if not exists care_partner_questions_module_idx on care_partner_questions (module_id) where is_active;
alter table care_partner_questions enable row level security;
revoke all on care_partner_questions from anon;
drop policy if exists care_partner_questions_admin on care_partner_questions;
create policy care_partner_questions_admin on care_partner_questions for select to authenticated using (sehat_is_admin());

-- ── Attempts ────────────────────────────────────────────────────────────────
create table if not exists care_partner_attempts (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references care_partners(id) on delete cascade,
  module_id       uuid references care_partner_modules(id) on delete set null,
  kind            text not null check (kind in ('module', 'final', 'refresher')),
  question_ids    uuid[] not null,
  option_orders   jsonb not null,       -- {question id: [option ids in the order shown]}
  answers         jsonb,                -- {question id: [chosen option ids]}
  correct_count   integer,
  score_pct       numeric(5,2),
  passed          boolean,
  abandoned       boolean not null default false,
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  submitted_at    timestamptz,
  next_allowed_at timestamptz
);
create index if not exists care_partner_attempts_partner_idx on care_partner_attempts (partner_id, kind, module_id, started_at desc);
alter table care_partner_attempts enable row level security;
revoke all on care_partner_attempts from anon;
drop policy if exists care_partner_attempts_read on care_partner_attempts;
create policy care_partner_attempts_read on care_partner_attempts for select to authenticated
  using (sehat_is_admin() or exists (select 1 from care_partners p where p.id = partner_id and p.user_id = auth.uid()));

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- When may this partner next try this quiz? Closes any attempt left open too long (as a fail).
create or replace function sehat_care_quiz_wait(p_partner uuid, p_kind text, p_module uuid)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare a care_partner_attempts; v_fails int; v_last care_partner_attempts;
        v_hours int := sehat_care_setting_int('retake_hours', 48);
        v_after int := sehat_care_setting_int('fail_lock_after', 3);
        v_days int := sehat_care_setting_int('fail_lock_days', 7);
begin
  for a in select * from care_partner_attempts
            where partner_id = p_partner and kind = p_kind and module_id is not distinct from p_module
              and submitted_at is null and expires_at < now() for update loop
    select count(*) + 1 into v_fails from care_partner_attempts
     where partner_id = p_partner and kind = p_kind and module_id is not distinct from p_module and passed = false;
    update care_partner_attempts set submitted_at = expires_at, passed = false, abandoned = true, correct_count = 0, score_pct = 0,
           next_allowed_at = expires_at + case when v_after > 0 and v_fails % v_after = 0 then make_interval(days => v_days) else make_interval(hours => v_hours) end
     where id = a.id;
  end loop;
  select * into v_last from care_partner_attempts
   where partner_id = p_partner and kind = p_kind and module_id is not distinct from p_module and submitted_at is not null
   order by submitted_at desc limit 1;
  if v_last.id is not null and v_last.passed = false and v_last.next_allowed_at > now() then return v_last.next_allowed_at; end if;
  return null;
end $$;
revoke all on function sehat_care_quiz_wait(uuid, text, uuid) from public, anon, authenticated;

-- An attempt as the partner sees it: questions, options in their shuffled order, no answers.
create or replace function sehat_care_attempt_view(a care_partner_attempts)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'attempt_id', a.id, 'kind', a.kind, 'module_id', a.module_id, 'expires_at', a.expires_at,
    'questions', coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'qtype', q.qtype, 'text_en', q.text_en, 'text_hi', q.text_hi,
        'options', (select jsonb_agg(o order by array_position(array(select jsonb_array_elements_text(a.option_orders -> q.id::text)), o->>'id'))
                      from jsonb_array_elements(q.options) o))
      order by array_position(a.question_ids, q.id)), '[]'::jsonb))
  from care_partner_questions q where q.id = any(a.question_ids)
$$;
revoke all on function sehat_care_attempt_view(care_partner_attempts) from public, anon, authenticated;

-- ── Start (or resume) an attempt ────────────────────────────────────────────
-- p_module null = the final exam.
create or replace function sehat_care_quiz_start(p_module uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; m care_partner_modules; pr care_partner_progress; a care_partner_attempts;
        v_kind text := case when p_module is null then 'final' else 'module' end;
        v_n int; v_wait timestamptz; v_ids uuid[]; v_orders jsonb := '{}'::jsonb; q record;
begin
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  if p.status in ('paused', 'suspended', 'terminated') then raise exception 'Your account cannot do this right now.' using errcode = 'P0001'; end if;

  if v_kind = 'module' then
    select * into m from care_partner_modules where id = p_module and is_published;
    if m.id is null then raise exception 'No such module.' using errcode = 'P0002'; end if;
    select * into pr from care_partner_progress where partner_id = p.id and module_id = m.id;
    if pr.video_completed_at is null or pr.doc_read_at is null then
      raise exception 'Watch the video and read the PDF first.' using errcode = 'P0001';
    end if;
    if pr.quiz_passed_at is not null then raise exception 'You have already passed this quiz.' using errcode = 'P0001'; end if;
    v_n := sehat_care_setting_int('module_questions', 5);
  else
    if p.status not in ('registered', 'learning') then raise exception 'You have already passed the final exam.' using errcode = 'P0001'; end if;
    if not exists (select 1 from care_partner_modules where is_published)
       or exists (select 1 from care_partner_modules mm left join care_partner_progress x on x.module_id = mm.id and x.partner_id = p.id
                   where mm.is_published and x.quiz_passed_at is null) then
      raise exception 'Pass every module quiz first.' using errcode = 'P0001';
    end if;
    v_n := sehat_care_setting_int('final_questions', 15);
  end if;

  v_wait := sehat_care_quiz_wait(p.id, v_kind, p_module);
  if v_wait is not null then
    raise exception 'You can try again after %.', to_char(v_wait at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') using errcode = 'P0001';
  end if;

  -- An attempt already open: the same questions again, never a fresh draw.
  select * into a from care_partner_attempts
   where partner_id = p.id and kind = v_kind and module_id is not distinct from p_module and submitted_at is null and expires_at > now()
   order by started_at desc limit 1;
  if a.id is not null then return sehat_care_attempt_view(a); end if;

  -- The module's own bank; the final draws from every published module plus final-only questions.
  select array_agg(id) into v_ids from (
    select qq.id from care_partner_questions qq
     where qq.is_active and (case when v_kind = 'module' then qq.module_id = p_module
                                  else qq.module_id is null or qq.module_id in (select id from care_partner_modules where is_published) end)
     order by random() limit v_n) s;
  if v_ids is null then raise exception 'This quiz has no questions yet.' using errcode = 'P0001'; end if;
  for q in select id, options from care_partner_questions where id = any(v_ids) loop
    v_orders := v_orders || jsonb_build_object(q.id::text,
      (select jsonb_agg(o->>'id' order by random()) from jsonb_array_elements(q.options) o));
  end loop;
  insert into care_partner_attempts (partner_id, module_id, kind, question_ids, option_orders, expires_at)
  values (p.id, p_module, v_kind, v_ids, v_orders, now() + make_interval(mins => sehat_care_setting_int('attempt_minutes', 60)))
  returning * into a;
  if p.status = 'registered' then perform sehat_care_set_status(p.id, 'learning'); end if;
  return sehat_care_attempt_view(a);
end $$;
revoke all on function sehat_care_quiz_start(uuid) from public, anon;
grant execute on function sehat_care_quiz_start(uuid) to authenticated;

-- ── Submit and grade ────────────────────────────────────────────────────────
-- p_answers: {question id: [option id, …]}. A question is right only when the
-- chosen set equals the correct set exactly.
create or replace function sehat_care_quiz_submit(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; a care_partner_attempts; v_right int := 0; v_total int; v_pct numeric; v_pass boolean; v_fails int;
        v_next timestamptz; v_review jsonb; v_topics jsonb; q record;
        v_hours int := sehat_care_setting_int('retake_hours', 48);
        v_after int := sehat_care_setting_int('fail_lock_after', 3);
        v_days int := sehat_care_setting_int('fail_lock_days', 7);
begin
  p := sehat_care_me_row();
  select * into a from care_partner_attempts where id = p_attempt for update;
  if a.id is null or p.id is null or a.partner_id <> p.id then raise exception 'No such attempt.' using errcode = 'P0002'; end if;
  if a.submitted_at is not null then raise exception 'This attempt is already submitted.' using errcode = 'P0001'; end if;
  if a.expires_at < now() then
    perform sehat_care_quiz_wait(p.id, a.kind, a.module_id);
    raise exception 'Time is up for this attempt. It counts as not passed.' using errcode = 'P0001';
  end if;

  v_total := coalesce(array_length(a.question_ids, 1), 0);
  for q in select id, correct from care_partner_questions where id = any(a.question_ids) loop
    if (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(coalesce(p_answers -> q.id::text, '[]'::jsonb)) x)
       = (select array_agg(x order by x) from jsonb_array_elements_text(q.correct) x) then
      v_right := v_right + 1;
    end if;
  end loop;
  v_pct := round(100.0 * v_right / greatest(v_total, 1), 2);
  v_pass := v_pct >= sehat_care_setting_int('pass_mark', 80);

  if not v_pass then
    select count(*) + 1 into v_fails from care_partner_attempts
     where partner_id = p.id and kind = a.kind and module_id is not distinct from a.module_id and passed = false;
    v_next := now() + case when v_after > 0 and v_fails % v_after = 0 then make_interval(days => v_days) else make_interval(hours => v_hours) end;
  end if;
  update care_partner_attempts set answers = coalesce(p_answers, '{}'::jsonb), correct_count = v_right, score_pct = v_pct,
         passed = v_pass, submitted_at = now(), next_allowed_at = v_next
   where id = a.id;

  if v_pass and a.kind = 'module' then
    update care_partner_progress set quiz_passed_at = coalesce(quiz_passed_at, now()), updated_at = now()
     where partner_id = p.id and module_id = a.module_id;
  elsif v_pass and a.kind = 'final' and p.status in ('registered', 'learning') then
    perform sehat_care_set_status(p.id, 'quiz_passed');
  end if;

  if v_pass then
    -- Every question, the right answer and why.
    select jsonb_agg(jsonb_build_object('id', q2.id, 'text_en', q2.text_en, 'text_hi', q2.text_hi, 'options', q2.options,
             'correct', q2.correct, 'chosen', coalesce(p_answers -> q2.id::text, '[]'::jsonb),
             'explain_en', q2.explain_en, 'explain_hi', q2.explain_hi) order by array_position(a.question_ids, q2.id))
      into v_review from care_partner_questions q2 where q2.id = any(a.question_ids);
  else
    -- Only the topics to revise: the modules the wrong answers came from.
    select coalesce(jsonb_agg(distinct jsonb_build_object('slug', m.slug, 'title_en', m.title_en, 'title_hi', m.title_hi)), '[]'::jsonb)
      into v_topics
      from care_partner_questions q3 join care_partner_modules m on m.id = coalesce(q3.module_id, a.module_id)
     where q3.id = any(a.question_ids)
       and (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(coalesce(p_answers -> q3.id::text, '[]'::jsonb)) x)
           is distinct from (select array_agg(x order by x) from jsonb_array_elements_text(q3.correct) x);
  end if;
  return jsonb_build_object('passed', v_pass, 'score_pct', v_pct, 'correct', v_right, 'total', v_total,
                            'pass_mark', sehat_care_setting_int('pass_mark', 80), 'next_allowed_at', v_next,
                            'review', v_review, 'revise', v_topics, 'kind', a.kind);
end $$;
revoke all on function sehat_care_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function sehat_care_quiz_submit(uuid, jsonb) to authenticated;

-- The partner's quiz state per module and for the final: passed, waiting until, open attempt.
create or replace function sehat_care_quiz_state()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; v jsonb := '{}'::jsonb; m record; v_wait timestamptz;
begin
  p := sehat_care_me_row();
  if p.id is null then return v; end if;
  for m in select mm.id from care_partner_modules mm where mm.is_published loop
    v_wait := sehat_care_quiz_wait(p.id, 'module', m.id);
    v := v || jsonb_build_object(m.id::text, jsonb_build_object('wait_until', v_wait,
           'open', exists (select 1 from care_partner_attempts where partner_id = p.id and module_id = m.id and kind = 'module' and submitted_at is null and expires_at > now())));
  end loop;
  v_wait := sehat_care_quiz_wait(p.id, 'final', null);
  return v || jsonb_build_object('final', jsonb_build_object('wait_until', v_wait, 'passed', p.status not in ('registered', 'learning'),
           'open', exists (select 1 from care_partner_attempts where partner_id = p.id and kind = 'final' and submitted_at is null and expires_at > now())));
end $$;
revoke all on function sehat_care_quiz_state() from public, anon;
grant execute on function sehat_care_quiz_state() to authenticated;

-- ── What to do next, now with quizzes ───────────────────────────────────────
create or replace function sehat_care_next_step(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_done int; v_next care_partner_modules; v_np care_partner_progress;
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
  if p.status = 'quiz_passed' then
    return jsonb_build_object('key', 'pay', 'path', '/partner/learn',
      'en', 'You passed the final exam. The certification step opens soon.', 'hi', 'आपने फ़ाइनल परीक्षा पास कर ली। सर्टिफ़िकेशन का कदम जल्द खुलेगा।');
  end if;
  select count(*), count(*) filter (where pr.quiz_passed_at is not null) into v_total, v_done
    from care_partner_modules m left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
   where m.is_published;
  if p.status in ('registered', 'learning') then
    select m.* into v_next from care_partner_modules m
      left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
     where m.is_published and pr.quiz_passed_at is null
     order by m.sort_order limit 1;
    if v_next.id is not null then
      select * into v_np from care_partner_progress where partner_id = p.id and module_id = v_next.id;
      if v_np.video_completed_at is not null and v_np.doc_read_at is not null then
        return jsonb_build_object('key', 'module_quiz', 'path', '/partner/quiz/' || v_next.slug, 'done', v_done, 'total', v_total,
          'en', format('Next: the quiz for "%s".', v_next.title_en), 'hi', format('अगला: "%s" का क्विज़।', v_next.title_hi));
      end if;
      return jsonb_build_object('key', 'module', 'path', '/partner/learn#' || v_next.slug, 'done', v_done, 'total', v_total,
        'en', format('Next: %s — watch the video and read the PDF.', v_next.title_en),
        'hi', format('अगला: %s — वीडियो देखें और PDF पढ़ें।', v_next.title_hi));
    end if;
    if v_total > 0 then
      return jsonb_build_object('key', 'final', 'path', '/partner/exam', 'done', v_done, 'total', v_total,
        'en', 'All modules done. Take the final exam.', 'hi', 'सभी मॉड्यूल पूरे। फ़ाइनल परीक्षा दें।');
    end if;
    return jsonb_build_object('key', 'waiting', 'path', '/partner/learn',
      'en', 'The modules are being prepared. Please check back soon.', 'hi', 'मॉड्यूल तैयार हो रहे हैं। कृपया जल्द फिर देखें।');
  end if;
  return jsonb_build_object('key', p.status, 'path', '/partner/learn',
    'en', 'Keep going — the next steps open soon.', 'hi', 'आगे बढ़ते रहें — अगले कदम जल्द खुलेंगे।');
end $$;
revoke all on function sehat_care_next_step(care_partners) from public, anon, authenticated;

-- ── Admin ───────────────────────────────────────────────────────────────────
create or replace function sehat_admin_care_question_save(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_opts jsonb := coalesce(p->'options', '[]'::jsonb);
        v_correct jsonb := coalesce(p->'correct', '[]'::jsonb); v_type text := p->>'qtype'; v_module uuid := nullif(p->>'module_id', '')::uuid;
begin
  perform sehat_care_admin_only();
  if v_type not in ('single', 'multi', 'truefalse') then raise exception 'Type is single, multi or truefalse.' using errcode = '22023'; end if;
  if btrim(coalesce(p->>'text_en', '')) = '' or btrim(coalesce(p->>'text_hi', '')) = '' then
    raise exception 'The question is needed in both languages.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) not between 2 and 6
     or exists (select 1 from jsonb_array_elements(v_opts) o where btrim(coalesce(o->>'id', '')) = '' or btrim(coalesce(o->>'text_en', '')) = '' or btrim(coalesce(o->>'text_hi', '')) = '')
     or (select count(distinct o->>'id') from jsonb_array_elements(v_opts) o) <> jsonb_array_length(v_opts) then
    raise exception 'Give 2–6 options, each with an id and text in both languages.' using errcode = '22023';
  end if;
  if v_type = 'truefalse' and jsonb_array_length(v_opts) <> 2 then raise exception 'True/false has exactly two options.' using errcode = '22023'; end if;
  if jsonb_typeof(v_correct) <> 'array' or jsonb_array_length(v_correct) = 0
     or exists (select 1 from jsonb_array_elements_text(v_correct) c where c not in (select o->>'id' from jsonb_array_elements(v_opts) o)) then
    raise exception 'Mark the correct option(s).' using errcode = '22023';
  end if;
  if v_type in ('single', 'truefalse') and jsonb_array_length(v_correct) <> 1 then raise exception 'This type has exactly one correct option.' using errcode = '22023'; end if;
  if v_module is not null and not exists (select 1 from care_partner_modules where id = v_module) then raise exception 'No such module.' using errcode = 'P0002'; end if;

  if v_id is null then
    insert into care_partner_questions (module_id, qtype, text_en, text_hi, options, correct, explain_en, explain_hi, is_active)
    values (v_module, v_type, btrim(p->>'text_en'), btrim(p->>'text_hi'), v_opts, v_correct,
            nullif(btrim(coalesce(p->>'explain_en', '')), ''), nullif(btrim(coalesce(p->>'explain_hi', '')), ''), coalesce((p->>'is_active')::boolean, true))
    returning id into v_id;
  else
    update care_partner_questions set module_id = v_module, qtype = v_type, text_en = btrim(p->>'text_en'), text_hi = btrim(p->>'text_hi'),
           options = v_opts, correct = v_correct, explain_en = nullif(btrim(coalesce(p->>'explain_en', '')), ''),
           explain_hi = nullif(btrim(coalesce(p->>'explain_hi', '')), ''), is_active = coalesce((p->>'is_active')::boolean, true), updated_at = now()
     where id = v_id;
    if not found then raise exception 'No such question.' using errcode = 'P0002'; end if;
  end if;
  perform sehat_log_staff_action('care_question_save', 'care_question', v_id, left(p->>'text_en', 80), null);
  return v_id;
end $$;
revoke all on function sehat_admin_care_question_save(jsonb) from public, anon;
grant execute on function sehat_admin_care_question_save(jsonb) to authenticated;

-- Publishing a module now also needs enough active questions for one quiz.
create or replace function sehat_admin_care_module_save(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
        yt_hi text := nullif(btrim(coalesce(p->>'youtube_id_hi', '')), '');
        yt_en text := nullif(btrim(coalesce(p->>'youtube_id_en', '')), '');
        v_pub boolean := coalesce((p->>'is_published')::boolean, false);
        v_need int := sehat_care_setting_int('module_questions', 5);
begin
  perform sehat_care_admin_only();
  yt_hi := coalesce(substring(yt_hi from '(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})'), yt_hi);
  yt_en := coalesce(substring(yt_en from '(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})'), yt_en);
  if btrim(coalesce(p->>'title_en', '')) = '' or btrim(coalesce(p->>'title_hi', '')) = '' then
    raise exception 'Both titles are needed.' using errcode = '22023';
  end if;
  if v_pub and (coalesce(yt_hi, yt_en) is null or coalesce(nullif(p->>'pdf_path_hi', ''), nullif(p->>'pdf_path_en', '')) is null) then
    raise exception 'A module needs a video and a PDF before it can be published.' using errcode = 'P0001';
  end if;
  if v_pub and (v_id is null or (select count(*) from care_partner_questions where module_id = v_id and is_active) < v_need) then
    raise exception 'A module needs at least % active quiz questions before it can be published.', v_need using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into care_partner_modules (sort_order, slug, title_hi, title_en, desc_hi, desc_en, youtube_id_hi, youtube_id_en,
                              video_seconds, pdf_path_hi, pdf_path_en, est_minutes, is_published)
    values (coalesce(nullif(p->>'sort_order', '')::int, (select coalesce(max(sort_order), 0) + 10 from care_partner_modules)),
            p->>'slug', btrim(p->>'title_hi'), btrim(p->>'title_en'), p->>'desc_hi', p->>'desc_en', yt_hi, yt_en,
            nullif(p->>'video_seconds', '')::int, nullif(p->>'pdf_path_hi', ''), nullif(p->>'pdf_path_en', ''),
            nullif(p->>'est_minutes', '')::int, false)
    returning id into v_id;
  else
    update care_partner_modules set sort_order = coalesce(nullif(p->>'sort_order', '')::int, sort_order),
           title_hi = btrim(p->>'title_hi'), title_en = btrim(p->>'title_en'), desc_hi = p->>'desc_hi', desc_en = p->>'desc_en',
           youtube_id_hi = yt_hi, youtube_id_en = yt_en, video_seconds = nullif(p->>'video_seconds', '')::int,
           pdf_path_hi = nullif(p->>'pdf_path_hi', ''), pdf_path_en = nullif(p->>'pdf_path_en', ''),
           est_minutes = nullif(p->>'est_minutes', '')::int, is_published = v_pub, updated_at = now()
     where id = v_id;
    if not found then raise exception 'No such module.' using errcode = 'P0002'; end if;
  end if;
  perform sehat_log_staff_action('care_module_save', 'care_module', v_id, p->>'title_en', p - 'desc_hi' - 'desc_en');
  return v_id;
end $$;
revoke all on function sehat_admin_care_module_save(jsonb) from public, anon;
grant execute on function sehat_admin_care_module_save(jsonb) to authenticated;

-- Progress in the admin list now counts a module done when its quiz is passed.
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
             where pr.partner_id = p.id and m.is_published and pr.quiz_passed_at is not null),
           (select count(*)::int from care_partner_modules m where m.is_published)
      from care_partners p
     where p_status is null or p.status = p_status
     order by p.created_at desc
     limit 1000;
end $$;
revoke all on function sehat_admin_care_partners(text) from public, anon;
grant execute on function sehat_admin_care_partners(text) to authenticated;

notify pgrst, 'reload schema';
