// Sending a WhatsApp template, through whichever provider is configured.
//
// Every function that messages someone first (a login code, a bill, an
// appointment) goes through sendTemplate, so the provider is a matter of which
// secrets are set and not of which file was edited.
//
// Two providers:
//   AiSensy — AISENSY_API_KEY, and a campaign name per message in its own
//             secret (AISENSY_INVOICE_CAMPAIGN, …).
//   Meta    — the Cloud API called directly: META_PHONE_NUMBER_ID and
//             META_ACCESS_TOKEN, and a template name per message in the secret
//             of the same name with META_ for AISENSY_ and _TEMPLATE for
//             _CAMPAIGN (META_INVOICE_TEMPLATE, …). The value is the template
//             name, or name:language ("bill_link:hi"); the language otherwise
//             is META_TEMPLATE_LANG, else "en".
//
// WA_PROVIDER ("meta" | "aisensy") says which is tried first; unset, AiSensy
// leads when its key is present. The other is tried when the first is not set
// up for this message or refuses it — both are WhatsApp, on the patient's side
// nothing differs.

const GRAPH = 'https://graph.facebook.com/v25.0'

export type WaProvider = 'meta' | 'aisensy'

export interface TemplateSend {
  /** Secret holding the AiSensy campaign name. Several: the first one set wins. */
  campaignEnv: string | string[]
  /** Digits only, with country code. */
  to: string
  /** AiSensy files the contact under this name. */
  userName: string
  /** The template's variables, in the approved template's order. */
  params: string[]
  /** A login code: Meta wants it in the copy-code button as well as the body. */
  otp?: boolean
  /** AiSensy's free-text source tag. */
  source?: string
  /**
   * Something a clinic sends its patient (a prescription, a bill): Meta sends
   * it from the number kept for clinics, META_CLINIC_PHONE_NUMBER_ID, when
   * that is set. Everything else goes from META_PHONE_NUMBER_ID.
   */
  fromClinic?: boolean
}

export interface SendOutcome {
  ok: boolean
  /** Who answered last. null: no provider is set up for this message. */
  provider: WaProvider | null
  /** Why it did not go, ready for a log line. Never contains the params. */
  error?: string
  /** Meta says the number cannot be reached — most often it has no WhatsApp. */
  unreachable?: boolean
  /** Meta's id for the message, when it went. */
  id?: string
}

const envs = (e: string | string[]) => Array.isArray(e) ? e : [e]
const firstSet = (names: string[]) => names.map(n => Deno.env.get(n)).find(v => !!v) ?? null

/** AISENSY_INVOICE_CAMPAIGN → META_INVOICE_TEMPLATE */
export const metaEnvFor = (campaignEnv: string) =>
  campaignEnv.replace(/^AISENSY_/, 'META_').replace(/_CAMPAIGN$/, '_TEMPLATE')

export const metaConfigured = () => !!Deno.env.get('META_PHONE_NUMBER_ID') && !!Deno.env.get('META_ACCESS_TOKEN')

function metaTemplate(t: TemplateSend): { name: string; lang: string } | null {
  // META_TEMPLATE_NAME is the login template's older secret; login_code its default.
  const raw = firstSet(envs(t.campaignEnv).map(metaEnvFor))
    ?? (t.otp ? Deno.env.get('META_TEMPLATE_NAME') ?? 'login_code' : null)
  if (!raw) return null
  const [name, lang] = raw.split(':')
  return { name, lang: lang || Deno.env.get('META_TEMPLATE_LANG') || 'en' }
}

/**
 * Whether any provider is set up to carry this template — asked before money
 * is taken for a message, so nothing is charged for a send that cannot start.
 */
export function canSendTemplate(t: Pick<TemplateSend, 'campaignEnv' | 'otp'>): boolean {
  const aisensy = !!Deno.env.get('AISENSY_API_KEY') && !!firstSet(envs(t.campaignEnv))
  return aisensy || (metaConfigured() && !!metaTemplate({ ...t, to: '', userName: '', params: [] }))
}

async function viaAisensy(t: TemplateSend): Promise<SendOutcome | null> {
  const apiKey = Deno.env.get('AISENSY_API_KEY')
  const campaignName = firstSet(envs(t.campaignEnv))
  if (!apiKey || !campaignName) return null
  try {
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey, campaignName, destination: t.to, userName: t.userName,
        ...(t.source ? { source: t.source } : {}),
        templateParams: t.params,
      }),
    })
    if (res.ok) return { ok: true, provider: 'aisensy' }
    // The body carries the reason — a wrong campaign name, an unapproved
    // template, an exhausted wallet.
    return { ok: false, provider: 'aisensy', error: `whatsapp ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}` }
  } catch (e) {
    return { ok: false, provider: 'aisensy', error: `whatsapp: ${String((e as Error).message ?? e)}` }
  }
}

async function viaMeta(t: TemplateSend): Promise<SendOutcome | null> {
  const tpl = metaTemplate(t)
  if (!metaConfigured() || !tpl) return null
  const text = (s: string) => ({ type: 'text', text: s })
  const components: unknown[] = []
  if (t.params.length) components.push({ type: 'body', parameters: t.params.map(text) })
  // 'url' even though the button is COPY_CODE. Meta rejects the send outright
  // if this says 'copy_code', and a code template sent without the button
  // parameter arrives with a button that does nothing.
  if (t.otp) components.push({ type: 'button', sub_type: 'url', index: 0, parameters: [text(t.params[0])] })
  const r = await graphSend({
    to: t.to, type: 'template',
    template: { name: tpl.name, language: { code: tpl.lang }, components },
  }, t.fromClinic ? Deno.env.get('META_CLINIC_PHONE_NUMBER_ID') ?? undefined : undefined)
  return { ok: r.ok, provider: 'meta', error: r.error, unreachable: r.unreachable, id: r.id }
}

/**
 * One message to Meta's Cloud API. `message` is everything but
 * messaging_product: { to, type, text | interactive | template | … }, or a
 * read receipt { status: 'read', message_id }. Never throws.
 */
export async function graphSend(
  message: Record<string, unknown>,
  /** The number to send from. A reply goes out from the number that was written to. */
  fromPhoneId?: string,
): Promise<{ ok: boolean; id?: string; error?: string; unreachable?: boolean }> {
  const phoneId = fromPhoneId ?? Deno.env.get('META_PHONE_NUMBER_ID')
  const token = Deno.env.get('META_ACCESS_TOKEN')
  if (!phoneId || !token) return { ok: false, error: 'META_PHONE_NUMBER_ID / META_ACCESS_TOKEN not set' }
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...message }),
    })
    // deno-lint-ignore no-explicit-any
    const body = await res.json().catch(() => ({})) as any
    if (res.ok) return { ok: true, id: body?.messages?.[0]?.id }
    const code = body?.error?.code
    return {
      ok: false,
      error: `whatsapp ${res.status}: ${String(body?.error?.message ?? '').slice(0, 150)}${code ? ` (${code})` : ''}`,
      // 131026: cannot deliver — most often the number has no WhatsApp account.
      // 131047: outside the allowed window for a non-template send.
      unreachable: code === 131026 || code === 131047,
    }
  } catch (e) {
    return { ok: false, error: `whatsapp: ${String((e as Error).message ?? e)}` }
  }
}

/**
 * Send a template. Never throws: a provider outage must not fail whatever
 * called this.
 */
export async function sendTemplate(t: TemplateSend): Promise<SendOutcome> {
  const want = (Deno.env.get('WA_PROVIDER') ?? '').toLowerCase()
  const metaFirst = want === 'meta' || (want !== 'aisensy' && !Deno.env.get('AISENSY_API_KEY'))
  const order = metaFirst ? [viaMeta, viaAisensy] : [viaAisensy, viaMeta]

  let last: SendOutcome | null = null
  for (const send of order) {
    const r = await send(t)
    if (!r) continue
    if (r.ok || r.unreachable) return r
    last = r
  }
  return last ?? { ok: false, provider: null, error: `${envs(t.campaignEnv).join(' / ')} is not set` }
}
