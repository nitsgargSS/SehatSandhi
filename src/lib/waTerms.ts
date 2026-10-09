// The terms a clinic's owner accepts before sending WhatsApp broadcasts (0219).
//
// WA_TERMS_VERSION must match whatsapp_marketing_settings.terms_version in the
// database. To change the terms: edit the words here, give both a new version,
// and every clinic is asked to accept again before its next broadcast.
//
// These are the working terms, written to be read in a minute. Have them
// checked by a lawyer before they are relied on.

export const WA_TERMS_VERSION = '2026-10-09'

export const WA_TERMS: { title: string; text: string }[] = [
  {
    title: 'Only patients who agreed',
    text: 'Messages go only to your own patients who agreed to hear from your clinic. You will not add numbers of people who did not agree, and anyone who replies STOP is never messaged again.',
  },
  {
    title: 'Sehatsandhi reads every message first',
    text: 'Each broadcast is read by Sehatsandhi before it goes out. We may refuse a message that is misleading, off-topic, or not from your clinic. A refused broadcast is refunded to your wallet in full, with the reason.',
  },
  {
    title: 'What you may not send',
    text: 'No promise of a cure or a guaranteed result. No advertising of prescription medicines. No message about one named patient’s health. No frightening or false health claims. Nothing unrelated to your clinic’s healthcare services, and nothing political or religious beyond a festival greeting.',
  },
  {
    title: 'You are responsible for what you say',
    text: 'The message is yours. You confirm it is true, that you may lawfully send it, and that it follows the rules your profession sets for advertising (for doctors, the National Medical Commission’s).',
  },
  {
    title: 'What it costs',
    text: 'Each message is paid for from your WhatsApp wallet at the price shown before you send. A message that is not delivered is returned to your wallet automatically. Wallet top-ups are not refundable to a bank account or card (see the Refund Policy).',
  },
  {
    title: 'Sent from Sehatsandhi’s number',
    text: 'Messages go from Sehatsandhi’s WhatsApp number with your clinic’s name at the start. WhatsApp limits how many promotional messages a person receives, so a few patients may not get a given message; those are refunded.',
  },
  {
    title: 'If the rules are broken',
    text: 'If patients report or block your messages in numbers, or these terms are broken, Sehatsandhi may pause or end your clinic’s WhatsApp sending to protect the number every clinic shares.',
  },
]
