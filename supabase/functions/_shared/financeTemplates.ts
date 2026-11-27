// Treatment on EMI's WhatsApp templates (0344) — from Sehatsandhi's main
// number, so they live in OUR messaging account only (wa-connect's
// house-templates creates them there). Utility: each is about a request the
// patient made, or an alert to a hospital or lender about a case it is part
// of. Links sit in the body (no buttons), and no body ends on a variable —
// Meta refuses that.
//
// These replace the five drafted in docs/whatsapp-templates.md on 17 Nov
// (never submitted): one patient "status" template now carries every update,
// and hospital and lender each get one alert template.

import type { ClinicTemplate } from './clinicTemplates.ts'

export const FINANCE_TEMPLATES: ClinicTemplate[] = [
  {
    // To the patient: the hospital has set up (or confirmed) the request.
    name: 'emi_request_link', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, {{2}} has set up your request to pay for {{3}} in EMIs (loan of {{4}}).\n\nOpen this link to choose a lender and give your consent: {{5}}\n\nThe loan is given by the lender you choose. Sehatsandhi does not charge you anything.',
    samples: ['Ramesh', 'Yamuna City Hospital', 'Knee replacement', '₹1,20,000', 'https://www.sehatsandhi.com/emi/4538beedb9f3fffaa64ffdc1'],
  },
  {
    // To the patient: any later step (offer, sanction, payout, closed).
    name: 'emi_status', language: 'en', category: 'UTILITY',
    body: 'Update on your EMI request {{1}} for treatment at {{2}}:\n\n{{3}}\n\nSee the full status here: {{4}}\n\nReply to this message if you need help.',
    samples: ['EMI-000041', 'Yamuna City Hospital',
              'Test Finance Ltd has sanctioned your loan of ₹1,20,000. They will pay the hospital once the hospital confirms your admission date.',
              'https://www.sehatsandhi.com/emi/4538beedb9f3fffaa64ffdc1'],
  },
  {
    // To the hospital (its business phone).
    name: 'emi_hospital_update', language: 'en', category: 'UTILITY',
    body: 'EMI case {{1}} for {{2}} ({{3}}): {{4}}\n\nOpen Sehatsandhi, EMI tab, to see the case. This is an automatic alert from Sehatsandhi.',
    samples: ['EMI-000041', 'Ramesh Kumar', 'Knee replacement', 'the patient has asked to pay in EMIs. Please confirm the estimate.'],
  },
  {
    // To the lender (its business phone). No patient name: lenders see only
    // what sehat_lender_cases() shows them, on their dashboard.
    name: 'emi_lender_update', language: 'en', category: 'UTILITY',
    body: 'EMI case {{1}}: {{2}} at {{3}}, loan of {{4}}. {{5}}\n\nOpen Sehatsandhi, EMI cases, to act on it. This is an automatic alert from Sehatsandhi.',
    samples: ['EMI-000041', 'Knee replacement', 'Yamuna City Hospital, Yamunanagar', '₹1,20,000', 'A patient has shared this request with you.'],
  },
]
