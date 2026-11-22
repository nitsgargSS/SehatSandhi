-- ============================================================================
-- 0341 — Care Partner Program: read every module, then ONE exam
-- ============================================================================
-- AFTER 0340. Safe to re-run.
--
-- Nitin, 22 Nov 2026: "we are not giving quiz one by one, make it like an
-- exam: once the partner completes all modules, it opens for all modules" —
-- and every question is choose-one from 4 options (no written answers).
--
--   partner_module_quizzes   'off' (default now): no quiz per module. A module
--                            is done when it is read (and its video watched,
--                            where it has one — sehat_care_module_ready, 0336).
--                            'on' brings back the old per-module quizzes.
--   Final exam               opens when every published module is done. It
--                            draws partner_exam_per_module (2) questions from
--                            EVERY published module, shuffled.
--   Rules modules            care_partner_modules.is_rules (dos and don'ts,
--                            ethics, communication, code of conduct): the exam
--                            is passed only with the pass mark AND every
--                            question from these modules right.
--   Question kind            new and edited questions are 'single' only
--                            (4 options, one right) — the training content was
--                            rewritten to match.
-- ============================================================================

insert into site_settings (key, value) values
  ('partner_module_quizzes', 'off'),
  ('partner_exam_per_module', '2')
on conflict (key) do nothing;

alter table care_partner_modules add column if not exists is_rules boolean not null default false;
update care_partner_modules set is_rules = true
 where slug in ('dos-and-donts', 'ethics-and-privacy', 'communication-rules', 'code-of-conduct') and not is_rules;

create or replace function sehat_care_module_quizzes_on()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value from site_settings where key = 'partner_module_quizzes'), 'off') = 'on'
$$;
revoke all on function sehat_care_module_quizzes_on() from public, anon, authenticated;

-- Is this module done for this partner? Read (and video) — or, with module quizzes on, its quiz passed.
create or replace function sehat_care_module_done(m care_partner_modules, pr care_partner_progress)
returns boolean language sql stable security definer set search_path = public as $$
  select case when sehat_care_module_quizzes_on() then pr.quiz_passed_at is not null
              else coalesce(sehat_care_module_ready(m, pr), false) end
$$;
revoke all on function sehat_care_module_done(care_partner_modules, care_partner_progress) from public, anon, authenticated;

create or replace function sehat_care_all_modules_done(p_partner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from care_partner_modules where is_published)
     and not exists (select 1 from care_partner_modules m
                       left join care_partner_progress x on x.module_id = m.id and x.partner_id = p_partner
                      where m.is_published and not coalesce(sehat_care_module_done(m, x), false))
$$;
revoke all on function sehat_care_all_modules_done(uuid) from public, anon, authenticated;

-- ── Quiz start: module quizzes only when switched on; the exam per module ───
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
    if not sehat_care_module_quizzes_on() then
      raise exception 'There is no quiz for each module. Read every module, then take the final exam.' using errcode = 'P0001';
    end if;
    select * into m from care_partner_modules where id = p_module and is_published;
    if m.id is null then raise exception 'No such module.' using errcode = 'P0002'; end if;
    select * into pr from care_partner_progress where partner_id = p.id and module_id = m.id;
    if not coalesce(sehat_care_module_ready(m, pr), false) then
      raise exception '%', case when coalesce(m.youtube_id_hi, m.youtube_id_en) is null then 'Read the PDF first.'
                                else 'Watch the video and read the PDF first.' end using errcode = 'P0001';
    end if;
    if pr.quiz_passed_at is not null then raise exception 'You have already passed this quiz.' using errcode = 'P0001'; end if;
    v_n := sehat_care_setting_int('module_questions', 5);
  else
    if p.status not in ('registered', 'learning') then raise exception 'You have already passed the final exam.' using errcode = 'P0001'; end if;
    if not sehat_care_all_modules_done(p.id) then
      raise exception '%', case when sehat_care_module_quizzes_on() then 'Pass every module quiz first.'
                                else 'Read every module first — the exam opens when all are done.' end using errcode = 'P0001';
    end if;
  end if;

  v_wait := sehat_care_quiz_wait(p.id, v_kind, p_module);
  if v_wait is not null then
    raise exception 'You can try again after %.', to_char(v_wait at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') using errcode = 'P0001';
  end if;

  select * into a from care_partner_attempts
   where partner_id = p.id and kind = v_kind and module_id is not distinct from p_module and submitted_at is null and expires_at > now()
   order by started_at desc limit 1;
  if a.id is not null then return sehat_care_attempt_view(a); end if;

  if v_kind = 'module' then
    select array_agg(id) into v_ids from (
      select qq.id from care_partner_questions qq where qq.is_active and qq.module_id = p_module order by random() limit v_n) s;
  else
    -- N from every published module, then shuffled.
    select array_agg(id order by random()) into v_ids from (
      select qq.id, row_number() over (partition by qq.module_id order by random()) rn
        from care_partner_questions qq join care_partner_modules mm on mm.id = qq.module_id and mm.is_published
       where qq.is_active) s
     where rn <= sehat_care_setting_int('exam_per_module', 2);
  end if;
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

-- ── Submit: the final also needs every rules question right ─────────────────
create or replace function sehat_care_quiz_submit(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; a care_partner_attempts; v_right int := 0; v_total int; v_pct numeric; v_pass boolean; v_fails int;
        v_next timestamptz; v_review jsonb; v_topics jsonb; q record; v_reactivated boolean := false; v_rules_missed int := 0;
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
  for q in select qq.id, qq.correct, coalesce(mm.is_rules, false) is_rules
             from care_partner_questions qq left join care_partner_modules mm on mm.id = qq.module_id
            where qq.id = any(a.question_ids) loop
    if (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(coalesce(p_answers -> q.id::text, '[]'::jsonb)) x)
       = (select array_agg(x order by x) from jsonb_array_elements_text(q.correct) x) then
      v_right := v_right + 1;
    elsif q.is_rules then
      v_rules_missed := v_rules_missed + 1;
    end if;
  end loop;
  v_pct := round(100.0 * v_right / greatest(v_total, 1), 2);
  v_pass := v_pct >= sehat_care_setting_int('pass_mark', 80) and (a.kind <> 'final' or v_rules_missed = 0);

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
  elsif v_pass and a.kind = 'refresher' and sehat_care_is_inactive_pause(p) then
    perform sehat_care_set_status(p.id, case when p.agreement_signed_at is not null then 'active' else 'fee_paid' end);
    v_reactivated := true;
  end if;

  if v_pass then
    select jsonb_agg(jsonb_build_object('id', q2.id, 'text_en', q2.text_en, 'text_hi', q2.text_hi, 'options', q2.options,
             'correct', q2.correct, 'chosen', coalesce(p_answers -> q2.id::text, '[]'::jsonb),
             'explain_en', q2.explain_en, 'explain_hi', q2.explain_hi) order by array_position(a.question_ids, q2.id))
      into v_review from care_partner_questions q2 where q2.id = any(a.question_ids);
  else
    select coalesce(jsonb_agg(distinct jsonb_build_object('slug', m.slug, 'title_en', m.title_en, 'title_hi', m.title_hi)), '[]'::jsonb)
      into v_topics
      from care_partner_questions q3 join care_partner_modules m on m.id = coalesce(q3.module_id, a.module_id)
     where q3.id = any(a.question_ids)
       and (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(coalesce(p_answers -> q3.id::text, '[]'::jsonb)) x)
           is distinct from (select array_agg(x order by x) from jsonb_array_elements_text(q3.correct) x);
  end if;
  return jsonb_build_object('passed', v_pass, 'score_pct', v_pct, 'correct', v_right, 'total', v_total,
                            'pass_mark', sehat_care_setting_int('pass_mark', 80), 'next_allowed_at', v_next,
                            'review', v_review, 'revise', v_topics, 'kind', a.kind, 'reactivated', v_reactivated,
                            'rules_missed', case when a.kind = 'final' then v_rules_missed end);
end $$;
revoke all on function sehat_care_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function sehat_care_quiz_submit(uuid, jsonb) to authenticated;

-- ── Next step: read the next module, then the exam ──────────────────────────
-- Only the learning part of 0337's version changes (0338 wraps it for the inactivity pause).
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'sehat_care_next_step_0337') then
    raise exception '0341 needs 0338 (sehat_care_next_step_0337)';
  end if;
end $$;

create or replace function sehat_care_next_step_learning(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_done int; v_next care_partner_modules; v_np care_partner_progress;
begin
  select count(*), count(*) filter (where coalesce(sehat_care_module_done(m, pr), false)) into v_total, v_done
    from care_partner_modules m left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
   where m.is_published;
  select m.* into v_next from care_partner_modules m
    left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
   where m.is_published and not coalesce(sehat_care_module_done(m, pr), false)
   order by m.sort_order limit 1;
  if v_next.id is not null then
    select * into v_np from care_partner_progress where partner_id = p.id and module_id = v_next.id;
    if sehat_care_module_quizzes_on() and coalesce(sehat_care_module_ready(v_next, v_np), false) then
      return jsonb_build_object('key', 'module_quiz', 'path', '/partner/quiz/' || v_next.slug, 'done', v_done, 'total', v_total,
        'en', format('Next: the quiz for "%s".', v_next.title_en), 'hi', format('अगला: "%s" का क्विज़।', v_next.title_hi));
    end if;
    return jsonb_build_object('key', 'module', 'path', '/partner/learn#' || v_next.slug, 'done', v_done, 'total', v_total,
      'en', case when coalesce(v_next.youtube_id_hi, v_next.youtube_id_en) is null
                 then format('Next: %s — read the PDF (%s of %s done).', v_next.title_en, v_done, v_total)
                 else format('Next: %s — watch the video and read the PDF (%s of %s done).', v_next.title_en, v_done, v_total) end,
      'hi', case when coalesce(v_next.youtube_id_hi, v_next.youtube_id_en) is null
                 then format('अगला: %s — PDF पढ़ें (%s में से %s पूरे)।', v_next.title_hi, v_total, v_done)
                 else format('अगला: %s — वीडियो देखें और PDF पढ़ें (%s में से %s पूरे)।', v_next.title_hi, v_total, v_done) end);
  end if;
  if v_total > 0 then
    return jsonb_build_object('key', 'final', 'path', '/partner/exam', 'done', v_done, 'total', v_total,
      'en', 'All modules read. Take the final exam.', 'hi', 'सभी मॉड्यूल पढ़ लिए। फ़ाइनल परीक्षा दें।');
  end if;
  return jsonb_build_object('key', 'waiting', 'path', '/partner/learn',
    'en', 'The modules are being prepared. Please check back soon.', 'hi', 'मॉड्यूल तैयार हो रहे हैं। कृपया जल्द फिर देखें।');
end $$;
revoke all on function sehat_care_next_step_learning(care_partners) from public, anon, authenticated;

create or replace function sehat_care_next_step(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p.id is not null and sehat_care_is_inactive_pause(p) then
    return jsonb_build_object('key', 'reactivate', 'path', '/partner/refresher',
      'en', format('Your Partner ID is paused: no paying business came within %s days. Pass the refresher quiz to reactivate it.', sehat_care_setting_int('inactive_days', 90)),
      'hi', format('आपका Partner ID रोका गया है: %s दिन में कोई भुगतान करने वाला व्यवसाय नहीं जुड़ा। इसे फिर चालू करने के लिए रिफ़्रेशर क्विज़ पास करें।', sehat_care_setting_int('inactive_days', 90)));
  end if;
  if p.id is not null and p.status in ('registered', 'learning') then
    return sehat_care_next_step_learning(p);
  end if;
  return sehat_care_next_step_0337(p);
end $$;
revoke all on function sehat_care_next_step(care_partners) from public, anon, authenticated;

-- Admin settings accept the on/off switch.
create or replace function sehat_admin_care_settings_save(p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare k text; v text;
begin
  perform sehat_care_admin_only();
  for k, v in select key, value from jsonb_each_text(p) loop
    if k !~ '^partner_[a-z_]+$' or not exists (select 1 from site_settings where key = k) then
      raise exception 'Unknown setting %.', k using errcode = '22023';
    end if;
    if k in ('partner_program_enabled', 'partner_module_quizzes') then
      if v not in ('on', 'off') then raise exception 'That setting is on or off.' using errcode = '22023'; end if;
    elsif k = 'partner_contact_email' then
      if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Check the email address.' using errcode = '22023'; end if;
    elsif k in ('partner_fee_description', 'partner_fee_sac') then
      if btrim(v) = '' then raise exception '% cannot be empty.', k using errcode = '22023'; end if;
    elsif v !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception '% must be a number.', k using errcode = '22023';
    end if;
    update site_settings set value = v, updated_at = now() where key = k and value is distinct from v;
  end loop;
end $$;
revoke all on function sehat_admin_care_settings_save(jsonb) from public, anon;
grant execute on function sehat_admin_care_settings_save(jsonb) to authenticated;

-- Help Center: how the training works now.
update care_partner_faq set
  answer_en = 'Read every module (and watch its video, where there is one). The final exam then opens: 2 questions from every module, each with 4 options and one right answer — nothing to write. You need at least {{pass_mark}}% overall, and every question on the rules (dos and don''ts, ethics, communication, code of conduct) right. {{site}}/partner/learn',
  answer_hi = 'हर मॉड्यूल पढ़ें (और जहाँ हो, उसका वीडियो देखें)। फिर फ़ाइनल परीक्षा खुलती है: हर मॉड्यूल से 2 सवाल, हर सवाल के 4 विकल्प और एक सही जवाब — कुछ लिखना नहीं। कुल कम से कम {{pass_mark}}% चाहिए, और नियमों (क्या करें-न करें, नैतिकता, बातचीत, आचार संहिता) के हर सवाल का सही जवाब। {{site}}/partner/learn'
 where id = 'quiz_pass';
update care_partner_faq set
  answer_en = 'A module counts as done when you have read its PDF (and watched at least 90% of its video, where there is one). Do not skip ahead, use the same login, and keep the page open until the video ends. If it still shows incomplete, open a ticket with the module name: {{site}}/partner/tickets',
  answer_hi = 'मॉड्यूल तब पूरा माना जाता है जब आपने उसकी PDF पढ़ ली हो (और जहाँ वीडियो हो, कम से कम 90% देखा हो)। आगे न छोड़ें, वही लॉगिन इस्तेमाल करें, और वीडियो खत्म होने तक पेज खुला रखें। फिर भी अधूरा दिखे तो मॉड्यूल के नाम के साथ टिकट खोलें: {{site}}/partner/tickets'
 where id = 'video_not_done';
update care_partner_faq set
  answer_en = replace(answer_en, 'PDFs and quizzes are available in both languages.', 'PDFs and the exam are available in both languages.')
 where id = 'language';

notify pgrst, 'reload schema';
