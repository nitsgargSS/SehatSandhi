# WhatsApp templates to create in Meta

Messages Sehatsandhi starts (a login code, a bill, an appointment change) must
use a template Meta has approved. This lists each one the code sends, with the
wording and the variable order the code expects. Create them in
business.facebook.com → WhatsApp Manager → Message templates → Create template,
on the **Sehatsandhi** WhatsApp account that holds +91 70153 99355.

For every template below: **Category** as stated, **Language** English, no
header, no footer, no buttons, unless it says otherwise. Paste the body exactly;
`{{1}}`, `{{2}}`… are the variables, in this order. Meta asks for a sample value
for each variable — use the ones given.

After a template is approved, add the secret shown with it in Supabase (Edge
Functions → Secrets). The value is the template name. If WhatsApp Manager shows
the language as "English (US)" rather than "English", write the value as
`name:en_US`.

## 1. `login_code` — already approved

Authentication. Nothing to create. Used for clinic login, phone verification at
signup, and patient login in the app.

Secret (optional, this is the default): `META_LOGIN_TEMPLATE=login_code`

## 2. `appointment_update`

Utility. Sent to a patient when an appointment is confirmed, moved or cancelled
and to ask for a rating; and to a clinic when one is booked, moved or cancelled.
The code writes the sentence and sends it as the one variable.

```
Sehatsandhi appointment update:

{{1}}

Reply to this message if you need any help.
```

Sample `{{1}}`: `Your appointment with Dr. Anita Verma on Fri 10 Oct, 4:30 PM is confirmed. See you then.`

Secret: `META_APPOINTMENT_TEMPLATE=appointment_update`

Meta sometimes rejects a template whose content is mostly one variable. If this
one is rejected, the fix is one template per event (confirmed, moved, cancelled,
rating, new booking) and a change in `appointment-notify` to pick between them.

## 3. `invoice_link`

Utility. Sent to a business with its Sehatsandhi invoice.

```
Your Sehatsandhi invoice {{1}} for {{2}} is ready. View and download it here: {{3}}

Thank you for being with Sehatsandhi.
```

Samples: `{{1}}` `SS/2026-27/0041` · `{{2}}` `₹1,180.00` · `{{3}}` `https://www.sehatsandhi.com/invoice/abc123`

Secret: `META_INVOICE_TEMPLATE=invoice_link`

## 4. `staff_invite`

Utility. Sent to a staff member a clinic has added.

```
Hello {{1}}, {{2}} has added you to their team on Sehatsandhi. Open this link to set up your login: {{3}}

If you do not work there, please ignore this message.
```

Samples: `{{1}}` `Pooja Saini` · `{{2}}` `Aggarwal Clinic` · `{{3}}` `https://www.sehatsandhi.com/join/abc123`

Secret: `META_STAFF_INVITE_TEMPLATE=staff_invite`

## 5. `prescription_link`

Utility. Sent to a patient when a doctor issues a prescription.

```
Hello {{1}}, your prescription from {{2}} is ready. View it here: {{3}}

This link is private to you. Please do not share it.
```

Samples: `{{1}}` `Sunita Devi` · `{{2}}` `Family Health Clinic` · `{{3}}` `https://www.sehatsandhi.com/rx/abc123`

Secret: `META_PRESCRIPTION_TEMPLATE=prescription_link`

## 6. `bill_link`

Utility. Sent to a patient with a clinic's bill.

```
Hello {{1}}, your bill from {{2}} is ready. View it here: {{3}}

This link is private to you. Please do not share it.
```

Samples: as for the prescription, with a `/bill/` link.

Secret: `META_BILL_TEMPLATE=bill_link`

## 7. `lab_report_link`

Utility. Sent to a patient when a lab report is ready.

```
Hello {{1}}, your report from {{2}} is ready. View it here: {{3}}

This link is private to you. Please do not share it.
```

Samples: `{{1}}` `Sunita Devi` · `{{2}}` `City Diagnostics` · `{{3}}` `https://www.sehatsandhi.com/report/abc123`

Secret: `META_LAB_REPORT_TEMPLATE=lab_report_link`

## 8. `discharge_link`

Utility. Sent to a patient with a hospital's discharge summary.

```
Hello {{1}}, your discharge summary from {{2}} is ready. View it here: {{3}}

This link is private to you. Please do not share it.
```

Samples: `{{1}}` `Sunita Devi` · `{{2}}` `Yamuna City Hospital` · `{{3}}` `https://www.sehatsandhi.com/discharge/abc123`

Secret: `META_DISCHARGE_TEMPLATE=discharge_link`

## Clinic broadcast templates

These are the messages a clinic picks from in its WhatsApp tab (the library in
`wa_message_templates`). Create each one in WhatsApp Manager under the same
name as its code, Language English, with this footer on every one:
`Reply STOP to stop these messages`. `{{1}}` is always the clinic's name, put
in by Sehatsandhi; the clinic fills the rest.

Meta decides the category itself and may move a "utility" one to marketing.
Once Meta approves a template, tick **Approved** for it in Admin → WhatsApp
marketing → Templates; clinics cannot use it before that. If the name in
WhatsApp Manager has to differ from the code, put it in the template's
`meta_name` column.

| Code | Submit as | Body |
|---|---|---|
| `appointment_reminder` | Utility | `Namaste from {{1}}. This is a reminder to book your follow-up visit. {{2}} To book, reply here or call us.` |
| `clinic_notice` | Utility | `Namaste from {{1}}. Please note: {{2}}` |
| `health_camp` | Marketing | `Namaste from {{1}}. We are holding a {{2}} on {{3}} at {{4}}. Everyone is welcome.` |
| `new_service` | Marketing | `Namaste from {{1}}. We now offer {{2}}. Reply here to know more or to book.` |
| `health_advice` | Marketing | `Health tip from {{1}}: {{2}}` |
| `festival_greeting` | Marketing | `Namaste from {{1}}. Wishing you and your family a very happy {{2}}. {{3}}` |
| `new_speciality` | Marketing | `Namaste from {{1}}. We have added {{2}} at our clinic. {{3}} Reply here to know more or to book.` |
| `new_doctor` | Marketing | `Namaste from {{1}}. {{2}} ({{3}}) has joined us and is available {{4}}. Reply here to book an appointment.` |
| `clinic_message` | Marketing | `A message from {{1}}: {{2}} To book or to ask a question, reply here.` |

Sample values to give Meta:

- `{{1}}` everywhere: `Family Health Clinic`
- `appointment_reminder` `{{2}}`: `Your check-up is due this month.`
- `clinic_notice` `{{2}}`: `The clinic is closed on 2 Oct for Gandhi Jayanti.`
- `health_camp`: `free eye check-up camp` · `Sunday 12 Oct, 10 am to 2 pm` · `our clinic on Jagadhri Road`
- `new_service` `{{2}}`: `physiotherapy on Saturdays`
- `health_advice` `{{2}}`: `Drink boiled water during the monsoon.`
- `festival_greeting`: `Diwali` · `May it bring you good health and joy.`
- `new_speciality`: `a skin (dermatology) OPD` · `Open Monday to Saturday, 10 am to 1 pm.`
- `new_doctor`: `Dr. Anita Verma` · `MD, skin specialist` · `Monday to Friday, 5 pm to 8 pm`
- `clinic_message` `{{2}}`: `Our clinic has moved to the first floor of the same building from 15 October.`

Three of these end in a variable or are mostly one free-text variable
(`clinic_notice`, `health_advice`, `festival_greeting`), which Meta sometimes
rejects. If one is rejected, add a fixed closing line to its body here and in
the library (for example "Thank you.") and resubmit.

A variable cannot hold a line break; the sender joins a clinic's text into one
line before it goes.

## Switching the sends to Meta

With the templates approved and their secrets set, these two secrets move every
send above from AiSensy to Meta:

- `META_PHONE_NUMBER_ID` — the main number (live: `1302831736238429`): login codes, booking messages
- `META_CLINIC_PHONE_NUMBER_ID` — the second number: everything a clinic sends its patients (documents and broadcasts)
- `WA_PROVIDER=meta`

`META_ACCESS_TOKEN` is the same token the bot uses.

## Sent by the database: rating request and order messages (0220)

Two messages are sent by the database itself. Both are Hindi: choose Language
**Hindi** for them.

### `rating_request`

Utility. Three hours after a visit, from the main number.

```
नमस्ते {{1}} 🙏 {{2}} के साथ {{3}} की आपकी विज़िट कैसी रही? 1 (खराब) से 5 (बहुत अच्छा) तक एक नंबर भेजें। आपकी रेटिंग दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद करती है।
```

Samples: `{{1}}` `Sunita` · `{{2}}` `Dr. Anita Verma` · `{{3}}` `20 सितंबर`

### `order_update`

Utility. A pharmacy's message about a medicine order, from the second number.

```
Sehatsandhi पर आपका दवाई ऑर्डर:

{{1}}

कोई सवाल हो तो यहीं जवाब दें।
```

Sample `{{1}}`: `24x7 Chemist ने आपका ऑर्डर देख लिया है। कुल ₹240, डिलीवरी शाम 6 बजे तक।`

### Switching these two to Meta

They do not read the edge functions' secrets; the database keeps its own, in
its Vault. In the SQL editor, once, with your own values in place of the
words in capitals (do not save this query):

```sql
select vault.create_secret('THE SYSTEM USER TOKEN', 'meta_access_token');
select vault.create_secret('MAIN NUMBER PHONE ID', 'meta_phone_number_id');
select vault.create_secret('SECOND NUMBER PHONE ID', 'meta_clinic_phone_number_id');
```

Then, when both templates are approved:

```sql
update messaging_settings set provider = 'meta', rating_campaign = 'rating_request', order_campaign = 'order_update';
```

`rating_sending_enabled` and `order_sending_enabled` on the same row are the
on/off switches, as before.
