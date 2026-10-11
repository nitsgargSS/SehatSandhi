-- ============================================================================
-- 0234 — An invoice or a login link on WhatsApp is asked for, not pushed
-- ============================================================================
-- AFTER 0233. Safe to re-run.
--
-- Sehatsandhi's invoice to a business, and a staff member's invitation, went
-- out as WhatsApp templates the moment they were made — messages we start,
-- which Meta bills us for. Both already go by email. Decided 11 Oct 2026:
-- nothing is pushed on WhatsApp; a business or staff member who wants it
-- there writes "invoice" or "login" to the Sehatsandhi number, and the bot
-- answers inside the conversation THEY opened, which costs nothing.
--
-- bot_business_ask_json answers those two requests, to the number that asks
-- and only about itself:
--   'invoice' — the last three invoices of the business registered on that
--               number (or addressed to it), each with its private link.
--   'login'   — where that number is on a team (or owns a listing): the
--               sign-in page, where the same number gets a code on WhatsApp.
-- A number that is neither gets { found: false } and the bot carries on as
-- with anyone else — it is never told which numbers are businesses.
-- ============================================================================

create or replace function bot_business_ask_json(p_phone text, p_what text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_site text := sehat_site_url();
  v_text text;
  v_n integer;
begin
  if v_phone is null then return jsonb_build_object('found', false); end if;

  if p_what = 'invoice' then
    select count(*), string_agg(line, E'\n\n' order by d desc) into v_n, v_text from (
      select i.invoice_date d,
             '🧾 ' || i.invoice_number || ' · ₹' || to_char(i.total_amount, 'FM99,99,99,990.00')
             || ' · ' || to_char(i.invoice_date, 'DD Mon YYYY') || E'\n' || v_site || '/invoice/' || i.public_token as line
        from invoices i
        left join businesses b on b.id = i.business_id
       where i.status = 'issued' and i.public_token is not null
         and (sehat_normalise_phone(i.recipient_phone) = v_phone or sehat_normalise_phone(b.phone) = v_phone)
       order by i.invoice_date desc, i.created_at desc limit 3) t;
    if coalesce(v_n, 0) > 0 then
      return jsonb_build_object('found', true, 'text',
        'आपके Sehatsandhi इनवॉइस / Your Sehatsandhi invoices:' || E'\n\n' || v_text
        || E'\n\n' || 'ये लिंक आपके लिए निजी हैं। / These links are private to you.');
    end if;
    if exists (select 1 from businesses b where sehat_normalise_phone(b.phone) = v_phone) then
      return jsonb_build_object('found', true, 'text',
        'इस नंबर पर अभी कोई इनवॉइस नहीं बना है। भुगतान के बाद इनवॉइस आपके डैशबोर्ड (Plan & billing) और ईमेल पर मिलता है।'
        || E'\n' || 'No invoice has been raised for this number yet.');
    end if;
    return jsonb_build_object('found', false);
  end if;

  if p_what = 'login' then
    select string_agg(distinct b.name, ', ') into v_text from (
      select b.name from businesses b where sehat_normalise_phone(b.phone) = v_phone and b.status in ('active', 'pending')
      union
      select b.name from practitioners p
        join business_practitioners bp on bp.practitioner_id = p.id and bp.status <> 'suspended'
        join businesses b on b.id = bp.business_id
       where sehat_normalise_phone(p.phone) = v_phone) b;
    if v_text is null then return jsonb_build_object('found', false); end if;
    return jsonb_build_object('found', true, 'text',
      '🔑 ' || v_text || E'\n\n'
      || 'साइन इन करें / Sign in:' || E'\n' || v_site || '/business/login' || E'\n\n'
      || 'वहाँ यही मोबाइल नंबर डालें — लॉगिन कोड इसी WhatsApp पर आएगा। पासवर्ड की ज़रूरत नहीं।'
      || E'\n' || 'Enter this mobile number there; your login code arrives on this WhatsApp. No password needed.');
  end if;

  return jsonb_build_object('found', false);
end $$;
revoke all on function bot_business_ask_json(text, text) from public, anon, authenticated;
grant execute on function bot_business_ask_json(text, text) to service_role;

notify pgrst, 'reload schema';
