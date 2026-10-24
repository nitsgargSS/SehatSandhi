// The message templates every clinic's own WhatsApp account gets (0261).
//
// When a clinic connects its number, wa-connect creates these in its account
// so that everything Sehatsandhi sends for it — a prescription, a bill, a
// rating request — can go from that number. The names match the templates in
// our own account (docs/whatsapp-templates.md), so the META_*_TEMPLATE
// secrets pick the same name whichever number a message goes from.
//
// All Utility: each one is about something the patient just did at the
// clinic. The wording is the approved wording from our own account, except
// that appointment_update drops "Sehatsandhi" — it goes out in the clinic's
// own name here.

export interface ClinicTemplate {
  name: string
  language: string
  category: 'UTILITY'
  body: string
  /** One sample per {{n}}, in order — Meta will not review a template without them. */
  samples: string[]
}

const PRIVATE = '\n\nThis link is private to you. Please do not share it.'

export const CLINIC_TEMPLATES: ClinicTemplate[] = [
  {
    name: 'prescription_link', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, your prescription from {{2}} is ready. View it here: {{3}}' + PRIVATE,
    samples: ['Sunita Devi', 'Family Health Clinic', 'https://www.sehatsandhi.com/rx/abc123'],
  },
  {
    name: 'bill_link', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, your bill from {{2}} is ready. View it here: {{3}}' + PRIVATE,
    samples: ['Sunita Devi', 'Family Health Clinic', 'https://www.sehatsandhi.com/bill/abc123'],
  },
  {
    name: 'lab_report_link', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, your report from {{2}} is ready. View it here: {{3}}' + PRIVATE,
    samples: ['Sunita Devi', 'City Diagnostics', 'https://www.sehatsandhi.com/report/abc123'],
  },
  {
    name: 'discharge_link', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, your discharge summary from {{2}} is ready. View it here: {{3}}' + PRIVATE,
    samples: ['Sunita Devi', 'Yamuna City Hospital', 'https://www.sehatsandhi.com/discharge/abc123'],
  },
  {
    name: 'appointment_update', language: 'en', category: 'UTILITY',
    body: 'Appointment update:\n\n{{1}}\n\nReply to this message if you need any help.',
    samples: ['Your appointment with Dr. Anita Verma on Fri 10 Oct, 4:30 PM is confirmed. See you then.'],
  },
  {
    name: 'rating_request', language: 'hi', category: 'UTILITY',
    body: 'नमस्ते {{1}} 🙏 {{2}} के साथ {{3}} की आपकी विज़िट कैसी रही? 1 (खराब) से 5 (बहुत अच्छा) तक एक नंबर भेजें। आपकी रेटिंग दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद करती है।',
    samples: ['Sunita', 'Dr. Anita Verma', '20 सितंबर'],
  },
  // The automatic messages of the Pro plan.
  {
    name: 'welcome_patient', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, you are registered at {{2}}. Your file number is {{3}}.\n\nYour prescriptions, bills and reports from this visit will also be in the Sehatsandhi app: {{4}}',
    samples: ['Sunita Devi', 'Family Health Clinic', 'FHC-1042', 'https://www.sehatsandhi.com/app'],
  },
  {
    name: 'visit_summary', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, thank you for visiting {{2}} today.\n\nPrescription: {{3}}\nBill: {{4}}\n\nThese links are private to you. Please do not share them.',
    samples: ['Sunita Devi', 'Family Health Clinic', 'https://www.sehatsandhi.com/rx/abc123', 'https://www.sehatsandhi.com/bill/abc123'],
  },
  {
    name: 'follow_up_reminder', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, {{2}} at {{3}} asked to see you again on {{4}}. Reply to this message to book a time, or call the clinic.',
    samples: ['Sunita Devi', 'Dr. Anita Verma', 'Family Health Clinic', 'Mon 3 Nov'],
  },
]

/** The Graph API body that creates one of them. */
export function templateRequest(t: ClinicTemplate) {
  return {
    name: t.name, language: t.language, category: t.category,
    components: [{ type: 'BODY', text: t.body, example: { body_text: [t.samples] } }],
  }
}
