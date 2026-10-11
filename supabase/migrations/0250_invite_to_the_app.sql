-- ============================================================================
-- 0250 — On WhatsApp, patients are invited to the app
-- ============================================================================
-- AFTER 0249. Safe to re-run.
--
-- The goal is to move patients from WhatsApp to the app. 0227 offered the app
-- once, in a line. Now:
--   • after something is finished on WhatsApp — a booking, lab tests, a
--     medicine order, an insurance request — the confirmation is followed by
--     what the app adds, with its store links;
--   • a patient who stops part-way is sent the same invitation once, 20
--     minutes on, while WhatsApp still lets us write for free (within 24 hours
--     of their last message).
-- At most one of each a week per number; never to a number that already has
-- the app; and nothing at all until a store link is saved:
--   site_settings 'app_link' (Play Store) and 'app_link_ios' (App Store).
-- ============================================================================

alter table wa_contacts add column if not exists app_pitch_done_at timestamptz;
alter table wa_contacts add column if not exists app_pitch_left_at timestamptz;

-- The store links as lines of a message; null until at least one is saved.
create or replace function sehat_app_links()
returns text language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(E'\n',
    (select '📱 Android: ' || nullif(btrim(value), '') from site_settings where key = 'app_link'),
    (select '🍎 iPhone: ' || nullif(btrim(value), '') from site_settings where key = 'app_link_ios')), '');
$$;

create or replace function sehat_wa_has_app(p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from patient_app_accounts a
                  where regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') in (p_phone, right(p_phone, 10)));
$$;

-- The invitation for this number at this moment ('done' | 'left'), or '' when
-- it is not to be sent. Asking marks it as sent.
create or replace function sehat_wa_app_pitch(p_phone text, p_moment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_links text := sehat_app_links();
  c wa_contacts;
begin
  if v_links is null or v_phone = '' or p_moment not in ('done', 'left') or sehat_wa_has_app(v_phone) then
    return jsonb_build_object('text', '');
  end if;
  select * into c from wa_contacts where phone = v_phone;
  if c.phone is null then return jsonb_build_object('text', ''); end if;
  if p_moment = 'done' then
    if c.app_pitch_done_at > now() - interval '7 days' then return jsonb_build_object('text', ''); end if;
    update wa_contacts set app_pitch_done_at = now() where phone = v_phone;
    return jsonb_build_object('text',
      '📱 *Sehatsandhi ऐप* — अगली बार और आसान:' || E'\n'
      || '✅ बुकिंग देखें, बदलें, और रिमाइंडर पाएं' || E'\n'
      || '✅ पर्चे, बिल और रिपोर्ट एक जगह सुरक्षित' || E'\n'
      || '✅ पूरे परिवार के लिए बुकिंग' || E'\n'
      || 'मुफ़्त डाउनलोड / Free download:' || E'\n' || v_links);
  end if;
  if c.app_pitch_left_at > now() - interval '7 days' or c.app_pitch_done_at > now() - interval '1 day' then
    return jsonb_build_object('text', '');
  end if;
  update wa_contacts set app_pitch_left_at = now() where phone = v_phone;
  return jsonb_build_object('text',
    'बुकिंग अधूरी रह गई? 🙂' || E'\n'
    || '*Sehatsandhi ऐप* में इसे आराम से पूरा करें — डॉक्टर, लैब और दवाई एक जगह, रिमाइंडर के साथ। मुफ़्त:' || E'\n'
    || v_links || E'\n\n'
    || 'यहीं जारी रखने के लिए *Hi* भेजें। / Send *Hi* to continue here.');
end $$;

-- Who stopped part-way and may still be written to for free.
create or replace function sehat_wa_app_left_due()
returns table (phone text, line text) language sql stable security definer set search_path = public as $$
  select s.phone, s.line
    from wa_bot_sessions s
    join wa_contacts c on c.phone = s.phone
   where s.state <> 'idle'
     and s.updated_at < now() - interval '20 minutes' and s.updated_at > now() - interval '3 hours'
     and c.last_inbound_at > now() - interval '23 hours'
     and (c.app_pitch_left_at is null or c.app_pitch_left_at < now() - interval '7 days')
     and (c.app_pitch_done_at is null or c.app_pitch_done_at < now() - interval '1 day')
     and sehat_app_links() is not null
     and not sehat_wa_has_app(s.phone)
     and not exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(s.phone))
   order by s.updated_at
   limit 30;
$$;

revoke all on function sehat_app_links() from public, anon, authenticated;
revoke all on function sehat_wa_has_app(text) from public, anon, authenticated;
revoke all on function sehat_wa_app_pitch(text, text) from public, anon, authenticated;
revoke all on function sehat_wa_app_left_due() from public, anon, authenticated;
grant execute on function sehat_app_links() to service_role;
grant execute on function sehat_wa_has_app(text) to service_role;
grant execute on function sehat_wa_app_pitch(text, text) to service_role;
grant execute on function sehat_wa_app_left_due() to service_role;

-- Every ten minutes, and only when someone is due.
do $$ begin
  perform cron.unschedule('wa-app-nudge');
exception when others then null; end $$;
select cron.schedule('wa-app-nudge', '*/10 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/wa-app-nudge',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
     where exists (select 1 from sehat_wa_app_left_due())
$job$);

notify pgrst, 'reload schema';
