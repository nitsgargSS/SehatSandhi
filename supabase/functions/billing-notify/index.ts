// billing-notify — send the billing notices the database queues (0280).
//
// billing_notifications has been filled every morning since 0083 (renewal
// reminders, auto-debit notices) and by 0279 (the plan-change notice), and
// nothing sent them. This does, to the business's own phone and email:
//   WhatsApp — from our number (fromClinic: the number kept for messages to
//     businesses, when set), with the templates in _shared/billingTemplates.ts;
//   email    — the same words, through ZeptoMail.
// Sent when either goes; failed (and tried again next run, 3 times in all)
// when neither does.
//
// BILLING_NOTIFY_MODE decides whether anything is sent at all:
//   unset            preview — lists what would go; sends and marks nothing
//   test:98xxxxxxxx  only rows for these numbers (comma-separated, 10 digits)
//   live             everyone
//
// Called by the cron (service role) every 15 minutes, 9 am–8 pm India time,
// or by an admin to preview. Request: {} → { mode, sent, failed, skipped, preview? }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SITE_URL,
//      META_ACCESS_TOKEN, META_PHONE_NUMBER_ID (META_CLINIC_PHONE_NUMBER_ID),
//      ZEPTOMAIL_TOKEN, BILLING_NOTIFY_MODE

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { sendTemplate } from '../_shared/whatsapp.ts'
import { emailConfigured, esc, layout, sendEmail } from '../_shared/email.ts'
import { resolveActivePlan, termLabel } from '../_shared/pricing.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const CAMPAIGN: Record<string, string> = {
  renewal_reminder: 'AISENSY_PLAN_RENEWAL_CAMPAIGN',
  pre_debit_notice: 'AISENSY_PLAN_AUTO_DEBIT_CAMPAIGN',
  plan_change_notice: 'AISENSY_PLAN_CHANGE_CAMPAIGN',
}

const day = (d: unknown) => d
  ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : ''
const rupees = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
const waNumber = (p: string | null) => {
  const d = String(p ?? '').replace(/\D/g, '')
  return d.length === 10 ? `91${d}` : d.length === 12 && d.startsWith('91') ? d : ''
}

/** The words of one notice: WhatsApp params, and the email. */
function compose(n: Any, link: string, gstIncluded: boolean) {
  const p = n.payload ?? {}
  const name = String(p.business_name ?? 'your business')
  const term = termLabel(Number(p.months) || 1).toLowerCase()
  const amount = `${rupees(n.amount)}${gstIncluded ? ' (incl. GST)' : ' + GST'}`
  if (n.kind === 'renewal_reminder') {
    const params = [name, day(n.term_end), amount, term, link]
    return { params, subject: `Your Sehatsandhi plan ends on ${day(n.term_end)}`,
      lines: [`The Sehatsandhi plan for <b>${esc(name)}</b> ends on <b>${esc(day(n.term_end))}</b>.`,
              `To keep using it, renew for <b>${esc(amount)}</b> (${esc(term)}).`], button: 'Renew now' }
  }
  if (n.kind === 'pre_debit_notice') {
    const on = day(p.debit_on ?? n.term_end)
    const params = [name, on, amount, term, link]
    return { params, subject: `Your Sehatsandhi plan renews on ${on}`,
      lines: [`The Sehatsandhi plan for <b>${esc(name)}</b> renews automatically on <b>${esc(on)}</b>.`,
              `<b>${esc(amount)}</b> (${esc(term)}) will be charged to your saved payment method.`], button: 'See or change your plan' }
  }
  if (n.kind === 'plan_change_notice') {
    const from = day(p.plans_from)
    const params = [from, name, String(p.tier ?? 'your new plan'), rupees(p.monthly), link]
    return { params, subject: `Your Sehatsandhi plan from ${from}`,
      lines: [`From <b>${esc(from)}</b>, the Sehatsandhi plan for <b>${esc(name)}</b> will be <b>${esc(p.tier)}</b> at <b>${esc(rupees(p.monthly))}</b> a month + GST, for what you use today.`,
              'Until then nothing changes — you keep everything you have, at what you pay now.',
              'You can see the details and choose which add-ons to keep at renewal on your Plan page.'], button: 'See your plan' }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const who = caller(req)
  if (!who) return json({ error: 'Please sign in.' }, 401)
  const db = who.asService
  if (!who.isServiceRole) {
    const { data: admin } = await who.asCaller.rpc('sehat_is_admin')
    if (admin !== true) return json({ error: 'Admins only.' }, 403)
  }

  const raw = (Deno.env.get('BILLING_NOTIFY_MODE') ?? '').trim()
  const mode = raw === 'live' ? 'live' : raw.startsWith('test:') ? 'test' : 'preview'
  const only = mode === 'test' ? raw.slice(5).split(',').map(x => x.replace(/\D/g, '').slice(-10)).filter(x => x.length === 10) : null
  const site = (Deno.env.get('SITE_URL') ?? 'https://www.sehatsandhi.com').replace(/\/$/, '')
  const link = `${site}/business/dashboard?tab=plan`
  const plan = await resolveActivePlan(db)

  // Preview: what is waiting, nothing claimed or sent.
  if (mode === 'preview') {
    const { data } = await db.from('billing_notifications').select('id, kind, phone, email, term_end, amount, payload, created_at')
      .or('status.eq.pending,and(status.eq.failed,attempts.lt.3)').order('created_at').limit(50)
    return json({ mode, sent: 0, failed: 0, skipped: 0,
      preview: (data ?? []).map((n: Any) => ({ id: n.id, kind: n.kind, to: n.phone, email: n.email, params: compose(n, link, plan.price_includes_gst)?.params })) })
  }

  const { data: rows, error } = await db.rpc('sehat_billing_notices_claim', { p_limit: 25, p_only_phones: only })
  if (error) return json({ error: error.message }, 500)
  let sent = 0, failed = 0, skipped = 0
  for (const n of (rows ?? []) as Any[]) {
    const c = compose(n, link, plan.price_includes_gst)
    const to = waNumber(n.phone)
    if (!c || (!to && !n.email)) {
      await db.rpc('sehat_billing_notice_done', { p_id: n.id, p_status: 'skipped', p_whatsapp: false, p_email: false,
        p_error: !c ? `no message for ${n.kind}` : 'no phone or email' })
      skipped++; continue
    }
    const errors: string[] = []
    let wa = false, mail = false
    if (to && !n.sent_whatsapp_at) {
      const r = await sendTemplate({ campaignEnv: CAMPAIGN[n.kind], to, userName: String(n.payload?.business_name ?? ''), params: c.params, fromClinic: true, source: 'billing' })
      if (r.ok) wa = true; else errors.push(`whatsapp: ${r.error ?? 'not sent'}`)
    }
    if (n.email && !n.sent_email_at && emailConfigured()) {
      const html = layout(c.subject, c.lines.map(l => `<p style="margin:0 0 12px">${l}</p>`).join('') +
        `<p style="margin:18px 0"><a href="${esc(link)}" style="background:#0f6b4a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${esc(c.button)}</a></p>`)
      const text = `${c.lines.map(l => l.replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${c.button}: ${link}`
      const r = await sendEmail({ to: n.email, subject: c.subject, html, text })
      if (r.ok) mail = true; else errors.push(`email: ${r.error}`)
    }
    const went = wa || mail || !!n.sent_whatsapp_at || !!n.sent_email_at
    await db.rpc('sehat_billing_notice_done', { p_id: n.id, p_status: went ? 'sent' : 'failed', p_whatsapp: wa, p_email: mail,
      p_error: errors.length ? errors.join('; ') : null })
    if (went) sent++; else failed++
  }
  return json({ mode, sent, failed, skipped })
})
