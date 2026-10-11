#!/usr/bin/env python3
"""Create Sehatsandhi's WhatsApp message templates at Meta, and show how their
review stands — instead of typing nineteen of them into WhatsApp Manager.

    python3 scripts/wa-templates.py            create the missing ones, then show all
    python3 scripts/wa-templates.py status     only show how each stands

A template lives in a messaging account and can be sent only from that
account's number, so which account holds which is the point of this file:

  MAIN     +91 70153 99355 — patients: their login code, appointment messages,
           the rating request.
  CLINICS  +91 79886 20804 — everything to or from a business: a clinic's own
           login code, booking alerts, invoices, staff invites; what a clinic
           sends its patients (prescription, bill, report, discharge, order);
           and the broadcasts a clinic picks from.

Wording and variable order are what the code sends (docs/whatsapp-templates.md).
A template that exists is left alone. Asks for the system user token and the
app secret with hidden input; prints neither.
"""
import getpass, hashlib, hmac, json, sys, urllib.error, urllib.parse, urllib.request

GRAPH = 'https://graph.facebook.com/v25.0'
MAIN, CLINICS = '1461510652560252', '1953329202322425'
STOP = 'Reply STOP to stop these messages'
PRIVATE = '\n\nThis link is private to you. Please do not share it.'

def body(text, *examples, footer=None):
    c = [{'type': 'BODY', 'text': text, **({'example': {'body_text': [list(examples)]}} if examples else {})}]
    if footer: c.append({'type': 'FOOTER', 'text': footer})
    return c

LOGIN = dict(name='login_code', language='en', category='AUTHENTICATION', components=[
    {'type': 'BODY', 'add_security_recommendation': True},
    {'type': 'FOOTER', 'code_expiration_minutes': 10},
    {'type': 'BUTTONS', 'buttons': [{'type': 'OTP', 'otp_type': 'COPY_CODE'}]}])
APPOINTMENT = dict(name='appointment_update', language='en', category='UTILITY', components=body(
    'Sehatsandhi appointment update:\n\n{{1}}\n\nReply to this message if you need any help.',
    'Your appointment with Dr. Anita Verma on Fri 10 Oct, 4:30 PM is confirmed. See you then.'))

def link(name, what, sample_from, sample_link):
    return dict(name=name, language='en', category='UTILITY', components=body(
        f'Hello {{{{1}}}}, your {what} from {{{{2}}}} is ready. View it here: {{{{3}}}}{PRIVATE}',
        'Sunita Devi', sample_from, sample_link))

def broadcast(name, category, text, *examples):
    return dict(name=name, language='en', category=category, components=body(text, 'Family Health Clinic', *examples, footer=STOP))

TEMPLATES = {
    MAIN: [
        LOGIN, APPOINTMENT,
        dict(name='rating_request', language='hi', category='UTILITY', components=body(
            'नमस्ते {{1}} 🙏 {{2}} के साथ {{3}} की आपकी विज़िट कैसी रही? 1 (खराब) से 5 (बहुत अच्छा) तक एक नंबर भेजें। आपकी रेटिंग दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद करती है।',
            'Sunita', 'Dr. Anita Verma', '20 सितंबर')),
    ],
    CLINICS: [
        LOGIN, APPOINTMENT,
        dict(name='invoice_link', language='en', category='UTILITY', components=body(
            'Your Sehatsandhi invoice {{1}} for {{2}} is ready. View and download it here: {{3}}\n\nThank you for being with Sehatsandhi.',
            'SS/2026-27/0041', '₹1,180.00', 'https://www.sehatsandhi.com/invoice/abc123')),
        dict(name='staff_invite', language='en', category='UTILITY', components=body(
            'Hello {{1}}, {{2}} has added you to their team on Sehatsandhi. Open this link to set up your login: {{3}}\n\nIf you do not work there, please ignore this message.',
            'Pooja Saini', 'Aggarwal Clinic', 'https://www.sehatsandhi.com/join/abc123')),
        link('prescription_link', 'prescription', 'Family Health Clinic', 'https://www.sehatsandhi.com/rx/abc123'),
        link('bill_link', 'bill', 'Family Health Clinic', 'https://www.sehatsandhi.com/bill/abc123'),
        link('lab_report_link', 'report', 'City Diagnostics', 'https://www.sehatsandhi.com/report/abc123'),
        link('discharge_link', 'discharge summary', 'Yamuna City Hospital', 'https://www.sehatsandhi.com/discharge/abc123'),
        dict(name='order_update', language='hi', category='UTILITY', components=body(
            'Sehatsandhi पर आपका दवाई ऑर्डर:\n\n{{1}}\n\nकोई सवाल हो तो यहीं जवाब दें।',
            '24x7 Chemist ने आपका ऑर्डर देख लिया है। कुल ₹240, डिलीवरी शाम 6 बजे तक।')),
        broadcast('appointment_reminder', 'UTILITY', 'Namaste from {{1}}. This is a reminder to book your follow-up visit. {{2}} To book, reply here or call us.', 'Your check-up is due this month.'),
        broadcast('clinic_notice', 'UTILITY', 'Namaste from {{1}}. Please note: {{2}} Thank you.', 'The clinic is closed on 2 Oct for Gandhi Jayanti.'),
        broadcast('health_camp', 'MARKETING', 'Namaste from {{1}}. We are holding a {{2}} on {{3}} at {{4}}. Everyone is welcome.', 'free eye check-up camp', 'Sunday 12 Oct, 10 am to 2 pm', 'our clinic on Jagadhri Road'),
        broadcast('new_service', 'MARKETING', 'Namaste from {{1}}. We now offer {{2}}. Reply here to know more or to book.', 'physiotherapy on Saturdays'),
        broadcast('health_advice', 'MARKETING', 'Health tip from {{1}}: {{2}} Stay healthy.', 'Drink boiled water during the monsoon.'),
        broadcast('festival_greeting', 'MARKETING', 'Namaste from {{1}}. Wishing you and your family a very happy {{2}}. {{3}} Warm regards.', 'Diwali', 'May it bring you good health and joy.'),
        broadcast('new_speciality', 'MARKETING', 'Namaste from {{1}}. We have added {{2}} at our clinic. {{3}} Reply here to know more or to book.', 'a skin (dermatology) OPD', 'Open Monday to Saturday, 10 am to 1 pm.'),
        broadcast('new_doctor', 'MARKETING', 'Namaste from {{1}}. {{2}} ({{3}}) has joined us and is available {{4}}. Reply here to book an appointment.', 'Dr. Anita Verma', 'MD, skin specialist', 'Monday to Friday, 5 pm to 8 pm'),
        broadcast('clinic_message', 'MARKETING', 'A message from {{1}}: {{2}} To book or to ask a question, reply here.', 'Our clinic has moved to the first floor of the same building from 15 October.'),
    ],
}
NAMES = {MAIN: 'MAIN  (+91 70153 99355)', CLINICS: 'CLINICS  (+91 79886 20804)'}

def main():
    only_status = len(sys.argv) > 1 and sys.argv[1] == 'status'
    print('Paste each value and press Enter. Nothing you paste is shown.')
    token = ''.join(getpass.getpass('1/2  Meta system user token (starts with EAA): ').split())
    secret = ''.join(getpass.getpass('2/2  Meta app secret: ').split())
    proof = hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()

    def call(method, path, data=None, query=None):
        q = urllib.parse.urlencode({'appsecret_proof': proof, **(query or {})})
        req = urllib.request.Request(f'{GRAPH}/{path}?{q}', method=method,
                                     data=json.dumps(data).encode() if data is not None else None,
                                     headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=40) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            try: return json.load(e)
            except Exception: return {'error': {'message': f'HTTP {e.code}'}}
        except Exception as e:
            return {'error': {'message': str(e)}}

    def why(r):
        e = r.get('error', {})
        return ' — '.join(str(x) for x in (e.get('error_user_title'), e.get('error_user_msg') or e.get('message')) if x)

    for waba, wanted in TEMPLATES.items():
        print(f'\n── {NAMES[waba]} ──')
        have = call('GET', f'{waba}/message_templates', query={'fields': 'name,language,status,category,rejected_reason', 'limit': 200})
        if 'error' in have:
            print('  ✗ could not read this account:', why(have)); continue
        there = {(t['name'], t['language']): t for t in have.get('data', [])}
        for t in wanted:
            key = (t['name'], t['language'])
            if key not in there and not only_status:
                r = call('POST', f'{waba}/message_templates', t)
                if 'error' in r:
                    print(f"  ✗ {t['name']:22} not created: {why(r)}"); continue
                there[key] = {'status': r.get('status', 'PENDING'), 'category': r.get('category', t['category']), 'new': True}
            s = there.get(key)
            if not s:
                print(f"  · {t['name']:22} not created yet"); continue
            moved = '' if s.get('category', t['category']) == t['category'] else f"  (Meta filed it as {s['category']}, not {t['category']})"
            reason = f"  reason: {s['rejected_reason']}" if s.get('rejected_reason') not in (None, 'NONE') else ''
            mark = {'APPROVED': '✓', 'REJECTED': '✗'}.get(s['status'], '…')
            print(f"  {mark} {t['name']:22} {t['language']}  {s['status']}{'  (just submitted)' if s.get('new') else ''}{moved}{reason}")
    print('\nCopy everything from the first "──" line down and send it. It contains no secret.')

if __name__ == '__main__':
    main()
