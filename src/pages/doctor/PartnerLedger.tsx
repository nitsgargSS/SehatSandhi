import { useCallback, useEffect, useState } from 'react'
import { Download, Plus } from 'lucide-react'
import { moneyExact } from '../../lib/format'
import { downloadCsv } from '../../lib/billingApi'
import { toCsv } from '../../lib/adminInsightsApi'
import {
  getPartners, getPartnerCandidates, proposeTerms, acceptTerms, endPartnership, getLedgerLines, getStatements,
  makeStatement, markStatementPaid, termsText, type Partner, type LedgerLine, type Statement,
} from '../../lib/labPartnersApi'

// 0291: Partner labs (for a hospital) / Partner hospitals (for a lab), under
// Clinic & team. The agreed terms, what has built up since the last
// statement, the statements, and who has paid. Both sides see the same lines.
// Owner and manager only — the database holds the same line.

type Terms = { b2b: string; fee: string; cycle: 'weekly' | 'monthly'; notes: string }
const day = (d: string) => new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export default function PartnerLedger({ businessId, isLab }: { businessId: string; isLab: boolean }) {
  const [list, setList] = useState<Partner[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ id: string; name: string; city: string | null; sent: number }[]>([])
  const [other, setOther] = useState<{ id: string; name: string } | null>(null)
  const [terms, setTerms] = useState<Terms>({ b2b: '10', fee: '0', cycle: 'monthly', notes: '' })
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => { getPartners(businessId).then(setList).catch(e => { setErr((e as Error).message); setList([]) }) }, [businessId])
  useEffect(load, [load])
  useEffect(() => {
    if (!adding || other) return
    const t = setTimeout(() => { getPartnerCandidates(businessId, q).then(setFound).catch(() => setFound([])) }, 250)
    return () => clearTimeout(t)
  }, [adding, other, q, businessId])

  const act = async (f: () => Promise<unknown>) => {
    setErr('')
    try { await f(); load() } catch (e) { setErr((e as Error).message) }
  }
  const propose = (id: string) => act(async () => {
    await proposeTerms(businessId, id, { b2bPct: Number(terms.b2b) || 0, feePct: Number(terms.fee) || 0, cycle: terms.cycle, notes: terms.notes })
    setAdding(false); setOther(null); setQ('')
  })
  const word = isLab ? 'hospital' : 'lab'

  if (!list) return <p className="text-sm text-gray-400">Loading…</p>
  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-600">
        {isLab
          ? 'Hospitals and clinics that send you tests. Agree terms with each: a discount on tests the hospital pays for, and, if you choose, a service fee to the hospital on tests the patient pays you for.'
          : 'Labs and diagnostic centres you send tests to. Agree terms with each: a discount on tests you pay the lab for, and, if agreed, a service fee the lab pays you on tests the patient pays the lab for.'}
        {' '}Every referred test goes on one ledger both sides see; statements net it out, weekly or monthly. Money is between the two
        businesses only — nothing is paid to a doctor.
      </p>

      {list.length === 0 && !adding && <p className="text-gray-500">No partner {word}s yet.</p>}
      {list.map(p => (
        <PartnerCard key={p.other_id} p={p} businessId={businessId} open={open === p.other_id}
          onToggle={() => setOpen(open === p.other_id ? null : p.other_id)} onChanged={load} setErr={setErr}
          onChangeTerms={() => { setOther({ id: p.other_id, name: p.other_name }); setTerms({ b2b: String(p.b2b_pct ?? 10), fee: String(p.fee_pct ?? 0), cycle: p.cycle ?? 'monthly', notes: p.notes ?? '' }); setAdding(true) }}
          act={act} />
      ))}

      {adding ? (
        <div className="border border-teal-300 rounded-xl p-3 space-y-3 bg-teal-50/30">
          {!other ? (
            <>
              <input className="input-field" placeholder={`Find a ${word} by name or city`} value={q} onChange={e => setQ(e.target.value)} autoFocus />
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {found.map(f => (
                  <button key={f.id} onClick={() => setOther({ id: f.id, name: f.name })} className="w-full text-left border border-gray-200 rounded-lg px-3 py-2 hover:border-teal-400">
                    <b>{f.name}</b>{f.city ? ` · ${f.city}` : ''}{f.sent > 0 ? <span className="text-teal-700"> · {f.sent} test{f.sent === 1 ? '' : 's'} between you</span> : null}
                  </button>
                ))}
                {!found.length && <p className="text-gray-500">No {word} found.</p>}
              </div>
            </>
          ) : (
            <>
              <p className="font-semibold text-navy-700">Terms with {other.name}</p>
              <div className="flex gap-3 flex-wrap items-center">
                <label className="flex items-center gap-2">Discount on hospital-paid tests
                  <input className="input-field w-20" inputMode="decimal" value={terms.b2b} onChange={e => setTerms({ ...terms, b2b: e.target.value.replace(/[^\d.]/g, '') })} /> %</label>
                <label className="flex items-center gap-2">Service fee to the hospital on patient-paid tests
                  <input className="input-field w-20" inputMode="decimal" value={terms.fee} onChange={e => setTerms({ ...terms, fee: e.target.value.replace(/[^\d.]/g, '') })} /> %</label>
                <label className="flex items-center gap-2">Statements
                  <select className="input-field w-32" value={terms.cycle} onChange={e => setTerms({ ...terms, cycle: e.target.value as Terms['cycle'] })}>
                    <option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
              </div>
              <input className="input-field" placeholder="Anything else agreed (optional)" value={terms.notes} onChange={e => setTerms({ ...terms, notes: e.target.value })} />
              <p className="text-xs text-gray-500">
                {other.name} sees these and accepts them before they apply. Until then, tests the hospital pays for are owed at the lab's full price.
                A service fee should be stated in your written agreement with the {word}.
              </p>
              <div className="flex gap-2">
                <button className="btn-teal text-sm py-2 px-4" onClick={() => propose(other.id)}>Send terms</button>
                <button className="text-sm py-2 px-4 rounded-lg border border-gray-300" onClick={() => { setAdding(false); setOther(null) }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button className="text-sm text-teal-700 flex items-center gap-1" onClick={() => { setAdding(true); setOther(null); setTerms({ b2b: '10', fee: '0', cycle: 'monthly', notes: '' }) }}>
          <Plus className="w-4 h-4" /> Add a partner {word}</button>
      )}
      {err && <p className="text-red-600">{err}</p>}
    </div>
  )
}

function PartnerCard({ p, businessId, open, onToggle, onChanged, onChangeTerms, act, setErr }: {
  p: Partner; businessId: string; open: boolean; onToggle: () => void; onChanged: () => void
  onChangeTerms: () => void; act: (f: () => Promise<unknown>) => void; setErr: (s: string) => void
}) {
  const [lines, setLines] = useState<LedgerLine[] | null>(null)
  const [statements, setStatements] = useState<Statement[]>([])
  const [paying, setPaying] = useState<{ id: string; ref: string } | null>(null)
  const loadDetail = useCallback(() => {
    getLedgerLines(businessId, p.other_id).then(setLines).catch(() => setLines([]))
    getStatements(businessId, p.other_id).then(setStatements).catch(() => setStatements([]))
  }, [businessId, p.other_id])
  useEffect(() => { if (open) loadDetail() }, [open, loadDetail])

  const net = p.open_hospital_owes - p.open_lab_owes
  const hospital = p.i_am === 'hospital'
  const iReceive = (s: Statement) => (s.net > 0) === !hospital
  const statusLine = p.status === 'active' ? 'Agreed' : p.status === 'proposed' ? (p.proposed_by_me ? 'Terms sent — waiting for them' : 'They sent terms — accept?') : p.status === 'ended' ? 'Ended' : 'No agreement — full price'
  const csv = (name: string, rows: LedgerLine[]) => downloadCsv(name, toCsv(rows, [
    ['entry_date', 'Date'], ['order_no', 'Order'], ['patient_name', 'Patient'], ['tests', 'Tests'], ['ordered_by_name', 'Sent by'],
    ['payer', 'Paid by'], ['kind', 'Owed'], ['gross', 'Lab price'], ['pct', '%'], ['amount', 'Amount'], ['statement_no', 'Statement'],
  ]))
  const whoOwes = (n: number) => n === 0 ? 'nothing owed' : (n > 0) === hospital ? `you owe ${moneyExact(Math.abs(n))}` : `they owe you ${moneyExact(Math.abs(n))}`

  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="flex justify-between gap-2 flex-wrap">
        <b className="text-navy-700">{p.other_name}</b>
        <span className={`text-xs font-bold ${p.status === 'proposed' && !p.proposed_by_me ? 'text-amber-700' : p.status === 'active' ? 'text-teal-700' : 'text-gray-500'}`}>{statusLine}</span>
      </div>
      {p.agreed_at && <p className="text-gray-700">Agreed: {termsText(p.agreed_b2b_pct, p.agreed_fee_pct, p.agreed_cycle)}</p>}
      {p.status === 'proposed' && <p className="text-gray-700">{p.agreed_at ? 'Proposed change' : 'Proposed'}: {termsText(p.b2b_pct, p.fee_pct, p.cycle)}{p.notes ? ` · ${p.notes}` : ''}</p>}
      <p>
        Since the last statement: <b>{p.open_lines}</b> test{p.open_lines === 1 ? '' : 's'} · <b>{whoOwes(net)}</b>
        {p.unpaid_statements > 0 && <span className="text-amber-700"> · {p.unpaid_statements} statement{p.unpaid_statements === 1 ? '' : 's'} not paid ({whoOwes(p.unpaid_net)})</span>}
      </p>
      <div className="flex gap-2 flex-wrap">
        {p.status === 'proposed' && !p.proposed_by_me && p.partnership_id &&
          <button className="btn-teal text-xs py-1.5 px-3" onClick={() => act(() => acceptTerms(p.partnership_id!))}>Accept terms</button>}
        <button className="text-xs py-1.5 px-3 rounded-lg border border-gray-300" onClick={onToggle}>{open ? 'Hide ledger' : 'Ledger & statements'}</button>
        {p.open_lines > 0 && <button className="text-xs py-1.5 px-3 rounded-lg border border-gray-300"
          onClick={() => act(async () => { await makeStatement(businessId, p.other_id); loadDetail() })}>Make a statement now</button>}
        <button className="text-xs py-1.5 px-3 rounded-lg border border-gray-300" onClick={onChangeTerms}>{p.status === 'none' || p.status === 'ended' ? 'Propose terms' : 'Change terms'}</button>
        {p.partnership_id && p.status !== 'ended' && <button className="text-xs py-1.5 px-3 rounded-lg border border-gray-300 text-red-600"
          onClick={() => act(() => endPartnership(p.partnership_id!))}>{p.status === 'proposed' && !p.agreed_at ? 'Withdraw' : 'End agreement'}</button>}
      </div>

      {open && (
        <div className="space-y-3 pt-2 border-t border-gray-100">
          <div>
            <div className="flex justify-between items-center">
              <p className="font-semibold text-navy-700">Not yet on a statement</p>
              {!!lines?.length && <button className="text-xs text-teal-700 flex items-center gap-1" onClick={() => csv(`${p.other_name}-open.csv`, lines)}><Download className="w-3.5 h-3.5" /> CSV</button>}
            </div>
            {!lines ? <p className="text-gray-400">Loading…</p> : !lines.length ? <p className="text-gray-500">Nothing since the last statement.</p> : <Lines lines={lines} hospital={hospital} />}
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-navy-700">Statements</p>
            {!statements.length && <p className="text-gray-500">None yet.</p>}
            {statements.map(s => (
              <StatementRow key={s.id} s={s} businessId={businessId} otherId={p.other_id} hospital={hospital} iReceive={iReceive(s)}
                paying={paying?.id === s.id ? paying : null} setPaying={setPaying} whoOwes={whoOwes} csv={csv}
                markPaid={() => paying && act(async () => { await markStatementPaid(s.id, paying.ref); setPaying(null); loadDetail(); onChanged() })}
                setErr={setErr} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Lines({ lines, hospital }: { lines: LedgerLine[]; hospital: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-gray-500"><th className="py-1 pr-2">Date</th><th className="pr-2">Order</th><th className="pr-2">Patient · tests</th>
          <th className="pr-2">Sent by</th><th className="pr-2 text-right">Lab price</th><th className="pr-2 text-right">Owed</th></tr></thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.order_no} className="border-t border-gray-100">
              <td className="py-1 pr-2 whitespace-nowrap">{day(l.entry_date)}</td>
              <td className="pr-2 whitespace-nowrap">{l.order_no}</td>
              <td className="pr-2">{l.patient_name} · {l.tests}</td>
              <td className="pr-2">{l.ordered_by_name ?? '—'}</td>
              <td className="pr-2 text-right">{moneyExact(l.gross)}</td>
              <td className="pr-2 text-right whitespace-nowrap">
                {l.kind === 'hospital_owes'
                  ? <>{hospital ? 'you owe' : 'they owe'} {moneyExact(l.amount)}{l.pct ? ` (${l.pct}% off)` : ''}</>
                  : <>{hospital ? 'they owe' : 'you owe'} {moneyExact(l.amount)} ({l.pct}% fee)</>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatementRow({ s, businessId, otherId, hospital, iReceive, paying, setPaying, whoOwes, csv, markPaid, setErr }: {
  s: Statement; businessId: string; otherId: string; hospital: boolean; iReceive: boolean
  paying: { id: string; ref: string } | null; setPaying: (v: { id: string; ref: string } | null) => void
  whoOwes: (n: number) => string; csv: (name: string, rows: LedgerLine[]) => void; markPaid: () => void; setErr: (s: string) => void
}) {
  const [lines, setLines] = useState<LedgerLine[] | null>(null)
  const show = () => lines ? setLines(null) : getLedgerLines(businessId, otherId, s.id).then(setLines).catch(e => setErr((e as Error).message))
  return (
    <div className="border border-gray-100 rounded-lg p-2">
      <div className="flex justify-between gap-2 flex-wrap">
        <span><b>{s.statement_no}</b> · {day(s.period_from)} – {day(s.period_to)} · {s.lines} test{s.lines === 1 ? '' : 's'}</span>
        <span className={s.status === 'paid' ? 'text-teal-700 font-semibold' : 'text-amber-700 font-semibold'}>
          {s.status === 'paid' ? `Paid${s.paid_ref ? ` · ${s.paid_ref}` : ''}` : whoOwes(s.net)}
        </span>
      </div>
      <div className="text-xs text-gray-500">
        Hospital owes {moneyExact(s.hospital_owes)} · lab owes {moneyExact(s.lab_owes)} · net {moneyExact(Math.abs(s.net))} {s.net >= 0 ? 'hospital → lab' : 'lab → hospital'}
        {s.made_by_name && ` · made by ${s.made_by_name}`}{s.paid_at && s.status === 'paid' && ` · paid ${day(s.paid_at)}${s.paid_by_name ? ` (marked by ${s.paid_by_name})` : ''}`}
      </div>
      <div className="flex gap-2 mt-1 flex-wrap">
        <button className="text-xs text-teal-700 underline" onClick={show}>{lines ? 'Hide lines' : 'Lines'}</button>
        <button className="text-xs text-teal-700 flex items-center gap-1" onClick={() => getLedgerLines(businessId, otherId, s.id).then(r => csv(`${s.statement_no.replace(/\//g, '-')}.csv`, r))}>
          <Download className="w-3.5 h-3.5" /> CSV</button>
        {s.status === 'open' && iReceive && !paying && (
          <button className="text-xs text-teal-700 underline" onClick={() => setPaying({ id: s.id, ref: '' })}>Mark paid</button>
        )}
        {s.status === 'open' && !iReceive && <span className="text-xs text-gray-500">{hospital ? 'The lab' : 'The hospital'} marks it paid when the money arrives.</span>}
      </div>
      {paying && (
        <div className="flex gap-2 mt-2">
          <input className="input-field" placeholder="Payment reference — UTR, cheque no. or cash receipt" value={paying.ref} onChange={e => setPaying({ ...paying, ref: e.target.value })} />
          <button className="btn-teal text-xs py-1.5 px-3" disabled={paying.ref.trim().length < 3} onClick={markPaid}>Paid</button>
          <button className="text-xs py-1.5 px-3 rounded-lg border border-gray-300" onClick={() => setPaying(null)}>Cancel</button>
        </div>
      )}
      {lines && <Lines lines={lines} hospital={hospital} />}
    </div>
  )
}
