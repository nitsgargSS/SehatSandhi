import { useCallback, useEffect, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { StatTile } from '../../components/Charts'
import { dateTime } from '../../lib/format'

// संदेश समीक्षा — Message Review (0201/0203): what patients typed on WhatsApp
// and in the app, what the matcher understood, and the loop that teaches it.
//
// The weekly routine: clear the "To review" queue — ✓ when it was right, ✗
// with what it should have been when not — and add the missing words with
// "Add a word" (they go in as 'learned' and work on every channel at once).
// "Try a message" shows what the matcher says now, before or after a change.
// Every write goes through a function that stamps who made it (0203).

type Intent = 'doctor' | 'lab' | 'medicine' | 'ambulance' | 'insurance' | 'camps'
interface Row {
  id: number; channel: 'whatsapp' | 'app' | 'web'; created_at: string; raw_text: string | null; normalized_text: string | null
  matched_intent: string | null; matched_speciality: string | null; matched_pin: string | null; matched_place: string | null
  matched_when: string | null; time_window: string | null; matched_terms: string[] | null; secondary_intents: string[] | null
  is_emergency: boolean; confidence: number | null; action: string | null; needs_review: boolean
  corrected_intent: string | null; corrected_speciality: string | null; reviewed_at: string | null; raw_purged_at: string | null
}
interface Stats {
  total: number; by_channel: Record<string, number>; proceed: number; confirm: number; menu: number; emergency: number
  to_review: number; corrected: number; top_unmatched: { word: string; n: number }[]
}
interface Match {
  is_emergency: boolean; intent: string | null; speciality: string | null; confidence: number; action: string
  pincode: string | null; location: string | null; target_date: string | null; time_window: string | null
  matched_terms: string[]; reply_text: string
}

const INTENTS: [Intent, string][] = [
  ['doctor', 'Doctor'], ['lab', 'Lab test'], ['medicine', 'Medicine'], ['ambulance', 'Ambulance'], ['insurance', 'Insurance'], ['camps', 'Camps / offers'],
]
const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', app: 'App', web: 'Website' }
const ACTION: Record<string, [string, string]> = {
  proceed: ['Understood', 'bg-teal-50 text-teal-700'], confirm: ['Asked to confirm', 'bg-amber-50 text-amber-700'],
  menu: ['Not understood', 'bg-red-50 text-red-600'], emergency: ['Emergency', 'bg-red-600 text-white'],
}
const intentLabel = (i: string | null) => i === 'none' ? 'Nothing to route' : i === 'emergency' ? 'Emergency' : INTENTS.find(([k]) => k === i)?.[1] ?? i ?? '—'

function understood(r: { intent?: string | null; matched_intent?: string | null; speciality?: string | null; matched_speciality?: string | null; is_emergency: boolean }, names: Record<string, string>) {
  if (r.is_emergency) return 'Emergency'
  const i = r.intent ?? r.matched_intent ?? null
  const s = r.speciality ?? r.matched_speciality ?? null
  return i ? `${intentLabel(i)}${s ? ` · ${names[s] ?? s}` : ''}` : 'Nothing'
}

export default function MessageReviewPanel() {
  const [days, setDays] = useState(7)
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState<'review' | 'reviewed' | 'all'>('review')
  const [band, setBand] = useState<'' | 'menu' | 'confirm' | 'emergency'>('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [try_, setTry] = useState({ text: '', pin: '' })
  const [tried, setTried] = useState<Match | null>(null)

  useEffect(() => {
    supabase.from('speciality_names').select('code, name_en').eq('bookable', true).order('name_en')
      .then(({ data }) => setNames(Object.fromEntries(((data ?? []) as { code: string; name_en: string }[]).map(s => [s.code, s.name_en]))))
  }, [])

  const load = useCallback(async () => {
    setErr(''); setRows(null)
    const since = new Date(Date.now() - days * 86400000).toISOString()
    let q = supabase.from('free_text_log').select('*').order('created_at', { ascending: false }).limit(100)
    if (status === 'review') q = q.eq('needs_review', true).is('reviewed_at', null)
    else { q = q.gte('created_at', since); if (status === 'reviewed') q = q.not('reviewed_at', 'is', null) }
    if (channel) q = q.eq('channel', channel)
    if (band === 'emergency') q = q.eq('is_emergency', true)
    else if (band) q = q.eq('action', band)
    const [{ data, error }, s] = await Promise.all([
      q, supabase.rpc('sehat_admin_free_text_stats', { p_days: days, p_channel: channel || null }),
    ])
    if (error) { setErr(error.message); setRows([]) } else setRows((data ?? []) as Row[])
    if (s.error) setErr(s.error.message); else setStats(s.data as Stats)
  }, [days, channel, status, band])
  useEffect(() => { load() }, [load])

  const tryIt = async () => {
    if (!try_.text.trim()) return
    const { data, error } = await supabase.rpc('sehat_admin_try_match', { p_text: try_.text, p_pin: try_.pin || null })
    if (error) setErr(error.message); else setTried(data as Match)
  }

  const understoodPct = stats && stats.total ? Math.round(100 * (stats.proceed + stats.emergency) / stats.total) : 0

  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <h3 className="font-bold text-navy-700 text-lg">संदेश समीक्षा · Message Review</h3>
        <p className="text-sm text-gray-500 mt-1">
          What patients typed on WhatsApp and in the app, and what the matcher understood. Mark each one right or wrong,
          and add the words it missed — a word added here works on every channel straight away.
        </p>
        <div className="flex gap-2 flex-wrap mt-3">
          <select className="input-field w-auto" value={days} onChange={e => setDays(Number(e.target.value))}>
            {[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <select className="input-field w-auto" value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="">All channels</option>
            {Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Messages" value={stats.total} sub={Object.entries(stats.by_channel).map(([k, n]) => `${CHANNEL[k] ?? k} ${n}`).join(' · ') || undefined} />
          <StatTile label="Understood by the rules" value={`${understoodPct}%`} sub={`${stats.confirm} asked to confirm · ${stats.menu} not understood`} />
          <StatTile label="To review" value={stats.to_review} tone={stats.to_review > 0 ? 'alert' : 'normal'}
            onClick={() => { setStatus('review'); setBand('') }} active={status === 'review' && !band} />
          <StatTile label="Emergencies" value={stats.emergency} onClick={() => { setStatus('all'); setBand('emergency') }} active={band === 'emergency'} />
        </div>
      )}

      {!!stats?.top_unmatched.length && (
        <div className="card shadow-sm">
          <h4 className="font-semibold text-navy-700 text-sm">Words in messages nobody understood</h4>
          <p className="text-xs text-gray-500 mb-2">Not yet in the vocabulary. The most frequent are the first to add.</p>
          <div className="flex gap-1.5 flex-wrap">
            {stats.top_unmatched.map(w => <span key={w.word} className="text-xs bg-gray-100 rounded-full px-2.5 py-1">{w.word} <b>{w.n}</b></span>)}
          </div>
        </div>
      )}

      <div className="card shadow-sm space-y-2">
        <h4 className="font-semibold text-navy-700 text-sm">Try a message</h4>
        <div className="flex gap-2 flex-wrap">
          <input className="input-field flex-1 min-w-[220px]" placeholder="e.g. kal subah jagadri me daant ka doctor" value={try_.text}
            onChange={e => setTry({ ...try_, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') tryIt() }} />
          <input className="input-field w-28" placeholder="PIN (opt.)" inputMode="numeric" value={try_.pin}
            onChange={e => setTry({ ...try_, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
          <button className="btn-teal text-sm" onClick={tryIt}>Try</button>
        </div>
        {tried && <MatchLine m={tried} names={names} />}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {([['review', 'To review'], ['reviewed', 'Reviewed'], ['all', 'All']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)}
            className={`text-sm px-3 py-1.5 rounded-full border ${status === k ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-gray-600 border-gray-200'}`}>{l}</button>
        ))}
        <select className="input-field w-auto text-sm" value={band} onChange={e => setBand(e.target.value as typeof band)}>
          <option value="">Every outcome</option>
          <option value="menu">Not understood</option>
          <option value="confirm">Asked to confirm (medium)</option>
          <option value="emergency">Emergencies</option>
        </select>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows === null ? <p className="text-sm text-gray-500">Loading…</p>
        : rows.length === 0 ? <p className="text-sm text-gray-500">{status === 'review' ? 'Nothing waiting — all reviewed ✓' : 'No messages in this period.'}</p>
        : rows.map(r => <ReviewRow key={r.id} r={r} names={names} onDone={load} />)}
    </div>
  )
}

function MatchLine({ m, names }: { m: Match; names: Record<string, string> }) {
  const [label, cls] = ACTION[m.is_emergency ? 'emergency' : m.action] ?? [m.action, 'bg-gray-100']
  return (
    <div className="text-sm bg-gray-50 rounded-lg p-2.5 space-y-1">
      <div className="flex gap-2 flex-wrap items-center">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>{label}</span>
        <b>{understood(m, names)}</b>
        <span className="text-gray-500">confidence {m.confidence}</span>
        {(m.location || m.pincode) && <span className="text-gray-500">· {m.location ?? ''} {m.pincode ?? ''}</span>}
        {m.target_date && <span className="text-gray-500">· {m.target_date}{m.time_window ? ` ${m.time_window}` : ''}</span>}
      </div>
      {!!m.matched_terms?.length && <div className="text-xs text-gray-500">Words found: {m.matched_terms.join(', ')}</div>}
      <div className="text-xs text-gray-600 whitespace-pre-line">Reply: {m.reply_text}</div>
    </div>
  )
}

function ReviewRow({ r, names, onDone }: { r: Row; names: Record<string, string>; onDone: () => void }) {
  const [mode, setMode] = useState<null | 'wrong' | 'word'>(null)
  const [fix, setFix] = useState({ intent: r.matched_intent ?? '', spec: r.matched_speciality ?? '' })
  const [picked, setPicked] = useState<number[]>([])
  const [word, setWord] = useState({ kind: 'intent' as 'intent' | 'emergency' | 'place', intent: '', spec: '', weight: '1', pin: '', place: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [now, setNow] = useState<Match | null>(null)
  const tokens = (r.normalized_text ?? '').split(' ').filter(Boolean)
  const phrase = picked.slice().sort((a, b) => a - b).map(i => tokens[i]).join(' ')
  const [label, cls] = ACTION[r.is_emergency ? 'emergency' : r.action ?? ''] ?? [r.action ?? '—', 'bg-gray-100']

  const run = async (fn: () => Promise<{ error: { message: string } | null }>, after?: () => Promise<void> | void) => {
    setBusy(true); setErr('')
    const { error } = await fn()
    setBusy(false)
    if (error) { setErr(error.message); return }
    await after?.()
  }
  const review = (correct: boolean) => run(
    async () => await supabase.rpc('sehat_admin_review_free_text', {
      p_id: r.id, p_correct: correct, p_intent: correct ? null : fix.intent || null, p_speciality: correct || fix.intent !== 'doctor' ? null : fix.spec || null,
    }),
    () => { setMode(null); onDone() })
  const addWord = () => run(
    async () => await supabase.rpc('sehat_admin_add_term', {
      p_kind: word.kind, p_term: phrase, p_intent: word.kind === 'intent' ? word.intent || null : null,
      p_speciality: word.kind === 'intent' && word.intent === 'doctor' ? word.spec || null : null,
      p_weight: Number(word.weight) || 1, p_pin: word.kind === 'place' ? word.pin : null, p_place: word.kind === 'place' ? word.place : null,
    }),
    async () => {
      setPicked([])
      // What the matcher makes of this same message now.
      if (r.raw_text) {
        const { data } = await supabase.rpc('sehat_admin_try_match', { p_text: r.raw_text, p_pin: r.matched_pin })
        setNow(data as Match)
      }
    })

  return (
    <div className="card shadow-sm space-y-2">
      <div className="flex gap-2 flex-wrap items-center text-xs text-gray-500">
        <span>{dateTime(r.created_at)}</span><span>· {CHANNEL[r.channel] ?? r.channel}</span>
        <span className={`font-semibold px-2 py-0.5 rounded ${cls}`}>{label}</span>
        {r.confidence != null && <span>confidence {r.confidence}</span>}
        {r.reviewed_at && <span className="text-teal-700">· reviewed{r.corrected_intent ? ` → ${intentLabel(r.corrected_intent)}${r.corrected_speciality ? ` · ${names[r.corrected_speciality] ?? r.corrected_speciality}` : ''}` : ' ✓ right'}</span>}
      </div>
      <p className="text-base text-navy-700">{r.raw_text ?? <i className="text-gray-400">Text cleared after 90 days</i>}</p>
      <p className="text-sm text-gray-600">
        Understood: <b>{understood(r, names)}</b>
        {(r.matched_place || r.matched_pin) && <> · {r.matched_place ?? ''} {r.matched_pin ?? ''}</>}
        {r.matched_when && <> · {r.matched_when}{r.time_window ? ` ${r.time_window}` : ''}</>}
        {!!r.secondary_intents?.length && <> · also {r.secondary_intents.map(intentLabel).join(', ')}</>}
        {!!r.matched_terms?.length && <span className="text-gray-400"> — words: {r.matched_terms.join(', ')}</span>}
      </p>

      {!mode && (
        <div className="flex gap-2 flex-wrap">
          {!r.reviewed_at && <button disabled={busy} onClick={() => review(true)} className="btn-teal text-sm inline-flex items-center gap-1"><Check className="w-4 h-4" /> Right</button>}
          <button onClick={() => setMode('wrong')} className="btn-outline text-sm inline-flex items-center gap-1"><X className="w-4 h-4" /> {r.reviewed_at ? 'Change' : 'Wrong'}</button>
          {tokens.length > 0 && <button onClick={() => setMode('word')} className="btn-outline text-sm inline-flex items-center gap-1"><Plus className="w-4 h-4" /> Add a word</button>}
        </div>
      )}

      {mode === 'wrong' && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium">What should it have been?</p>
          <div className="flex gap-2 flex-wrap">
            <select className="input-field w-auto" value={fix.intent} onChange={e => setFix({ ...fix, intent: e.target.value })}>
              <option value="">Choose…</option>
              {INTENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              <option value="emergency">Emergency</option>
              <option value="none">Nothing to route (greeting, not medical)</option>
            </select>
            {fix.intent === 'doctor' && (
              <select className="input-field w-auto" value={fix.spec} onChange={e => setFix({ ...fix, spec: e.target.value })}>
                <option value="">Any doctor</option>
                {Object.entries(names).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <button disabled={busy || !fix.intent} onClick={() => review(false)} className="btn-teal text-sm disabled:opacity-50">Save</button>
            <button onClick={() => setMode(null)} className="text-sm text-gray-500 underline">Cancel</button>
          </div>
          <p className="text-xs text-gray-500">This records the right answer. To stop the mistake happening again, also add the word that should have told it.</p>
        </div>
      )}

      {mode === 'word' && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium">Tap the word (or words, for a phrase) to teach:</p>
          <div className="flex gap-1.5 flex-wrap">
            {tokens.map((t, i) => (
              <button key={i} onClick={() => setPicked(p => p.includes(i) ? p.filter(x => x !== i) : [...p, i])}
                className={`text-sm px-2.5 py-1 rounded-full border ${picked.includes(i) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200'}`}>{t}</button>
            ))}
          </div>
          {phrase && (
            <>
              <p className="text-sm">“<b>{phrase}</b>” means:</p>
              <div className="flex gap-3 flex-wrap text-sm">
                {([['intent', 'A need (doctor, test…)'], ['emergency', 'An emergency'], ['place', 'A place']] as const).map(([k, l]) => (
                  <label key={k} className="inline-flex items-center gap-1.5"><input type="radio" checked={word.kind === k} onChange={() => setWord({ ...word, kind: k })} /> {l}</label>
                ))}
              </div>
              {word.kind === 'intent' && (
                <div className="flex gap-2 flex-wrap">
                  <select className="input-field w-auto" value={word.intent} onChange={e => setWord({ ...word, intent: e.target.value })}>
                    <option value="">Choose…</option>
                    {INTENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {word.intent === 'doctor' && (
                    <select className="input-field w-auto" value={word.spec} onChange={e => setWord({ ...word, spec: e.target.value })}>
                      <option value="">Any doctor</option>
                      {Object.entries(names).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  )}
                  <select className="input-field w-auto" value={word.weight} onChange={e => setWord({ ...word, weight: e.target.value })} title="How strongly it points there">
                    <option value="0.7">Weak hint</option><option value="1">Normal</option><option value="1.5">Strong (says it outright)</option>
                  </select>
                </div>
              )}
              {word.kind === 'place' && (
                <div className="flex gap-2 flex-wrap">
                  <input className="input-field w-28" placeholder="PIN" inputMode="numeric" value={word.pin} onChange={e => setWord({ ...word, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
                  <input className="input-field w-48" placeholder="Place name (e.g. Jagadhri)" value={word.place} onChange={e => setWord({ ...word, place: e.target.value })} />
                </div>
              )}
              {word.kind === 'emergency' && <p className="text-xs text-red-600">Any message with these words will get the 108 / 112 emergency reply.</p>}
              <div className="flex gap-2">
                <button disabled={busy || (word.kind === 'intent' && !word.intent) || (word.kind === 'place' && word.pin.length !== 6)}
                  onClick={addWord} className="btn-teal text-sm disabled:opacity-50">Add “{phrase}”</button>
                <button onClick={() => { setMode(null); setPicked([]); setNow(null) }} className="text-sm text-gray-500 underline">Close</button>
              </div>
            </>
          )}
          {now && <><p className="text-xs text-gray-500">The same message now:</p><MatchLine m={now} names={names} /></>}
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}
