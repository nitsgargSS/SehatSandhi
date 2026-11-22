-- ============================================================================
-- 0338 — Care Partner Program: pause partners with no paying business in 90 days
-- ============================================================================
-- AFTER 0337. Safe to re-run.
--
-- The brief, Module 10 and the Help Center already say it; this makes it so
-- (another piece of "keep genuine partners", with 0337's yearly renewal):
--
--   Pause      nightly: an active partner whose first paying business has not
--              come within partner_inactive_days (90) of becoming active is
--              paused, status_reason 'Inactive: …'. "Paying business" = a
--              business credited to them (business_partner_credits approved)
--              that has a paid subscription payment.
--   Reactivate the partner passes the refresher quiz (the same one as renewal)
--              → active again, and the 90-day clock restarts from that day.
--   Other pauses (an admin, a complaint) are not touched by either.
-- ============================================================================

create or replace function sehat_care_is_inactive_pause(p care_partners)
returns boolean language sql immutable as $$
  select p.status = 'paused' and coalesce(p.status_reason, '') like 'Inactive:%'
$$;

-- ── Refresher quiz: renewal (0337) or reactivation after an inactive pause ──
create or replace function sehat_care_refresher_start()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; r jsonb; a care_partner_attempts; v_wait timestamptz; v_ids uuid[]; v_orders jsonb := '{}'::jsonb; q record;
begin
  p := sehat_care_me_row();
  if p.id is null then raise exception 'Please register first.' using errcode = '42501'; end if;
  if not sehat_care_is_inactive_pause(p) then
    r := sehat_care_renewal(p);
    if not coalesce((r ->> 'open')::boolean, false) then
      raise exception '%', case when r ? 'opens_on' and current_date < (r ->> 'opens_on')::date
                                then format('Renewal opens on %s.', to_char((r ->> 'opens_on')::date, 'DD Mon YYYY'))
                                else 'Renewal is not open for your account.' end using errcode = 'P0001';
    end if;
    if (r ->> 'refresher_passed')::boolean then raise exception 'You have already passed the refresher quiz. Pay the renewal fee next.' using errcode = 'P0001'; end if;
  end if;

  v_wait := sehat_care_quiz_wait(p.id, 'refresher', null);
  if v_wait is not null then
    raise exception 'You can try again after %.', to_char(v_wait at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') using errcode = 'P0001';
  end if;
  select * into a from care_partner_attempts
   where partner_id = p.id and kind = 'refresher' and submitted_at is null and expires_at > now()
   order by started_at desc limit 1;
  if a.id is not null then return sehat_care_attempt_view(a); end if;

  select array_agg(id) into v_ids from (
    select qq.id from care_partner_questions qq
     where qq.is_active and (qq.module_id is null or qq.module_id in (select id from care_partner_modules where is_published))
     order by random() limit sehat_care_setting_int('refresher_questions', 10)) s;
  if v_ids is null then raise exception 'The refresher quiz has no questions yet.' using errcode = 'P0001'; end if;
  for q in select id, options from care_partner_questions where id = any(v_ids) loop
    v_orders := v_orders || jsonb_build_object(q.id::text,
      (select jsonb_agg(o->>'id' order by random()) from jsonb_array_elements(q.options) o));
  end loop;
  insert into care_partner_attempts (partner_id, module_id, kind, question_ids, option_orders, expires_at)
  values (p.id, null, 'refresher', v_ids, v_orders, now() + make_interval(mins => sehat_care_setting_int('attempt_minutes', 60)))
  returning * into a;
  return sehat_care_attempt_view(a);
end $$;
revoke all on function sehat_care_refresher_start() from public, anon;
grant execute on function sehat_care_refresher_start() to authenticated;

-- ── Submit: a passed refresher lifts an inactive pause ──────────────────────
create or replace function sehat_care_quiz_submit(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; a care_partner_attempts; v_right int := 0; v_total int; v_pct numeric; v_pass boolean; v_fails int;
        v_next timestamptz; v_review jsonb; v_topics jsonb; q record; v_reactivated boolean := false;
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
                            'review', v_review, 'revise', v_topics, 'kind', a.kind, 'reactivated', v_reactivated);
end $$;
revoke all on function sehat_care_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function sehat_care_quiz_submit(uuid, jsonb) to authenticated;

-- ── Next step: an inactive pause points at the refresher quiz ───────────────
-- Wraps 0337's version: only the paused-for-inactivity case is new.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'sehat_care_next_step_0337') then
    alter function sehat_care_next_step(care_partners) rename to sehat_care_next_step_0337;
  end if;
end $$;
revoke all on function sehat_care_next_step_0337(care_partners) from public, anon, authenticated;

create or replace function sehat_care_next_step(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p.id is not null and sehat_care_is_inactive_pause(p) then
    return jsonb_build_object('key', 'reactivate', 'path', '/partner/refresher',
      'en', format('Your Partner ID is paused: no paying business came within %s days. Pass the refresher quiz to reactivate it.', sehat_care_setting_int('inactive_days', 90)),
      'hi', format('आपका Partner ID रोका गया है: %s दिन में कोई भुगतान करने वाला व्यवसाय नहीं जुड़ा। इसे फिर चालू करने के लिए रिफ़्रेशर क्विज़ पास करें।', sehat_care_setting_int('inactive_days', 90)));
  end if;
  return sehat_care_next_step_0337(p);
end $$;
revoke all on function sehat_care_next_step(care_partners) from public, anon, authenticated;

-- ── Nightly: renewals (0337) and the inactivity pause ───────────────────────
create or replace function sehat_care_renewals_nightly()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_ended int; v_paused int; v_days int := sehat_care_setting_int('inactive_days', 90);
begin
  update care_partners set status = 'terminated', status_reason = 'Partner ID not renewed.', status_changed_at = now(), updated_at = now()
   where partner_code is not null and status in ('fee_paid', 'active', 'paused')
     and valid_until is not null and valid_until + sehat_care_setting_int('id_grace_days', 30) < current_date;
  get diagnostics v_ended = row_count;

  update care_partners cp set status = 'paused', status_changed_at = now(), updated_at = now(),
         status_reason = format('Inactive: no paying business within %s days. Pass the refresher quiz to reactivate.', v_days)
   where cp.status = 'active' and v_days > 0
     and cp.status_changed_at < now() - make_interval(days => v_days)
     and not exists (select 1 from business_partner_credits c
                      where c.partner_id = cp.marketing_partner_id and c.status = 'approved'
                        and exists (select 1 from payments pay where pay.business_id = c.business_id
                                     and pay.type = 'subscription' and pay.status = 'paid'));
  get diagnostics v_paused = row_count;
  return jsonb_build_object('ended', v_ended, 'paused_inactive', v_paused);
end $$;
revoke all on function sehat_care_renewals_nightly() from public, anon, authenticated;

-- ── Help Center: what pauses an ID now ──────────────────────────────────────
update care_partner_faq set
  answer_en = 'An ID is paused if no paying business comes within {{inactive_days}} days of it becoming active — pass the refresher quiz to reactivate it ({{site}}/partner/refresher). It can also be paused while a complaint is looked into; open a ticket to find out the reason and next step. An ID that has expired is not paused: renew it within {{id_grace_days}} days, or the partnership ends. {{site}}/partner/tickets',
  answer_hi = 'अगर ID चालू होने के {{inactive_days}} दिन में कोई भुगतान करने वाला व्यवसाय नहीं जुड़ता, तो ID रोका जाता है — रिफ़्रेशर क्विज़ पास करके फिर चालू करें ({{site}}/partner/refresher)। किसी शिकायत की जाँच के दौरान भी ID रोका जा सकता है; कारण और अगला कदम जानने के लिए टिकट खोलें। खत्म हुआ ID रोका नहीं जाता: उसे {{id_grace_days}} दिन में रिन्यू करें, नहीं तो साझेदारी समाप्त हो जाती है। {{site}}/partner/tickets'
 where id = 'paused';

notify pgrst, 'reload schema';
