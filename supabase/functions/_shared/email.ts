// Sending email — one way, from one address.
//
// Everything we send goes out as no-reply@sehatsandhi.com through ZeptoMail,
// with replies directed to contact@sehatsandhi.com, which is a real inbox.
// Login codes are the exception only in who sends them: Supabase Auth sends
// those itself, through the same ZeptoMail account over SMTP.
//
// Env: ZEPTOMAIL_TOKEN   the API key from Zoho CPaaS → Agents → Sehatsandhilogincodes → SMTP/API.
//                        Pasted with or without its "Zoho-enczapikey " prefix.
//      ZEPTOMAIL_API     optional; defaults to Zoho CPaaS (.com), where our agent lives.
//      EMAIL_FROM, EMAIL_REPLY_TO, ADMIN_EMAIL   optional overrides.

export const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'no-reply@sehatsandhi.com'
export const EMAIL_REPLY_TO = Deno.env.get('EMAIL_REPLY_TO') ?? 'contact@sehatsandhi.com'
export const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? 'admin@sehatsandhi.com'

export interface Email {
  to: string
  toName?: string
  subject: string
  html: string
  text: string
}

export type SendResult = { ok: true } | { ok: false; error: string; retry: boolean }

export function emailConfigured(): boolean {
  return !!Deno.env.get('ZEPTOMAIL_TOKEN')
}

export async function sendEmail(m: Email): Promise<SendResult> {
  const raw = Deno.env.get('ZEPTOMAIL_TOKEN')
  if (!raw) return { ok: false, error: 'ZEPTOMAIL_TOKEN not set', retry: true }
  const token = raw.startsWith('Zoho-enczapikey') ? raw : `Zoho-enczapikey ${raw}`
  const api = Deno.env.get('ZEPTOMAIL_API') ?? 'https://cpaas.zoho.com/v1.1/email'

  try {
    const res = await fetch(api, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({
        from: { address: EMAIL_FROM, name: 'Sehatsandhi' },
        to: [{ email_address: { address: m.to, name: m.toName ?? m.to } }],
        reply_to: [{ address: EMAIL_REPLY_TO, name: 'Sehatsandhi' }],
        subject: m.subject,
        htmlbody: m.html,
        textbody: m.text,
      }),
    })
    if (res.ok) return { ok: true }
    const body = (await res.text()).slice(0, 300)
    // 4xx other than rate limiting is our request or the address; trying again
    // will not change the answer.
    return { ok: false, error: `ZeptoMail ${res.status}: ${body}`, retry: res.status === 429 || res.status >= 500 }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e), retry: true }
  }
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** A plain branded wrapper. Tables and inline styles, because mail clients. */
export function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f3f6f4;font-family:Arial,Helvetica,sans-serif;color:#1c2b24">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f4;padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#0f6b4a;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold">Sehatsandhi</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<h1 style="font-size:19px;margin:0 0 14px">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;background:#f7faf8;font-size:12px;color:#5b6b63;line-height:1.5">
Questions? Reply to this email or write to <a href="mailto:${EMAIL_REPLY_TO}" style="color:#0f6b4a">${EMAIL_REPLY_TO}</a>.<br>
Sehatsandhi · sehatsandhi.com
</td></tr>
</table></td></tr></table></body></html>`
}
