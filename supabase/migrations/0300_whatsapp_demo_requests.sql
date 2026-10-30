-- ============================================================================
-- 0300 — Demo requests on WhatsApp become leads
-- ============================================================================
-- AFTER 0299 (or 0298 on a project without Reels). Safe to re-run.
--
-- Decided 30 Oct 2026: every post, the Facebook cover and the videos say
-- "Free demo: WhatsApp 70153 99355" — the bot's number, which nobody reads.
-- So the bot catches a doctor asking for a demo, asks one question (name,
-- clinic, town), and this files it in Admin → Leads as an "interested" lead
-- to call today, and emails Sehatsandhi's admin.
-- ============================================================================

alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (kind = any (array[
  'business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite', 'nurse_unassigned',
  'wa_broadcast_rejected', 'signup_reminder', 'wa_broadcast_waiting', 'clinic_booking_cancelled',
  'demo_request']));

create or replace function bot_demo_request_json(p_phone text, p_name text, p_details text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_norm_phone(p_phone);
  v_details text := left(btrim(coalesce(p_details, '')), 300);
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
  v_lead uuid;
begin
  if v_phone is null then return jsonb_build_object('ok', false, 'text', null); end if;
  v_phone := '91' || v_phone;

  -- One lead per number: a second request reopens the follow-up for today.
  select id into v_lead from doctor_leads where phone = v_phone;
  if v_lead is null then
    insert into doctor_leads (name, phone, source, consent_type, stage, next_followup)
    values (coalesce(nullif(split_part(v_details, ',', 1), ''), v_name), v_phone,
            'whatsapp_demo', 'messaged_us', 'interested', current_date)
    returning id into v_lead;
  else
    update doctor_leads set next_followup = current_date,
           closed_at = null, close_reason = null,
           stage = case when stage in ('not_interested') then 'interested' else stage end
     where id = v_lead;
  end if;

  insert into doctor_lead_notes (lead_id, note, kind, author_label)
  values (v_lead, 'Asked for a demo on WhatsApp: ' || coalesce(nullif(v_details, ''), '(no details)')
          || coalesce(' — WhatsApp name: ' || v_name, ''), 'whatsapp', 'WhatsApp bot');

  insert into email_outbox (kind, payload)
  values ('demo_request', jsonb_build_object('lead_id', v_lead, 'phone', v_phone, 'details', v_details, 'name', v_name));

  return jsonb_build_object('ok', true, 'text',
    E'✅ धन्यवाद! हमारी टीम आज ही आपको इसी नंबर पर कॉल करेगी।\nThank you! Our team will call you on this number today.\n\nजल्दी बात करनी हो तो कॉल करें / To talk now, call: 87087 18705');
end $$;

revoke all on function bot_demo_request_json(text, text, text) from public, anon, authenticated;
grant execute on function bot_demo_request_json(text, text, text) to service_role;

notify pgrst, 'reload schema';
