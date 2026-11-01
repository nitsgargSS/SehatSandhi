// What Sehatsandhi sends a business about its own plan (0280) — from our
// number, so these live in OUR messaging account only (wa-connect's
// house-templates creates them there), never in a clinic's own account.
//
// Utility: each is about the business's existing subscription. Meta will not
// approve a body that ends on a variable, hence the closing line.

import type { ClinicTemplate } from './clinicTemplates.ts'

const THANKS = '\n\nThank you for using Sehatsandhi.'
const LINK = 'https://www.sehatsandhi.com/business/dashboard?tab=plan'

export const BILLING_TEMPLATES: ClinicTemplate[] = [
  {
    name: 'plan_renewal_reminder', language: 'en', category: 'UTILITY',
    body: 'Hello, the Sehatsandhi plan for {{1}} ends on {{2}}. To keep using it, renew for {{3}} ({{4}}) here: {{5}}' + THANKS,
    samples: ['Family Health Clinic', '31 Dec 2026', '₹11,000 + GST', 'monthly', LINK],
  },
  {
    name: 'plan_auto_debit_notice', language: 'en', category: 'UTILITY',
    body: 'Hello, the Sehatsandhi plan for {{1}} renews automatically on {{2}}. {{3}} ({{4}}) will be charged to your saved payment method. To change your plan, open: {{5}}' + THANKS,
    samples: ['Family Health Clinic', '31 Dec 2026', '₹11,000 + GST', 'monthly', LINK],
  },
  // plan_change_notice (same message) was filed as Marketing by Meta —
  // "choose your add-ons" read as a sales line. This one is worded like the
  // two notices above, which Meta approved as Utility.
  {
    name: 'plan_change_update', language: 'en', category: 'UTILITY',
    body: 'Hello, the Sehatsandhi plan for {{1}} changes on {{2}}. From that date it is the {{3}} plan at {{4}} a month + GST, based on what you use today. Nothing changes before then. Plan details: {{5}}' + THANKS,
    samples: ['Family Health Clinic', '31 Dec 2026', 'Multi-speciality', '₹11,000', LINK],
  },
]

/** Which template each kind of billing notice goes out with. */
export const BILLING_TEMPLATE_FOR: Record<string, string> = {
  renewal_reminder: 'plan_renewal_reminder',
  pre_debit_notice: 'plan_auto_debit_notice',
  plan_change_notice: 'plan_change_update',
}
