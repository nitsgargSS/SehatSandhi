# WhatsApp bot flow — as built in AiSensy

Read out of AiSensy's flow builder on 2026-10-09 (project "NG Technologies",
flow "Main Flow Sehatsandhi", id `6a7d6201fa4b7c0f1e4643bd`, 48 steps, status
Active / "Testing only"). This is the reference for rebuilding the flow in our
own code. Message texts are verbatim. API keys are left out.

## Variables

AiSensy keeps these per contact. The flow reuses them as scratch space, so the
name does not always say what is in it.

| Variable | Holds |
|---|---|
| `speciality_code` | speciality code, or the service kind (`lab_booking`, `lab_callback`, `pharmacy`, `ambulance`, `camps`) |
| `Pincode` | what the patient typed for city / PIN |
| `Selection` | the search result text, then the number the patient picked |
| `SlotSelection` | the search `route`, then the slots text, then the slot the patient picked |
| `Customername` | the slots `route`, then the slot-check result, then "name, age", then the booking result text |
| `MobileNumber` | the patient's WhatsApp number (AiSensy built-in) |

## Trigger

Keywords (case sensitive): `HI`, `HELLO`, `NAMASTE`, `HELP`, `DOCTOR`, `LAB`,
`PHARMACY`, `AMBULANCE`, `INSURANCE`, `HOSPITAL` → **MAIN_MENU**

## Steps

### MAIN_MENU (list message)

- Header: `Sehatsandhi`
- Body:

  ```
   नमस्ते! 🙏
  Sehatsandhi में आपका स्वागत है —आपके एरिया के
  वेरिफाइड डॉक्टरों, फार्मेसी, लैब, एम्बुलेंस और इंश्योरेंस
  से जुड़ें, बिल्कुल फ्री।

  आपको क्या चाहिए?
  ```
- Footer: `Please select one option`
- Section title: `Please select one option`

| Row title | Description | Goes to |
|---|---|---|
| 🩺 डॉक्टर खोजें | Find a Doctor — verified, instant booking | SPECIALITY_MENU |
| 🔬 डायग्नोस्टिक लैब | Diagnostic — MRI, CT Scan, ultrasound,Blood Test, home sample collection | TEST_TYPE_MENU |
| 💊 मेडिसिन ऑर्डर करें | Order Medicine — home delivery | set `speciality_code=pharmacy` → ASK_PIN |
| 🚑 एम्बुलेंस | Ambulance — help, anytime | set `speciality_code=ambulance` → ASK_PIN |
| 🛡️ इंश्योरेंस | Insurance — free home visit | ASK_PIN_INSURANCE |
| 🎉 कैंप्स & ऑफर्स | Camps & Offers near you | set `speciality_code=camps` → ASK_PIN |

### TEST_TYPE_MENU (list message)

- Header: `टेस्ट टाइप/Test Type`
- Body: `कौनसा टेस्ट चाहिए?\nPlease select Test Type`
- Section title: `Please select one option`

| Row title | Description | Sets `speciality_code` |
|---|---|---|
| 🩸 ब्लड टेस्ट | Blood Test — sugar, thyroid, CBC & more | `lab_booking` |
| 🧠 MRI | MRI Scan — all body parts | `lab_booking` |
| 📷 CT स्कैन | CT Scan — fast reporting | `lab_booking` |
| 🦴 X-Ray | X-Ray — same day results | `lab_booking` |
| 🔊 अल्ट्रासाउंड/Ultrasou | Ultrasound — pregnancy & abdomen scans | `lab_booking` |
| 📋 अन्य टेस्ट | Other Test — tell us what you need | `lab_callback` |

All rows then go to ASK_PIN. The test type itself is not kept.

### SPECIALITY_MENU (list message)

- Header: `स्पेशलिटी चुनें`
- Body: `बढ़िया! किस तरह के डॉक्टर की तलाश है? 👇`
- Footer: `100% वेरिफाइड डॉक्टर`
- Section title: `Choose one speciality:`

| Row title | Description | Sets `speciality_code` |
|---|---|---|
| 🧴 त्वचा रोग | Skin (Dermatology) | `SKIN` |
| 🦷 डेंटल | Dental | `DENT` |
| 👁️ आंख | Eye (Ophthalmology) | `EYE` |
| 👶 बच्चों का डॉक्टर | Child Specialist | `PAED` |
| 👩 स्त्री रोग | Gynaecology / Maternity | `GYN` |
| 🦴 हड्डी रोग | Orthopaedics / Bones | `ORTH` |
| 👂 कान-नाक-गला | ENT (Ear Nose Throat) | `ENT` |
| जनरल फिजिशियन | General Physician | `GEN` |
| अन्य स्पेशलिटी | More Specialities | → MORE_SPECIALITY_MENU |

### MORE_SPECIALITY_MENU (list message)

- Header: `अन्य स्पेशलिटी`
- Body: `ये स्पेशलिटीज़ भी उपलब्ध हैं:`
- Footer: `100% वेरिफाइड डॉक्टर`
- Section title: `Please choose one option`

| Row title | Description | Sets `speciality_code` |
|---|---|---|
| 🤰 IVF/फर्टिलिटी | IVF / Fertility | `IVF` |
| ❤️ हृदय रोग | Heart (Cardiology) | `CARD` |
| 🫃 पेट रोग | Gastro / Stomach | `GAST` |
| 🧠 न्यूरो | Neuro / Brain & Spine | `NEUR` |
| 🩺 किडनी रोग | Urology / Kidney | `URO` |
| 🎗️ कैंसर रोग | Oncology / Cancer | `ONC` |
| 🧘 मानसिक स्वास्थ्य | Psychiatry / Mental Health | `PSY` |
| 💉 डायबिटीज़ | Diabetologist | `DIAB` |
| 🏃 फिजियोथेरेपी | Physiotherapy | `PHYS` |
| 🌿 आयुर्वेद-होम्योपैथी | Ayurveda / Homeopathy | `ALT` |

Every speciality row goes to ASK_PIN.

### ASK_PIN (question → `Pincode`)

`अपना शहर का नाम या PIN कोड भेजें 📍` → SEARCH

### SEARCH (API)

`POST /rest/v1/rpc/bot_generic_search_json`

```json
{ "p_type": "doctor", "p_filter_value": "<speciality_code>", "p_pincode": "<Pincode>" }
```

`p_type` is always `"doctor"`; the service kind travels in `p_filter_value`.
Response `text` → `Selection`, `route` → `SlotSelection`. Then:

- `route == "list"` → **ASK_SELECTION**
- `route == "info"` → **INFO** (buttons)
- anything else → send `text` as a question, save the reply to `Pincode`, and
  run SEARCH again

### INFO (button message)

Body: the search `text`. Buttons: `🏠 Main Menu` → MAIN_MENU,
`📍 दूसरा PIN कोड. ` → ASK_PIN.

### ASK_SELECTION (question → `Selection`)

```
<search text>

कौनसे नंबर वाले डॉक्टर/सेंटर के साथ बुक करना चाहेंगे? नंबर बताएं (1, 2, 3 ....)
```

→ SLOTS

### SLOTS (API)

`POST /rest/v1/rpc/bot_available_slots_json`

```json
{ "p_speciality": "<speciality_code>", "p_pincode": "<Pincode>", "p_selection": "<Selection>", "p_type": "doctor" }
```

Response `text` → `SlotSelection`, `route` → `Customername`. Then:

- `route == "slots"` → **ASK_SLOT**
- anything else → send `text` as a question, save the reply to `Selection`, and
  run SLOTS again

### ASK_SLOT (question → `SlotSelection`)

```
<slots text>

कौनसा स्लॉट चुनना चाहेंगे?
```

→ CHECK_SLOT

### CHECK_SLOT (API)

`POST /rest/v1/rpc/bot_check_slot_json`

```json
{ "p_speciality": "<speciality_code>", "p_pincode": "<Pincode>", "p_selection": "<Selection>", "p_slot_selection": "<SlotSelection>", "p_type": "doctor" }
```

Response `text` → `Customername`. Then:

- `text == "ok"` → **ASK_NAME_AGE**
- anything else → send `text` as a question, save the reply to `SlotSelection`,
  and run CHECK_SLOT again

### ASK_NAME_AGE (question → `Customername`)

`मरीज़ का नाम और उम्र बताएं (जैसे: Sunita, 34)` → BOOK

### BOOK (API)

`POST /rest/v1/rpc/bot_book_appointment_json`

```json
{ "p_speciality": "<speciality_code>", "p_pincode": "<Pincode>", "p_selection": "<Selection>", "p_patient_info": "<Customername>", "p_slot_selection": "<SlotSelection>", "p_phone": "<MobileNumber>", "p_type": "doctor" }
```

Response `text` → shown in a button message with one button `🏠 Main Menu` →
MAIN_MENU.

### ASK_PIN_INSURANCE (question → `Pincode`)

`अपना शहर का नाम या PIN कोड भेजें 📍` → INSURANCE_LEAD

### INSURANCE_LEAD (API)

`POST /rest/v1/rpc/bot_submit_insurance_lead_json`

```json
{ "p_phone": "<MobileNumber>", "p_pincode": "<Pincode>" }
```

Response `text` → shown in a button message with one button `🏠 Main Menu` →
MAIN_MENU.

## Notes for the rebuild

- Every question allows one attempt, any format; validation is done by the
  RPCs, which answer with a retry text.
- The five API calls above are all of them (the plan caps a flow at five).
- No fallback intents are configured on the flow.
- Two other flows exist and are switched off: "Main Flow Sehatsandhi copy" and
  "Untitled".

## Added after the rebuild: one clinic's patients (0224)

Not part of the AiSensy flow. In `_shared/bot.ts`:

- **A clinic's code in the message** (`SS-XXXXX` — its QR and slip link type it)
  → that clinic's menu, on either number: `📅 अपॉइंटमेंट बुक` (its doctors;
  with one doctor, straight to the times), `🔔 अपडेट पाएं` (agree to hear from
  it — `bot_clinic_optin`), `🔎 और डॉक्टर खोजें` (MAIN_MENU), and its phone
  number to ring.
- **On the clinic line** (the second number), with no code: the clinic whose
  message was replied to; else the only clinic in touch with this number; else,
  of several, the one in touch within twelve hours if it is the only such;
  else a list to choose from. Nobody in touch → MAIN_MENU.
  `sehat_wa_clinic_line` decides.
- `🏠 Main Menu` on the clinic line returns to the clinic's menu until the
  patient asks for `🔎 और डॉक्टर खोजें`; a greeting returns to the clinic.
- Booking uses the same SEARCH / SLOTS / CHECK_SLOT / BOOK calls with the
  clinic's code as both speciality and area.
