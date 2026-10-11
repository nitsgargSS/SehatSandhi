// The terms a clinic's owner accepts before sending WhatsApp broadcasts (0219).
//
// WA_TERMS_VERSION must match whatsapp_marketing_settings.terms_version in the
// database. To change the terms: edit the words here, give both a new version,
// and every clinic is asked to accept again before its next broadcast.
//
// Three layers, shown at three moments:
//   WA_TERMS        — accepted once, before the first broadcast (and again
//                     when the version changes).
//   TEMPLATE_RULES  — beside the template being filled in: what that kind of
//                     message may and may not say.
//   PICTURE_RULES   — when the message carries a picture: ticked each time,
//                     because a picture can say what the words do not.
//
// These are the working terms, written to be read in a minute. Have them
// checked by a lawyer before they are relied on.

export const WA_TERMS_VERSION = '2026-10-11'

export const WA_TERMS: { title: string; text: string }[] = [
  {
    title: 'Only patients who agreed',
    text: 'Messages go only to your own patients who agreed to hear from your clinic. You will not add numbers of people who did not agree, and anyone who replies STOP is never messaged again.',
  },
  {
    title: 'Sehatsandhi reads every message first',
    text: 'Each broadcast, with any picture, is read by Sehatsandhi before it goes out. We may refuse a message that is misleading, off-topic, or not from your clinic. A refused broadcast is refunded to your wallet in full, with the reason.',
  },
  {
    title: 'What you may not send',
    text: 'No promise of a cure or a guaranteed result. No advertising of prescription medicines. No message about one named patient’s health. No frightening or false health claims. No "best", "No. 1" or "only" claims about a doctor or the clinic, and no comparison with other doctors. Nothing unrelated to your clinic’s healthcare services, and nothing political or religious beyond a festival greeting.',
  },
  {
    title: 'Use the right template, in the right language',
    text: 'Each template is for one kind of message, and you fill only its blanks: a camp notice is for a camp, a festival greeting for a greeting. English and Hindi versions say the same thing; choose the language your patients read, and write your own words in that language. Each blank is one paragraph of plain text — no links to other websites, and no phone numbers other than your clinic’s.',
  },
  {
    title: 'Pictures',
    text: 'A picture you send must be your clinic’s own or one you have the right to use. It must not show a patient, a patient’s report, prescription or any personal detail, and must not be a "before and after" of treatment. The rules above apply to the words inside the picture too. Pictures are stored at a public web address so WhatsApp can deliver them — never upload anything private.',
  },
  {
    title: 'You are responsible for what you say',
    text: 'The message is yours. You confirm it is true, that you may lawfully send it, and that it follows the rules your profession sets for advertising (for doctors, the National Medical Commission’s).',
  },
  {
    title: 'What it costs',
    text: 'Each message is paid for from your WhatsApp wallet at the price shown before you send: one price for a broadcast message, and a lower one for a one-to-one message such as a prescription, a bill, a report or a request for a review. A message that is not delivered is returned to your wallet automatically. Wallet top-ups are not refundable to a bank account or card (see the Refund Policy).',
  },
  {
    title: 'Asking for reviews',
    text: 'You may ask a patient who visited you for a review. You will not ask for a particular rating, offer anything in return, or write a review on a patient’s behalf. A review is the patient’s own words.',
  },
  {
    title: 'Sent from Sehatsandhi’s number',
    text: 'Messages go from Sehatsandhi’s WhatsApp number for clinics, with your clinic’s name in the message. WhatsApp limits how many promotional messages a person receives, so a few patients may not get a given message; those are refunded.',
  },
  {
    title: 'If the rules are broken',
    text: 'If patients report or block your messages in numbers, or these terms are broken, Sehatsandhi may pause or end your clinic’s WhatsApp sending to protect the number every clinic shares.',
  },
]

/**
 * What each kind of message may say — shown beside the template while it is
 * filled in. Keyed by the template's code; a Hindi twin ('…_hi') uses the same.
 */
const TEMPLATE_RULES_BY_CODE: Record<string, string[]> = {
  appointment_reminder: [
    'Only for patients who are due a follow-up or check-up with you.',
    'Say what is due in general words ("your check-up is due this month"). Do not name a diagnosis, a test result or a medicine.',
  ],
  clinic_notice: [
    'For closures, changed timings, a new address or phone number — facts about the clinic.',
    'Not for offers or announcements; use the template made for those.',
  ],
  health_camp: [
    'The camp must be real, with its date, time and place as you write them.',
    'Say plainly what is free and what is charged. "Free check-up" must not hide a fee.',
    'No promise of diagnosis or cure at the camp.',
  ],
  new_service: [
    'Name a service your clinic actually provides now, with staff qualified to provide it.',
    'No prices that are not the real price, and no "limited time" pressure.',
  ],
  health_advice: [
    'General advice that is safe for anyone: hygiene, diet, seasonal care, when to see a doctor.',
    'No advice to start, stop or change a medicine. No claim that anything cures or prevents a disease.',
  ],
  festival_greeting: [
    'A greeting and good wishes only — no offer, price or promotion inside it.',
    'Keep it respectful to every community. No political or religious message beyond the greeting itself.',
  ],
  new_speciality: [
    'Name the speciality and its real timings. A doctor registered for that speciality must be running it.',
    'No claims of results, and no comparison with other clinics.',
  ],
  new_doctor: [
    'Use the doctor’s name and qualifications exactly as registered with the medical council.',
    'Describe what they treat, not how good they are: no "best", "famous" or "only".',
    'The doctor must have agreed to be announced.',
  ],
  clinic_message: [
    'Your own words, about your clinic’s healthcare services only.',
    'Everything in "What you may not send" applies. Sehatsandhi reads this one most closely, so a vague or promotional message may be sent back.',
  ],
  clinic_image: [
    'Your own words, about your clinic’s healthcare services only, with one picture.',
    'The picture rules below apply, and you confirm them each time.',
  ],
}

export const templateRules = (code: string | null | undefined): string[] =>
  TEMPLATE_RULES_BY_CODE[(code ?? '').replace(/_hi$/, '')] ?? []

/** Confirmed, by a tick, every time a picture is sent. */
export const PICTURE_RULES: string[] = [
  'The picture is our clinic’s own, or we have the right to use it.',
  'It shows no patient, no patient’s report or prescription, and no personal detail of anyone.',
  'It is not a "before and after" of treatment, and makes no promise of cure or result.',
  'The words inside the picture follow the same rules as a written message — no "best" or "No. 1", no prescription medicines, nothing false.',
  'We understand the picture is stored at a public web address and is read by Sehatsandhi before it goes out.',
]
