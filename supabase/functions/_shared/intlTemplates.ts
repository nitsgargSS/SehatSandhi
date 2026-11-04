// Sehatsandhi International's WhatsApp templates (0323) — from our own number,
// so they live in OUR messaging account only (wa-connect's house-templates
// creates them there). Utility: each is about a request the patient made, or
// an alert to Sehatsandhi's own team. Meta will not approve a body that ends
// on a variable, hence the closing lines.

import type { ClinicTemplate } from './clinicTemplates.ts'

export const INTL_TEMPLATES: ClinicTemplate[] = [
  {
    name: 'intl_request_update', language: 'en', category: 'UTILITY',
    body: 'Hello {{1}}, here is an update on your Sehatsandhi International request:\n\n{{2}}\n\nSee every step of your request here: {{3}}\n\nReply to this message if you need any help.',
    samples: ['Ahmed', 'Your written quotes are ready. Your coordinator will go through them with you so you can choose.', 'https://www.sehatsandhi.com/international/track/4538beedb9f3fffaa64ffdc1'],
  },
  {
    name: 'intl_team_new_request', language: 'en', category: 'UTILITY',
    body: 'New Sehatsandhi International request from {{1}} ({{2}}) for {{3}}. Please reply to the patient within 24 hours. Open the admin panel: {{4}}\n\nThis is an automatic alert from Sehatsandhi.',
    samples: ['Ahmed Khan', 'United Kingdom', 'Knee replacement (one knee)', 'https://www.sehatsandhi.com/admin'],
  },
]
