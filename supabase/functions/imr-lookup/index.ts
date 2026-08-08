// imr-lookup — find a doctor in our copy of the Indian Medical Register.
//
// Prefill, not proof. A match says the registration exists and whose it is; it
// says nothing about whether the person typing it is that doctor. Nothing here
// activates a listing — a human still reviews, and the doctor can edit every
// field we fill in.
//
// Two ways in, because doctors arrive knowing different things. Someone holding
// their certificate has the number; someone who left it at the clinic has their
// name and their council.
//
//   { mode: 'number', regNo, smcId }        → exact match on the number
//   { mode: 'name',   query, smcId? }       → autocomplete over names
//
// Response: { status: 'matched',   record }
//           { status: 'ambiguous', candidates[] }   // number matched several
//           { status: 'results',   candidates[] }   // name search
//           { status: 'no_match' }
//           { status: 'error', reason }
//
// Reads imr_doctors, our local mirror. Sub-millisecond, and it works when the
// register does not — see 0029 for why the mirror exists. A number the mirror
// has never heard of falls through to the register itself, which is how a doctor
// who registered last week still gets found.
//
// Deploy with --no-verify-jwt: the caller is signing up and has no session yet.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      IMR_CA_PEM — the Sectigo intermediate, for the live fallback only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const IMR_BASE = 'https://www.nmc.org.in/MCIRest/open/getPaginatedData'
const TIMEOUT_MS = 8_000
const MAX_CANDIDATES = 12
const MIN_NAME_CHARS = 3

// Built once per instance, not once per request. The lookup itself is well under
// a millisecond — the register mirror is indexed — so anything set up per call
// is pure overhead sitting in front of a search someone is waiting on.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

export interface ImrRecord {
  regNo: string
  name: string
  year: number | null
  council: string
  smcId: number
}

type LookupResult =
  | { status: 'matched'; record: ImrRecord }
  | { status: 'ambiguous'; candidates: ImrRecord[] }
  | { status: 'results'; candidates: ImrRecord[] }
  | { status: 'no_match' }
  | { status: 'error'; reason: 'timeout' | 'upstream' | 'tls' | 'schema' }

/**
 * The digits that make a registration number, ignoring how it is dressed.
 *
 * Councils prefix inconsistently — DMC/R/24970, TSMC/FMR/15376, G-27776, bare
 * digits for most — and a doctor types whatever their certificate shows.
 * Comparing on the numeric core lets those agree. Leading zeros go too: the
 * register holds 08567 and somebody will type 8567.
 */
function regCore(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.replace(/^0+/, '') || digits
}

// ── The live register, for numbers the mirror has not got ──────────────────

/**
 * nmc.org.in serves its leaf certificate without the intermediate that signs it.
 * Browsers and curl paper over this from their own caches; Deno does not, and
 * fetch fails with `invalid peer certificate: UnknownIssuer`. Supplying the
 * intermediate ourselves completes the chain.
 *
 * In an env var because certificates rotate, and swapping one should not mean
 * shipping code. Verification stays on — an incomplete chain is the server's bug,
 * not a reason to stop checking who we are talking to.
 */
function httpClient(): unknown | undefined {
  const ca = Deno.env.get('IMR_CA_PEM')
  if (!ca) return undefined
  try {
    // @ts-ignore createHttpClient is a Deno API, absent from the DOM types
    return Deno.createHttpClient({ caCerts: [ca] })
  } catch {
    return undefined
  }
}

/**
 * A row upstream is a positional array, not an object:
 *   [idx, year, regNo, council, name, fathersName, viewLinkHtml]
 *
 * Index 5 is the father's name. It is read here only to be ignored — it never
 * enters a record, a row, or a log line. We are confirming a registration
 * number; a parent's name does nothing for that.
 */
function parseRow(row: unknown, smcId: number): ImrRecord | null {
  if (!Array.isArray(row) || row.length < 5) return null
  const [, year, regNo, council, name] = row as unknown[]
  if (typeof regNo !== 'string' || typeof name !== 'string') return null
  const y = typeof year === 'number' ? year : Number.parseInt(String(year ?? ''), 10)
  return {
    regNo: regNo.trim(),
    // The register is inconsistent about spacing — 'AKSHAY  BHASIN' is verbatim.
    name: name.trim().replace(/\s+/g, ' '),
    year: Number.isFinite(y) ? y : null,
    council: typeof council === 'string' ? council.trim() : '',
    smcId,
  }
}

async function queryLive(regNo: string, smcId: number): Promise<LookupResult> {
  const url = `${IMR_BASE}?service=getPaginatedDoctor&draw=1&start=0&length=100`
    + `&name=&registrationNo=${encodeURIComponent(regCore(regNo))}`
    + `&smcId=${smcId}&year=`

  let res: Response
  try {
    // @ts-ignore `client` is a Deno-only fetch option
    res = await fetch(url, {
      client: httpClient(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    if ((e as Error)?.name === 'TimeoutError' || msg.includes('timed out')) {
      return { status: 'error', reason: 'timeout' }
    }
    // Its own reason: it means IMR_CA_PEM is missing or stale, which is our
    // configuration and is fixed by rotating a secret, not by retrying.
    if (msg.includes('certificate') || msg.includes('UnknownIssuer')) {
      console.error('imr-lookup: TLS chain rejected — is IMR_CA_PEM set and current?')
      return { status: 'error', reason: 'tls' }
    }
    console.error(`imr-lookup: register unreachable: ${msg.slice(0, 200)}`)
    return { status: 'error', reason: 'upstream' }
  }

  if (!res.ok) {
    console.error(`imr-lookup: register returned ${res.status} for smcId=${smcId}`)
    return { status: 'error', reason: 'upstream' }
  }

  let body: { data?: unknown }
  try { body = await res.json() } catch { return { status: 'error', reason: 'schema' } }
  if (!Array.isArray(body?.data)) return { status: 'error', reason: 'schema' }

  const rows = body.data.map(r => parseRow(r, smcId)).filter((r): r is ImrRecord => r !== null)
  return resolve(rows.filter(r => regCore(r.regNo) === regCore(regNo)))
}

/**
 * The guard that matters.
 *
 * The register matches on substrings, so asking it for 4998 in West Bengal comes
 * back with twenty rows — 14998, 24998, 34998, 44998 and 49980 all contain it.
 * Counting rows would hand back a stranger's record with full confidence. Only
 * an exact match on the digits is a match; anything else is nobody.
 */
function resolve(exact: ImrRecord[]): LookupResult {
  if (exact.length === 0) return { status: 'no_match' }
  if (exact.length === 1) return { status: 'matched', record: exact[0] }
  return { status: 'ambiguous', candidates: exact.slice(0, MAX_CANDIDATES) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { mode?: string; regNo?: string; smcId?: number; query?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const smcId = Number(body.smcId)
  const hasCouncil = Number.isInteger(smcId) && smcId > 0

  // ── By name ─────────────────────────────────────────────────────────────
  // Only possible because we hold the register locally: upstream returns HTTP
  // 500 for any name containing a space, and 20,601 rows for 'Sharma'.
  if (body.mode === 'name') {
    const query = String(body.query ?? '').trim().replace(/\s+/g, ' ')
    // Short fragments match tens of thousands of people and help nobody choose.
    if (query.length < MIN_NAME_CHARS) return json({ status: 'no_match' })

    // Every word must appear, in any order. The register writes names both ways
    // round — reg 27776 is 'Goyal, Swati' and reg 13-47707 is 'Swati Goyal', two
    // different doctors — and a doctor typing their own name has no idea which
    // way their council recorded it. Matching the phrase would find one of them
    // and tell the other they are not registered.
    //
    // Punctuation goes too: 'Goyal, Swati' must be reachable by typing the comma
    // or not. Each term is a separate ILIKE, which the trigram index serves.
    const terms = query
      .split(/[\s,.]+/)
      .map(t => t.trim())
      .filter(t => t.length >= 2)
      .slice(0, 4)   // four words is a long name; more is someone pasting junk

    let q = supabase.from('imr_doctors')
      .select('reg_no, name, year, council, smc_id')
      .limit(MAX_CANDIDATES)

    for (const t of (terms.length ? terms : [query])) {
      q = q.ilike('name', `%${t}%`)
    }
    // A council narrows 20,601 Sharmas to something a person can read. Optional,
    // because someone who cannot remember their council should still get results.
    if (hasCouncil) q = q.eq('smc_id', smcId)

    const { data, error } = await q
    if (error) {
      console.error(`imr-lookup: name search failed: ${error.message}`)
      return json({ status: 'error', reason: 'schema' })
    }

    const candidates: ImrRecord[] = (data ?? []).map(r => ({
      regNo: r.reg_no, name: r.name, year: r.year,
      council: r.council, smcId: r.smc_id,
    }))
    return json(candidates.length
      ? { status: 'results', candidates }
      : { status: 'no_match' })
  }

  // ── By registration number ──────────────────────────────────────────────
  const regNo = String(body.regNo ?? '').trim()
  if (!regNo || !regCore(regNo)) return json({ error: 'A registration number is required.' }, 400)
  if (!hasCouncil) return json({ error: 'A medical council is required.' }, 400)

  const { data: local, error } = await supabase
    .from('imr_doctors')
    .select('reg_no, name, year, council, smc_id')
    .eq('reg_core', regCore(regNo)).eq('smc_id', smcId)
    .limit(MAX_CANDIDATES)

  if (error) {
    console.error(`imr-lookup: mirror read failed: ${error.message}`)
    return json({ status: 'error', reason: 'schema' })
  }

  if (local && local.length) {
    return json(resolve(local.map(r => ({
      regNo: r.reg_no, name: r.name, year: r.year,
      council: r.council, smcId: r.smc_id,
    }))))
  }

  // Not in the mirror. Either the number is wrong, or the doctor registered more
  // recently than our last import — roughly 1,500 do every month, and telling one
  // of them they do not exist would be both wrong and unhelpful. Ask the register.
  //
  // We only mirror the councils we operate in, so most councils miss every time
  // and this is the normal path, not an edge case.
  const live = await queryLive(regNo, smcId)

  // A fallback that cannot run is not an error the doctor caused or can fix. If
  // the register is unreachable — no certificate configured, upstream down — then
  // all we honestly know is that our copy does not have this number. Say that,
  // and let them continue; the form treats no_match as "we will check by hand".
  if (live.status === 'error') {
    console.error(`imr-lookup: falling back to no_match — live register ${live.reason}`)
    return json({ status: 'no_match', checked: 'mirror-only' })
  }

  return json(live)
})
