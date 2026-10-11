#!/usr/bin/env python3
"""Create Sehatsandhi's WhatsApp message templates at Meta, and show how their
review stands — instead of typing nineteen of them into WhatsApp Manager.

    python3 scripts/wa-templates.py            create the missing ones, then show all
    python3 scripts/wa-templates.py status     only show how each stands
    python3 scripts/wa-templates.py preview 98XXXXXXXX        send every template, with its sample
                                               words, to that phone from the REAL numbers (Meta bills these)
    python3 scripts/wa-templates.py preview 98XXXXXXXX test   the same from Meta's TEST number, free: the
                                               templates are first created in the test account, and only
                                               those Meta has approved there are sent. The phone must be
                                               on the test number's list of allowed recipients.

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
import getpass, hashlib, hmac, json, os, sys, urllib.error, urllib.parse, urllib.request

GRAPH = 'https://graph.facebook.com/v25.0'
MAIN, CLINICS = '1461510652560252', '1953329202322425'
STOP = 'Reply STOP to stop these messages'
STOP_HI = 'ये संदेश रोकने के लिए STOP भेजें'
APP_ID = '2239815556798206'
# The picture Meta is shown as a sample for a picture template, and the one a preview sends.
SAMPLE_PICTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'logo-tight.png')
SAMPLE_PICTURE_URL = 'https://www.sehatsandhi.com/logo-tight.png'
PICTURE_HEADER = {'type': 'HEADER', 'format': 'IMAGE'}
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

def broadcast_hi(name, category, text, *examples):
    """The Hindi twin of a broadcast: the same name at Meta, language 'hi' (0235)."""
    return dict(name=name, language='hi', category=category, components=body(text, 'फ़ैमिली हेल्थ क्लिनिक', *examples, footer=STOP_HI))

def picture(language, text, example, footer):
    """A broadcast with the clinic's own picture above its words (0235)."""
    return dict(name='clinic_image', language=language, category='MARKETING',
                components=[dict(PICTURE_HEADER)] + body(text, 'Family Health Clinic' if language == 'en' else 'फ़ैमिली हेल्थ क्लिनिक', example, footer=footer))

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
        # A clinic asks its own patient for a review, from its panel, on its wallet (0232).
        dict(name='rating_request', language='hi', category='UTILITY', components=body(
            'नमस्ते {{1}} 🙏 {{2}} के साथ {{3}} की आपकी विज़िट कैसी रही? 1 (खराब) से 5 (बहुत अच्छा) तक एक नंबर भेजें। आपकी रेटिंग दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद करती है।',
            'Sunita', 'Dr. Anita Verma', '20 सितंबर')),
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
        # 0235: the same nine in Hindi.
        broadcast_hi('appointment_reminder', 'UTILITY', 'नमस्ते, {{1}} की ओर से। यह आपकी फ़ॉलो-अप विज़िट बुक करने का रिमाइंडर है। {{2}} बुक करने के लिए यहीं जवाब दें या हमें कॉल करें।', 'आपका चेक-अप इस महीने होना है।'),
        broadcast_hi('clinic_notice', 'MARKETING', 'नमस्ते, {{1}} की ओर से। कृपया ध्यान दें: {{2}} धन्यवाद।', '2 अक्टूबर को गांधी जयंती पर क्लिनिक बंद रहेगा।'),
        broadcast_hi('health_camp', 'MARKETING', 'नमस्ते, {{1}} की ओर से। हम {{2}} का आयोजन कर रहे हैं — {{3}}, स्थान: {{4}}। आप सभी का स्वागत है।', 'मुफ़्त आँखों की जाँच शिविर', 'रविवार 12 अक्टूबर, सुबह 10 से दोपहर 2 बजे', 'जगाधरी रोड पर हमारा क्लिनिक'),
        broadcast_hi('new_service', 'MARKETING', 'नमस्ते, {{1}} की ओर से। अब हमारे यहाँ {{2}} की सुविधा उपलब्ध है। अधिक जानकारी या बुकिंग के लिए यहीं जवाब दें।', 'हर शनिवार फिजियोथेरेपी'),
        broadcast_hi('health_advice', 'MARKETING', 'सेहत की सलाह, {{1}} की ओर से: {{2}} स्वस्थ रहें।', 'बरसात में पानी उबालकर पिएँ।'),
        broadcast_hi('festival_greeting', 'MARKETING', 'नमस्ते, {{1}} की ओर से। आपको और आपके परिवार को {{2}} की हार्दिक शुभकामनाएँ। {{3}} सादर।', 'दिवाली', 'यह पर्व आपके जीवन में सेहत और खुशियाँ लाए।'),
        broadcast_hi('new_speciality', 'MARKETING', 'नमस्ते, {{1}} की ओर से। हमारे यहाँ अब {{2}} शुरू हो गया है। {{3}} अधिक जानकारी या बुकिंग के लिए यहीं जवाब दें।', 'त्वचा रोग (स्किन) ओपीडी', 'सोमवार से शनिवार, सुबह 10 से दोपहर 1 बजे तक।'),
        broadcast_hi('new_doctor', 'MARKETING', 'नमस्ते, {{1}} की ओर से। {{2}} ({{3}}) हमारे साथ जुड़ गए हैं और {{4}} उपलब्ध हैं। अपॉइंटमेंट के लिए यहीं जवाब दें।', 'डॉ. अनीता वर्मा', 'एमडी, त्वचा रोग विशेषज्ञ', 'सोमवार से शुक्रवार, शाम 5 से 8 बजे'),
        broadcast_hi('clinic_message', 'MARKETING', 'संदेश, {{1}} की ओर से: {{2}} बुकिंग या किसी सवाल के लिए यहीं जवाब दें।', 'हमारा क्लिनिक 15 अक्टूबर से उसी बिल्डिंग की पहली मंज़िल पर आ गया है।'),
        # 0235: a picture the clinic uploads, with its words under it.
        picture('en', 'A message from {{1}}: {{2}} To book or to ask a question, reply here.', 'Free eye check-up camp this Sunday, 10 am to 2 pm. Details are in the picture.', STOP),
        picture('hi', 'संदेश, {{1}} की ओर से: {{2}} बुकिंग या किसी सवाल के लिए यहीं जवाब दें।', 'इस रविवार सुबह 10 से 2 बजे तक मुफ़्त आँखों की जाँच शिविर। जानकारी तस्वीर में है।', STOP_HI),
    ],
}
NAMES = {MAIN: 'MAIN  (+91 70153 99355)', CLINICS: 'CLINICS  (+91 79886 20804)'}
# Which number sends each account's templates; and Meta's test number with its own account.
PHONE_IDS = {MAIN: '1302831736238429', CLINICS: '1347090528485985'}
# 0242: the same broadcasts laid out for WhatsApp — the clinic's name in bold on
# top, each detail on its own line, a few emoji. A new name ('…_2') beside the
# plain one, so the plain one keeps working until Meta approves its successor.
RESTYLED = {
    ('appointment_reminder', 'en'): '🏥 *{{1}}*\n\nNamaste 🙏 This is a reminder to book your follow-up visit.\n\n📋 {{2}}\n\nReply here or call us to book.',
    ('clinic_notice', 'en'): '📢 *{{1}}*\n\nNamaste 🙏 Please note:\n\n{{2}}\n\nThank you.',
    ('health_camp', 'en'): '🏥 *{{1}}*\n\nNamaste 🙏 You are invited to our *{{2}}*.\n\n🗓 {{3}}\n📍 {{4}}\n\nAll are welcome.',
    ('new_service', 'en'): '✨ *{{1}}*\n\nNamaste 🙏 We now offer:\n\n✅ {{2}}\n\nReply here to know more or to book.',
    ('health_advice', 'en'): '🌿 *Health tip from {{1}}*\n\n{{2}}\n\nStay well 🙏',
    ('festival_greeting', 'en'): '🎉 *{{1}}*\n\nNamaste 🙏 Wishing you and your family a very happy *{{2}}*!\n\n{{3}}\n\nWarm regards 🌸',
    ('new_speciality', 'en'): '🏥 *{{1}}*\n\nNamaste 🙏 We have added *{{2}}* at our clinic.\n\n🕒 {{3}}\n\nReply here to know more or to book.',
    ('new_doctor', 'en'): '🩺 *{{1}}*\n\nNamaste 🙏 *{{2}}* ({{3}}) has joined us.\n\n🕒 Available: {{4}}\n\nReply here to book an appointment.',
    ('clinic_message', 'en'): '💬 *{{1}}*\n\n{{2}}\n\nTo book or to ask a question, reply here 🙏',
    ('clinic_image', 'en'): '💬 *{{1}}*\n\n{{2}}\n\nTo book or to ask a question, reply here 🙏',
    ('appointment_reminder', 'hi'): '🏥 *{{1}}*\n\nनमस्ते 🙏 यह आपकी फ़ॉलो-अप विज़िट बुक करने का रिमाइंडर है।\n\n📋 {{2}}\n\nबुक करने के लिए यहीं जवाब दें या हमें कॉल करें।',
    ('clinic_notice', 'hi'): '📢 *{{1}}*\n\nनमस्ते 🙏 कृपया ध्यान दें:\n\n{{2}}\n\nधन्यवाद।',
    ('health_camp', 'hi'): '🏥 *{{1}}*\n\nनमस्ते 🙏 आप हमारे *{{2}}* में आमंत्रित हैं।\n\n🗓 {{3}}\n📍 {{4}}\n\nआप सभी का स्वागत है।',
    ('new_service', 'hi'): '✨ *{{1}}*\n\nनमस्ते 🙏 अब हमारे यहाँ यह सुविधा उपलब्ध है:\n\n✅ {{2}}\n\nअधिक जानकारी या बुकिंग के लिए यहीं जवाब दें।',
    ('health_advice', 'hi'): '🌿 *सेहत की सलाह — {{1}}*\n\n{{2}}\n\nस्वस्थ रहें 🙏',
    ('festival_greeting', 'hi'): '🎉 *{{1}}*\n\nनमस्ते 🙏 आपको और आपके परिवार को *{{2}}* की हार्दिक शुभकामनाएँ!\n\n{{3}}\n\nसादर 🌸',
    ('new_speciality', 'hi'): '🏥 *{{1}}*\n\nनमस्ते 🙏 हमारे यहाँ अब *{{2}}* शुरू हो गया है।\n\n🕒 {{3}}\n\nअधिक जानकारी या बुकिंग के लिए यहीं जवाब दें।',
    ('new_doctor', 'hi'): '🩺 *{{1}}*\n\nनमस्ते 🙏 *{{2}}* ({{3}}) हमारे साथ जुड़ गए हैं।\n\n🕒 उपलब्ध: {{4}}\n\nअपॉइंटमेंट के लिए यहीं जवाब दें।',
    ('clinic_message', 'hi'): '💬 *{{1}}*\n\n{{2}}\n\nबुकिंग या किसी सवाल के लिए यहीं जवाब दें 🙏',
    ('clinic_image', 'hi'): '💬 *{{1}}*\n\n{{2}}\n\nबुकिंग या किसी सवाल के लिए यहीं जवाब दें 🙏',
}
for _t in list(TEMPLATES[CLINICS]):
    _new = RESTYLED.get((_t['name'], _t['language']))
    if _new:
        # Meta wants one category per name across languages: take the English one's.
        _cat = next((x['category'] for x in TEMPLATES[CLINICS] if x['name'] == _t['name'] and x['language'] == 'en'), _t['category'])
        TEMPLATES[CLINICS].append({**_t, 'name': _t['name'] + '_2', 'category': _cat,
                                   'components': [({**c, 'text': _new} if c['type'] == 'BODY' else c) for c in _t['components']]})

TEST, TEST_PHONE_ID = '28803655879267940', '1441687965687612'

def to_send(t, to):
    """The message that sends template `t` to `to`, filled with its own sample words."""
    comps = []
    if t['category'] == 'AUTHENTICATION':
        comps = [{'type': 'body', 'parameters': [{'type': 'text', 'text': '123456'}]},
                 {'type': 'button', 'sub_type': 'url', 'index': 0, 'parameters': [{'type': 'text', 'text': '123456'}]}]
    else:
        b = [c for c in t['components'] if c['type'] == 'BODY'][0]
        ex = b.get('example', {}).get('body_text', [[]])[0]
        if any(c.get('format') == 'IMAGE' for c in t['components']):
            comps.append({'type': 'header', 'parameters': [{'type': 'image', 'image': {'link': SAMPLE_PICTURE_URL}}]})
        if ex: comps.append({'type': 'body', 'parameters': [{'type': 'text', 'text': x} for x in ex]})
    return {'messaging_product': 'whatsapp', 'to': to, 'type': 'template',
            'template': {'name': t['name'], 'language': {'code': t['language']}, 'components': comps}}

def main():
    only_status = len(sys.argv) > 1 and sys.argv[1] == 'status'
    preview = len(sys.argv) > 2 and sys.argv[1] == 'preview'
    on_test = preview and len(sys.argv) > 3 and sys.argv[3] == 'test'
    to = '91' + ''.join(ch for ch in (sys.argv[2] if preview else '') if ch.isdigit())[-10:]
    if preview and len(to) != 12:
        print('Give the 10-digit phone to send to:  preview 98XXXXXXXX [test]'); return
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

    handle = {}
    def with_picture(t):
        """A picture template needs a sample picture's handle: upload it to Meta once, then fill it in."""
        if not any(c.get('format') == 'IMAGE' for c in t['components']): return t
        if 'h' not in handle:
            data = open(SAMPLE_PICTURE, 'rb').read()
            sess = call('POST', f'{APP_ID}/uploads', query={'file_name': 'sample.png', 'file_length': len(data), 'file_type': 'image/png'})
            if 'id' not in sess: return {'error': {'message': 'the sample picture could not be uploaded: ' + why(sess)}}
            req = urllib.request.Request(f"{GRAPH}/{sess['id']}", method='POST', data=data,
                                         headers={'Authorization': f'OAuth {token}', 'file_offset': '0'})
            try:
                with urllib.request.urlopen(req, timeout=60) as r: up = json.load(r)
            except urllib.error.HTTPError as e:
                try: up = json.load(e)
                except Exception: up = {'error': {'message': f'HTTP {e.code}'}}
            except Exception as e:
                up = {'error': {'message': str(e)}}
            if 'h' not in up: return {'error': {'message': 'the sample picture could not be uploaded: ' + why(up)}}
            handle['h'] = up['h']
        return {**t, 'components': [({**c, 'example': {'header_handle': [handle['h']]}} if c.get('format') == 'IMAGE' else c) for c in t['components']]}

    def why(r):
        e = r.get('error', {})
        return ' — '.join(str(x) for x in (e.get('error_user_title'), e.get('error_user_msg') or e.get('message')) if x)

    if preview:
        if on_test:
            # One of each name, created in the test account if missing, sent from the test number.
            seen, plan = set(), []
            for ts in TEMPLATES.values():
                for t in ts:
                    if (t['name'], t['language']) not in seen: seen.add((t['name'], t['language'])); plan.append(t)
            groups = [(TEST, TEST_PHONE_ID, 'TEST number (free)', plan)]
        else:
            groups = [(w, PHONE_IDS[w], NAMES[w] + ' — real messages, billed by Meta', ts) for w, ts in TEMPLATES.items()]
        for waba, phone_id, label, wanted in groups:
            print(f'\n── {label} → +{to} ──')
            have = call('GET', f'{waba}/message_templates', query={'fields': 'name,language,status', 'limit': 200})
            if 'error' in have:
                print('  ✗ could not read this account:', why(have)); continue
            there = {(t['name'], t['language']): t['status'] for t in have.get('data', [])}
            for t in wanted:
                key = (t['name'], t['language'])
                if key not in there and on_test:
                    ready = with_picture(t)
                    r = ready if 'error' in ready else call('POST', f'{waba}/message_templates', ready)
                    if 'error' in r:
                        print(f"  ✗ {t['name']:22} could not be created in the test account: {why(r)}"); continue
                    there[key] = r.get('status', 'PENDING')
                if there.get(key) != 'APPROVED':
                    print(f"  … {t['name']:22} {there.get(key, 'missing')} — not sent; run this again once Meta approves it"); continue
                r = call('POST', f'{phone_id}/messages', to_send(t, to))
                print(f"  ✓ {t['name']:22} sent" if 'error' not in r else f"  ✗ {t['name']:22} not sent: {why(r)}")
        print('\nCopy everything from the first "──" line down and send it. It contains no secret.')
        return

    for waba, wanted in TEMPLATES.items():
        print(f'\n── {NAMES[waba]} ──')
        have = call('GET', f'{waba}/message_templates', query={'fields': 'name,language,status,category,rejected_reason', 'limit': 200})
        if 'error' in have:
            print('  ✗ could not read this account:', why(have)); continue
        there = {(t['name'], t['language']): t for t in have.get('data', [])}
        for t in wanted:
            key = (t['name'], t['language'])
            if key not in there and not only_status:
                ready = with_picture(t)
                r = ready if 'error' in ready else call('POST', f'{waba}/message_templates', ready)
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
