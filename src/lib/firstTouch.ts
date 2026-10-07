import { supabase } from './supabase'
import { WA_LINK } from '../types'

// Where a website visitor first came from (business metrics, 0209/0210).
//
// The landing page's UTM tags (or ?ref= / ?qr=, or failing those the site that
// sent them) are kept on this browser — first visit only, never overwritten —
// and used twice: the WhatsApp links carry the campaign as "#CODE" in the
// pre-filled message (the bot records it as the patient's first source), and
// signing in on /my records it directly (sehat_my_first_touch). Nothing here
// identifies the visitor; it is a label for how they found us.
type Source = 'instagram_reel' | 'google' | 'sms_campaign' | 'qr_poster' | 'camp' | 'doctor_referral' | 'patient_referral' | 'website_organic' | 'direct' | 'other'
interface Touch { type: Source; detail: string | null; code: string | null; at: string }
const KEY = 'ss_first_touch'

const clean = (s: string | null) => (s ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || null

function classify(q: URLSearchParams, referrer: string): Touch {
  const src = (q.get('utm_source') ?? '').toLowerCase()
  const med = (q.get('utm_medium') ?? '').toLowerCase()
  const campaign = clean(q.get('utm_campaign'))
  const ref = clean(q.get('ref') ?? q.get('qr'))
  const host = (() => { try { return referrer ? new URL(referrer).hostname.replace(/^www\./, '') : '' } catch { return '' } })()
  const own = /sehatsandhi|vercel\.app|localhost/.test(host)
  let type: Source =
    /facebook|instagram|^ig$|^fb$|meta/.test(src) || q.has('fbclid') ? 'instagram_reel'
    : /google/.test(src) || q.has('gclid') ? 'google'
    : /sms|whatsapp_broadcast/.test(src) || med === 'sms' ? 'sms_campaign'
    : /qr|poster/.test(src) || /qr|poster|print/.test(med) || q.has('qr') ? 'qr_poster'
    : /camp/.test(src) || med === 'camp' ? 'camp'
    : /doctor|clinic/.test(src) ? 'doctor_referral'
    : /friend|referral|patient/.test(src) ? 'patient_referral'
    : src ? 'other'
    : ref ? 'other'
    : /google\.|bing\.|duckduckgo|yahoo\./.test(host) ? 'google'
    : host && !own ? 'website_organic'
    : 'direct'
  if (type === 'direct' && !host) type = 'direct'
  return { type, detail: campaign ?? ref ?? (src || null) ?? (host && !own ? host : null), code: campaign ?? ref, at: new Date().toISOString() }
}

/** Once per browser, on the first page load. */
export function captureFirstTouch() {
  try {
    if (localStorage.getItem(KEY)) return
    localStorage.setItem(KEY, JSON.stringify(classify(new URLSearchParams(window.location.search), document.referrer)))
  } catch { /* private mode — nothing kept, nothing lost */ }
}

function touch(): Touch | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null }
}

/** WA_LINK with the campaign, if the visitor came with one: "Hi #REEL07". */
export function waLink(): string {
  const t = touch()
  return t?.code ? `${WA_LINK}${encodeURIComponent(` #${t.code}`)}` : WA_LINK
}

/** After a /my sign-in: this patient's first source, if they have none yet. */
export async function recordFirstTouch() {
  const t = touch()
  await supabase.rpc('sehat_my_first_touch', {
    p_type: t && t.type !== 'direct' ? t.type : 'direct', p_detail: t?.detail ?? null, p_channel: 'website',
  }).then(() => undefined, () => undefined)
}

/** 0214: a business that just registered — where its owner first came from
 *  (the server accepts it on the first day only, and never over a known source). */
export async function recordBusinessFirstTouch(businessId: string) {
  const t = touch()
  if (!t) return
  await supabase.rpc('sehat_signup_set_source', { p_business: businessId, p_type: t.type, p_detail: t.detail })
    .then(() => undefined, () => undefined)
}
