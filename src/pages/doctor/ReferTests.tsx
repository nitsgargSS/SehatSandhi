import { useCallback, useEffect, useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import { BIZ } from '../business/shared'
import { moneyExact } from '../../lib/format'
import {
  getReferralLabs, getReferralMenu, referTests, getReferredTests, withdrawReferral, STATUS_LABEL,
  type ReferralLab, type ReferralMenu, type ReferredTest,
} from '../../lib/labApi'

// 0290: tests sent to another lab or diagnostic centre on Sehatsandhi, from
// the patient's Lab tests. The doctor chooses the lab, its tests at its prices,
// and who pays; the lab accepts it, does it, signs it — and the report comes
// back here, and to the doctor's Reports ready.

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: 16 }
const input: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, fontFamily: 'inherit', fontSize: 14,
  border: `1px solid ${BIZ.inputBorder}`, background: '#fff', color: BIZ.ink,
}
const btn = (primary = false): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', borderRadius: 9,
  border: primary ? 'none' : `1px solid ${BIZ.inputBorder}`, background: primary ? BIZ.green : '#fff', color: primary ? '#fff' : BIZ.ink,
})
const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 99, cursor: 'pointer',
  border: `1px solid ${on ? BIZ.green : BIZ.inputBorder}`, background: on ? '#e5f4e4' : '#fff', color: on ? '#1f6b2c' : BIZ.ink,
})
const when = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

/** Where a referred order is, in words. */
function stage(r: ReferredTest): [string, string] {
  if (r.status === 'cancelled') return [r.cancelled_reason?.startsWith('Declined') ? 'Declined by the lab' : 'Withdrawn', '#b3261e']
  if (r.report_token) return ['Report ready', '#1f6b2c']
  if (r.status === 'ordered') return r.accepted_at ? ['Accepted by the lab', '#1d4f8a'] : ['Sent — waiting for the lab', '#8a5a00']
  return [STATUS_LABEL[r.status], '#1d4f8a']
}

export function ReferredList({ businessId, memberId, reloadKey }: { businessId: string; memberId: string; reloadKey: number }) {
  const [list, setList] = useState<ReferredTest[]>([])
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(() => { getReferredTests(businessId, memberId).then(setList).catch(() => setList([])) }, [businessId, memberId])
  useEffect(load, [load, reloadKey])
  if (!list.length) return null
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: BIZ.mutedWarm }}>Sent to other labs</div>
      {list.map(r => {
        const [word, colour] = stage(r)
        return (
          <div key={r.order_id} style={{ ...card, opacity: r.status === 'cancelled' ? 0.65 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: BIZ.ink }}>{r.lab_name}{r.priority === 'urgent' ? ' · URGENT' : ''}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: colour }}>{word} · {when(r.created_at)}</span>
            </div>
            <div style={{ fontSize: 13, color: BIZ.ink, marginTop: 4 }}>{r.tests}</div>
            <div style={{ fontSize: 12, color: BIZ.muted, marginTop: 4 }}>
              {r.order_no} · sent by {r.ordered_by_name ?? '—'} · {r.payer === 'hospital' ? `on our bill, ${moneyExact(r.amount)}` : `patient pays the lab, ${moneyExact(r.amount)}`}
              {r.lab_phone && <> · lab {r.lab_phone}</>}
              {r.report_token && <> · <a href={`/lab/${r.report_token}`} target="_blank" rel="noreferrer" style={{ color: BIZ.green, fontWeight: 700 }}>View report {r.report_no}</a>
                {r.out_of_range > 0 && <b style={{ color: '#b3261e' }}> · {r.out_of_range} out of range</b>}</>}
              {r.status === 'cancelled' && r.cancelled_reason && <> · {r.cancelled_reason}</>}
            </div>
            {r.status === 'ordered' && withdrawing !== r.order_id && (
              <button style={{ ...btn(), padding: '3px 10px', fontSize: 12, marginTop: 6 }} onClick={() => { setWithdrawing(r.order_id); setWhy(''); setErr('') }}>Withdraw</button>
            )}
            {withdrawing === r.order_id && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input style={input} placeholder="Why? (the lab sees this)" value={why} onChange={e => setWhy(e.target.value)} />
                <button style={btn(true)} disabled={why.trim().length < 3}
                  onClick={async () => { try { await withdrawReferral(r.order_id, why); setWithdrawing(null); load() } catch (e) { setErr((e as Error).message) } }}>Withdraw</button>
                <button style={btn()} onClick={() => setWithdrawing(null)}>Keep</button>
              </div>
            )}
          </div>
        )
      })}
      {err && <div style={{ color: '#8a2b2b', fontSize: 13 }}>{err}</div>}
    </div>
  )
}

export default function ReferTests({ businessId, memberId, visitId, admitted, onSent, onClose }: {
  businessId: string; memberId: string; visitId: string | null; admitted: boolean; onSent: () => void; onClose: () => void
}) {
  const [kind, setKind] = useState<'pathology' | 'imaging' | null>(null)
  const [q, setQ] = useState('')
  const [labs, setLabs] = useState<ReferralLab[] | null>(null)
  const [lab, setLab] = useState<ReferralLab | null>(null)
  const [menu, setMenu] = useState<ReferralMenu | null>(null)
  const [find, setFind] = useState('')
  const [testIds, setTestIds] = useState<string[]>([])
  const [packageIds, setPackageIds] = useState<string[]>([])
  const [payer, setPayer] = useState<'patient' | 'hospital'>('patient')
  const [urgent, setUrgent] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (lab) return
    const t = setTimeout(() => { getReferralLabs(businessId, kind, q).then(setLabs).catch(e => { setErr((e as Error).message); setLabs([]) }) }, 250)
    return () => clearTimeout(t)
  }, [businessId, kind, q, lab])
  useEffect(() => {
    setMenu(null); setTestIds([]); setPackageIds([])
    if (lab) getReferralMenu(businessId, lab.id).then(setMenu).catch(e => setErr((e as Error).message))
  }, [businessId, lab])

  const shownTests = useMemo(() => (menu?.tests ?? []).filter(t =>
    (!kind || (kind === 'pathology' ? t.category === 'pathology' : t.category !== 'pathology'))
    && (!find.trim() || `${t.name} ${t.department ?? ''}`.toLowerCase().includes(find.trim().toLowerCase()))), [menu, kind, find])
  const total = (menu?.tests ?? []).filter(t => testIds.includes(t.id)).reduce((s, t) => s + t.price, 0)
    + (menu?.packages ?? []).filter(p => packageIds.includes(p.id)).reduce((s, p) => s + p.price, 0)
  const toggle = (ids: string[], set: (v: string[]) => void, id: string) => set(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  const send = async () => {
    if (!lab) return
    setBusy(true); setErr('')
    try { await referTests(businessId, { memberId, labId: lab.id, testIds, packageIds, payer, urgent, note, visitId }); onSent() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ ...card, display: 'grid', gap: 10, borderColor: '#9fd8bf' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b style={{ color: BIZ.ink }}>Send tests to another lab</b>
        <button style={{ ...btn(), padding: '3px 10px', fontSize: 12 }} onClick={onClose}>Close</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {([[null, 'All'], ['pathology', 'Blood & pathology'], ['imaging', 'Scans, ECG & imaging']] as const).map(([k, l]) => (
          <button key={l} style={pill(kind === k)} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>

      {!lab ? (
        <>
          <input style={input} placeholder="Search labs by name or city" value={q} onChange={e => setQ(e.target.value)} />
          {labs === null ? <div style={{ fontSize: 13, color: BIZ.muted }}>Loading labs…</div>
            : labs.length === 0 ? <div style={{ fontSize: 13, color: BIZ.muted }}>No lab on Sehatsandhi does these tests yet.</div>
            : (
              <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                {labs.map(l => (
                  <button key={l.id} onClick={() => setLab(l)} style={{ ...card, padding: 10, textAlign: 'left', cursor: 'pointer' }}>
                    <b style={{ color: BIZ.ink }}>{l.name}</b>
                    {l.same_city && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: BIZ.green }}>YOUR CITY</span>}
                    <div style={{ fontSize: 12, color: BIZ.muted }}>{[l.city, l.address].filter(Boolean).join(' · ')} · {l.tests} tests</div>
                  </button>
                ))}
              </div>
            )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: '#f6faf8', borderRadius: 10, padding: '8px 10px', fontSize: 13 }}>
            <span><b>{lab.name}</b>{lab.city ? ` · ${lab.city}` : ''}{lab.phone ? ` · ${lab.phone}` : ''}</span>
            <button style={{ background: 'none', border: 'none', color: BIZ.green, cursor: 'pointer', fontWeight: 700 }} onClick={() => setLab(null)}>Change lab</button>
          </div>
          {!menu ? <div style={{ fontSize: 13, color: BIZ.muted }}>Loading tests…</div> : (
            <>
              <input style={input} placeholder="Find a test" value={find} onChange={e => setFind(e.target.value)} />
              <div style={{ display: 'grid', gap: 2, maxHeight: 280, overflowY: 'auto', fontSize: 13.5 }}>
                {kind !== 'imaging' && menu.packages.filter(p => !find.trim() || p.name.toLowerCase().includes(find.trim().toLowerCase())).map(p => (
                  <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 2px' }}>
                    <input type="checkbox" checked={packageIds.includes(p.id)} onChange={() => toggle(packageIds, setPackageIds, p.id)} />
                    <span style={{ flex: 1 }}><b>Package:</b> {p.name}</span><span>{moneyExact(p.price)}</span>
                  </label>
                ))}
                {shownTests.map(t => (
                  <label key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 2px' }}>
                    <input type="checkbox" checked={testIds.includes(t.id)} onChange={() => toggle(testIds, setTestIds, t.id)} />
                    <span style={{ flex: 1 }}>{t.name}{t.department ? <span style={{ color: BIZ.muted }}> · {t.department}</span> : null}</span>
                    <span>{moneyExact(t.price)}</span>
                  </label>
                ))}
                {!shownTests.length && <div style={{ color: BIZ.muted }}>No test matches.</div>}
              </div>
              <div style={{ display: 'grid', gap: 6, fontSize: 13.5 }}>
                <label style={{ display: 'flex', gap: 8 }}><input type="radio" checked={payer === 'patient'} onChange={() => setPayer('patient')} />
                  The patient pays the lab</label>
                <label style={{ display: 'flex', gap: 8 }}><input type="radio" checked={payer === 'hospital'} onChange={() => setPayer('hospital')} />
                  Add it to our bill{admitted ? ' (on the patient\'s stay)' : ''} — we settle with the lab</label>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input style={{ ...input, flex: '2 1 260px' }} placeholder="Note for the lab (clinical details, what to look for)" value={note} onChange={e => setNote(e.target.value)} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} /> Urgent</label>
              </div>
            </>
          )}
          {err && <div style={{ color: '#8a2b2b', fontSize: 13 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button style={btn(true)} disabled={busy || (!testIds.length && !packageIds.length)} onClick={send}>
              <Send className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 4 }} />{busy ? 'Sending…' : `Send to ${lab.name}`}</button>
            {total > 0 && <span style={{ fontSize: 13, color: BIZ.muted }}>Lab's price {moneyExact(total)}</span>}
          </div>
        </>
      )}
      {!lab && err && <div style={{ color: '#8a2b2b', fontSize: 13 }}>{err}</div>}
    </div>
  )
}
