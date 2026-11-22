-- ============================================================================
-- 0336 — Care Partner Program: a module's video is optional until it exists
-- ============================================================================
-- AFTER 0335. Safe to re-run.
--
-- Nitin, 22 Nov 2026: the reading material (PDFs) is ready first; the videos
-- are made later. So a module can be published with a PDF and its quiz
-- questions alone. While a module has no video, reading its PDF is enough to
-- open its quiz; once a video is added, watching it is required again for
-- partners who have not yet passed that module's quiz.
-- ============================================================================

create or replace function sehat_care_module_ready(m care_partner_modules, pr care_partner_progress)
returns boolean language sql stable as $$
  select pr.doc_read_at is not null
     and (coalesce(m.youtube_id_hi, m.youtube_id_en) is null or pr.video_completed_at is not null)
$$;

-- ── Quiz start: the video only when the module has one ──────────────────────
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
    if not coalesce(sehat_care_module_ready(m, pr), false) then
      raise exception '%', case when coalesce(m.youtube_id_hi, m.youtube_id_en) is null then 'Read the PDF first.'
                                else 'Watch the video and read the PDF first.' end using errcode = 'P0001';
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

  select * into a from care_partner_attempts
   where partner_id = p.id and kind = v_kind and module_id is not distinct from p_module and submitted_at is null and expires_at > now()
   order by started_at desc limit 1;
  if a.id is not null then return sehat_care_attempt_view(a); end if;

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

-- ── Publishing: a PDF and enough questions; the video when it exists ────────
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
  if v_pub and coalesce(nullif(p->>'pdf_path_hi', ''), nullif(p->>'pdf_path_en', '')) is null then
    raise exception 'A module needs its PDF before it can be published.' using errcode = 'P0001';
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

-- ── Next step: "read the PDF" when there is no video yet ────────────────────
create or replace function sehat_care_next_step(p care_partners)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_done int; v_next care_partner_modules; v_np care_partner_progress; v_pending int;
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
    return jsonb_build_object('key', 'pay', 'path', '/partner/certify',
      'en', 'You passed! Pay the certification fee to get your Partner ID.', 'hi', 'आप पास हो गए! अपना Partner ID पाने के लिए सर्टिफ़िकेशन फ़ीस दें।');
  end if;
  if p.status in ('fee_paid', 'active') then
    v_pending := (select count(*) from care_partner_contracts c where c.is_current
                   and not exists (select 1 from care_partner_acceptances a where a.contract_id = c.id and a.partner_id = p.id));
    if p.status = 'fee_paid' or v_pending > 0 then
      return jsonb_build_object('key', 'agreement', 'path', '/partner/agreement',
        'en', case when p.status = 'fee_paid' then 'Read and accept the Partner Agreement to activate your Partner ID.'
                   else 'An updated agreement or policy needs your acceptance.' end,
        'hi', case when p.status = 'fee_paid' then 'अपना Partner ID चालू करने के लिए पार्टनर एग्रीमेंट पढ़ें और स्वीकार करें।'
                   else 'एक नया एग्रीमेंट या नीति आपकी स्वीकृति के लिए है।' end);
    end if;
    if not exists (select 1 from care_partner_leads where partner_id = p.id) then
      return jsonb_build_object('key', 'first_lead', 'path', '/partner/dashboard#leads',
        'en', 'You are active. Reserve the first doctor you will talk to.', 'hi', 'आप सक्रिय हैं। जिस पहले डॉक्टर से बात करेंगे, उन्हें रिज़र्व करें।');
    end if;
    return jsonb_build_object('key', 'active', 'path', '/partner/dashboard',
      'en', 'See your reserved doctors and businesses.', 'hi', 'अपने रिज़र्व डॉक्टर और व्यवसाय देखें।');
  end if;
  select count(*), count(*) filter (where pr.quiz_passed_at is not null) into v_total, v_done
    from care_partner_modules m left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
   where m.is_published;
  select m.* into v_next from care_partner_modules m
    left join care_partner_progress pr on pr.module_id = m.id and pr.partner_id = p.id
   where m.is_published and pr.quiz_passed_at is null
   order by m.sort_order limit 1;
  if v_next.id is not null then
    select * into v_np from care_partner_progress where partner_id = p.id and module_id = v_next.id;
    if coalesce(sehat_care_module_ready(v_next, v_np), false) then
      return jsonb_build_object('key', 'module_quiz', 'path', '/partner/quiz/' || v_next.slug, 'done', v_done, 'total', v_total,
        'en', format('Next: the quiz for "%s".', v_next.title_en), 'hi', format('अगला: "%s" का क्विज़।', v_next.title_hi));
    end if;
    return jsonb_build_object('key', 'module', 'path', '/partner/learn#' || v_next.slug, 'done', v_done, 'total', v_total,
      'en', case when coalesce(v_next.youtube_id_hi, v_next.youtube_id_en) is null
                 then format('Next: %s — read the PDF.', v_next.title_en)
                 else format('Next: %s — watch the video and read the PDF.', v_next.title_en) end,
      'hi', case when coalesce(v_next.youtube_id_hi, v_next.youtube_id_en) is null
                 then format('अगला: %s — PDF पढ़ें।', v_next.title_hi)
                 else format('अगला: %s — वीडियो देखें और PDF पढ़ें।', v_next.title_hi) end);
  end if;
  if v_total > 0 then
    return jsonb_build_object('key', 'final', 'path', '/partner/exam', 'done', v_done, 'total', v_total,
      'en', 'All modules done. Take the final exam.', 'hi', 'सभी मॉड्यूल पूरे। फ़ाइनल परीक्षा दें।');
  end if;
  return jsonb_build_object('key', 'waiting', 'path', '/partner/learn',
    'en', 'The modules are being prepared. Please check back soon.', 'hi', 'मॉड्यूल तैयार हो रहे हैं। कृपया जल्द फिर देखें।');
end $$;
revoke all on function sehat_care_next_step(care_partners) from public, anon, authenticated;

notify pgrst, 'reload schema';
