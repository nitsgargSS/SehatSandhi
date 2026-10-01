-- ============================================================================
-- Sehatsandhi — "Yes, send me health tips": platform opt-in on WhatsApp
--
-- Run AFTER 0186. Safe to re-run.
--
-- Decided 1 Oct 2026: the bot asks everyone (after search / booking) whether
-- they want health tips and offers from clinics near them, with a button whose
-- text is unique — "✅ Yes, send me health tips" / "✅ हाँ, हेल्थ टिप्स भेजें".
-- The reply reaches us through the AiSensy webhook (whatsapp-inbound, 0186)
-- and is recorded here as Sehatsandhi-level marketing consent (business_id
-- null), with the message itself as the evidence. It is the person's own
-- affirmative act, so it also lifts an earlier STOP. STOP (0173) withdraws it.
--
-- A plain "yes" to some other question is never read as consent: only the
-- button's own text counts (matched in whatsapp-inbound).
--
--   sehat_wa_platform_optin(phone, text, message_id)   service only
--   sehat_admin_optin_contacts(pin?)                    Sehatsandhi admins:
--       who has opted in, by area — the list a tips/offers broadcast goes to.
-- ============================================================================

create or replace function sehat_wa_platform_optin(p_phone text, p_text text default null, p_message_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_patient uuid;
begin
  if v_phone is null then return jsonb_build_object('ok', false, 'reason', 'bad number'); end if;
  select id into v_patient from patients where phone = v_phone;
  if v_patient is null then
    insert into patients (phone, lang, source, source_detail, verified, status)
    values (v_phone, 'hi', 'whatsapp_inbound', 'platform opt-in button', true, 'active')
    returning id into v_patient;
  end if;
  -- Their own "yes" outranks an earlier STOP.
  delete from opt_outs where phone_hash = sehat_phone_hash(v_phone);
  -- Once is enough: a second tap adds no second row.
  if not exists (select 1 from patient_consents c where c.phone = v_phone and c.business_id is null
                  and c.purpose = 'marketing' and c.action = 'granted'
                  and c.created_at > coalesce((select max(w.created_at) from patient_consents w where w.phone = v_phone
                                                 and w.purpose = 'marketing' and w.action = 'withdrawn'), '-infinity')) then
    insert into patient_consents (patient_id, phone, channel, action, basis, evidence_ref, purpose, recorded_by)
    values (v_patient, v_phone, 'whatsapp', 'granted',
            'WhatsApp opt-in button: ' || coalesce(left(p_text, 120), 'yes'), p_message_id, 'marketing', 'system:wa_optin_button');
  end if;
  update patients
     set consent_status = 'granted',
         consent_channels = array(select distinct unnest(coalesce(consent_channels, '{}') || array['whatsapp'])),
         consent_basis = coalesce(consent_basis, 'Sehatsandhi WhatsApp opt-in button'),
         consent_at = coalesce(consent_at, now()),
         updated_at = now()
   where id = v_patient;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function sehat_wa_platform_optin(text, text, text) from public, anon, authenticated;

-- Who may receive Sehatsandhi tips and offers: opted in, not opted out.
-- Optionally by PIN code (the area they gave, or their district's).
create or replace function sehat_admin_optin_contacts(p_pin text default null)
returns table (phone text, name text, pin_code text, area text, opted_in_at timestamptz, last_message_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.phone, coalesce(p.name, w.profile_name), p.pin_code, p.area, p.consent_at, w.last_inbound_at
    from patients p
    left join wa_contacts w on w.phone = p.phone
   where sehat_is_staff()
     and p.consent_status = 'granted'
     and 'whatsapp' = any(coalesce(p.consent_channels, '{}'))
     and not exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(p.phone))
     and (p_pin is null or p.pin_code = p_pin
          or p.pin_code = any(coalesce(sehat_district_pin_codes(p_pin), '{}')))
   order by p.consent_at desc nulls last;
$$;
revoke all on function sehat_admin_optin_contacts(text) from public, anon;
grant execute on function sehat_admin_optin_contacts(text) to authenticated;

notify pgrst, 'reload schema';
