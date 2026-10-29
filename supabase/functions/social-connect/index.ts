// social-connect — a business connects its Facebook Page and Instagram (0295).
//
// The owner presses "Connect Facebook" in the Social posts tab. Meta's window
// opens (Facebook Login for Business, configuration "Clinic social connect");
// they pick their Page and the Instagram account linked to it, and the window
// closes with a one-time code. The browser posts the code here:
//
//   1. the code becomes the owner's access key, then a 60-day one;
//   2. their Pages are listed. One Page → it is connected straight away.
//      More than one → the list goes back and the owner picks ('pick'); the
//      owner's key waits in the Vault until then;
//   3. the Page's own key (made from the 60-day one, it never expires) goes to
//      the Vault, never to the browser. Instagram is the professional account
//      linked to that Page, posted to with the same key.
//
// Request (signed-in owner):
//   { businessId, action: 'connect', code }
//   { businessId, action: 'pick', pageId }
//   { businessId, action: 'disconnect' }
// Response: { ok, message?, account?, pages? }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      META_APP_ID (default: the Sehatsandhi Bot app), META_APP_SECRET

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { APP_ID, GRAPH, graph } from '../_shared/metaGraph.ts'

// deno-lint-ignore no-explicit-any
type Any = any
interface Page { id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }

const PAGE_FIELDS = 'id,name,access_token,instagram_business_account{id,username}'

async function pages(userToken: string): Promise<{ list?: Page[]; error?: string }> {
  const r = await graph(`me/accounts?fields=${encodeURIComponent(PAGE_FIELDS)}&limit=100`, userToken)
  if (!r.ok) return { error: r.error }
  return { list: (r.body.data ?? []) as Page[] }
}

async function save(db: Any, businessId: string, page: Page, userId: string | null) {
  if (!page.access_token) return 'Meta did not give a key for that Page. Please connect again and allow posting.'
  const { error: tErr } = await db.rpc('sehat_social_token_set', { p_business: businessId, p_kind: 'page', p_token: page.access_token })
  if (tErr) return tErr.message
  const account = {
    business_id: businessId, page_id: page.id, page_name: page.name,
    ig_user_id: page.instagram_business_account?.id ?? null,
    ig_username: page.instagram_business_account?.username ?? null,
    connected_by: userId, connected_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('social_accounts').upsert(account)
  if (error) return error.message
  await db.rpc('sehat_social_token_drop', { p_business: businessId, p_kind: 'user' })
  return null
}

const publicAccount = (p: Page) => ({
  page_id: p.id, page_name: p.name, ig_username: p.instagram_business_account?.username ?? null,
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  let body: Any
  try { body = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const businessId = typeof body.businessId === 'string' ? body.businessId : ''
  const action = ['connect', 'pick', 'disconnect'].includes(body.action) ? body.action : ''
  if (!businessId || !action) return json({ error: 'businessId and action required' }, 400)

  const who = caller(req)
  if (!who) return json({ error: 'Please sign in.' }, 401)
  const db = who.asService
  let userId: string | null = null
  if (!who.isServiceRole) {
    const { data: role, error } = await who.asCaller.rpc('sehat_caller_role', { p_business: businessId })
    if (error) return json({ error: error.message }, 500)
    if (role !== 'owner') return json({ ok: false, message: 'Only the owner can connect Facebook.' }, 403)
    try {
      const jwt = (req.headers.get('Authorization') ?? '').slice(7).split('.')[1] ?? ''
      userId = JSON.parse(atob(jwt.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null
    } catch { userId = null }
  }
  const fail = (message: string) => json({ ok: false, message })

  if (action === 'disconnect') {
    await db.rpc('sehat_social_token_drop', { p_business: businessId, p_kind: 'page' })
    await db.rpc('sehat_social_token_drop', { p_business: businessId, p_kind: 'user' })
    await db.from('social_accounts').delete().eq('business_id', businessId)
    return json({ ok: true })
  }

  if (action === 'pick') {
    const { data: userToken } = await db.rpc('sehat_social_token', { p_business: businessId, p_kind: 'user' })
    if (!userToken) return fail('Please press Connect Facebook again.')
    const got = await pages(userToken)
    if (!got.list) return fail(`Meta did not list your Pages: ${got.error}`)
    const page = got.list.find(p => p.id === String(body.pageId ?? ''))
    if (!page) return fail('That Page was not shared. Please connect again and tick it.')
    const err = await save(db, businessId, page, userId)
    return err ? fail(err) : json({ ok: true, account: publicAccount(page) })
  }

  // connect
  const code = typeof body.code === 'string' ? body.code : ''
  if (!code) return fail('Meta did not finish. Please try again.')
  const secret = Deno.env.get('META_APP_SECRET')
  if (!secret) return fail('Connecting Facebook is not switched on yet. Sehatsandhi has been told.')

  // 1. The code, then a 60-day key: a Page key made from it never expires.
  let userToken = ''
  try {
    const s = encodeURIComponent(secret)
    const res = await fetch(`${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${s}&code=${encodeURIComponent(code)}`)
    const tb = await res.json().catch(() => ({})) as Any
    if (typeof tb?.access_token !== 'string') return fail(`Meta did not accept it: ${String(tb?.error?.message ?? res.status).slice(0, 150)}`)
    const long = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${s}&fb_exchange_token=${encodeURIComponent(tb.access_token)}`)
    const lb = await long.json().catch(() => ({})) as Any
    userToken = typeof lb?.access_token === 'string' ? lb.access_token : tb.access_token
  } catch (e) {
    return fail(`Meta could not be reached: ${String((e as Error).message ?? e)}`)
  }

  // 2. Their Pages.
  const got = await pages(userToken)
  if (!got.list) return fail(`Meta did not list your Pages: ${got.error}`)
  if (!got.list.length) return fail('No Page was shared. Please connect again and tick your Page.')
  if (got.list.length === 1) {
    const err = await save(db, businessId, got.list[0], userId)
    return err ? fail(err) : json({ ok: true, account: publicAccount(got.list[0]) })
  }
  const { error: kErr } = await db.rpc('sehat_social_token_set', { p_business: businessId, p_kind: 'user', p_token: userToken })
  if (kErr) return fail(kErr.message)
  return json({ ok: true, pages: got.list.map(publicAccount) })
})
