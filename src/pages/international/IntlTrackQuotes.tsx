import { useState } from 'react'
import { CheckCircle2, Stethoscope } from 'lucide-react'
import { C, Card } from './IntlLayout'
import { useCurrency } from './intlHooks'
import { chooseQuote, type SharedQuote } from '../../lib/intlApi'
import { CURRENCIES, inr, inCurrency } from '../../lib/intlContent'

// 0325: the written quotes on the patient's tracking page. Each one in three
// parts so it is clear who is paid what:
//   A. Treatment at the hospital — paid to the hospital
//   B. Sehatsandhi service fee — the advance that books the treatment
//   C. Travel and stay — arranged by Sehatsandhi (each line says who is paid)

export default function TrackQuotes({ token, quotes, fx, onChosen }: { token: string; quotes: SharedQuote[]; fx: Record<string, number>; onChosen: () => void }) {
  const { cur, setCur } = useCurrency()
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const both = (n: number) => {
    const o = inCurrency(n, cur, fx)
    return o ? <><span className="font-semibold">{o}</span> <span className="text-sm" style={{ color: C.muted }}>{inr(n)}</span></> : <span className="font-semibold">{inr(n)}</span>
  }
  const choose = async (id: string) => {
    setBusy(id); setErr('')
    const r = await chooseQuote(token, id)
    setBusy('')
    if (!r.ok) setErr(r.error || 'Could not save your choice.'); else onChosen()
  }
  if (!quotes.length) return null
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-bold">Your written quotes</h2>
        <label className="text-sm flex items-center gap-2" style={{ color: C.muted }}>Show in
          <select value={cur} onChange={e => setCur(e.target.value)} className="rounded-lg border px-2 py-1 bg-white">{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
      </div>
      <p className="mt-1" style={{ color: C.muted }}>From the doctors who reviewed your reports. Compare them, ask your coordinator anything, then choose one.</p>
      {err && <p className="mt-3 text-red-700">{err}</p>}
      <div className="mt-4 flex flex-col gap-5">
        {quotes.map(q => {
          const travel = (q.travel ?? []).reduce((n, l) => n + (Number(l.amount) || 0), 0)
          const total = q.treatment + q.fee + travel
          const expired = new Date(q.valid_until) < new Date(new Date().toDateString())
          return (
            <Card key={q.id} className={q.chosen ? '!border-2' : ''}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xl font-bold">{q.hospital}</p>
                  {q.city && <p style={{ color: C.muted }}>{q.city}</p>}
                </div>
                {q.chosen && <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold text-white" style={{ background: C.green }}><CheckCircle2 className="w-4 h-4" /> Your choice</span>}
              </div>

              <div className="mt-4 rounded-xl p-4" style={{ background: '#F4F8F6' }}>
                <p className="font-semibold flex items-center gap-2"><Stethoscope className="w-5 h-5" style={{ color: C.green }} /> Doctor’s opinion{q.doctor_name ? ` — ${q.doctor_name}` : ''}</p>
                <p className="mt-1 whitespace-pre-wrap">{q.opinion}</p>
                {q.plan && <p className="mt-2 whitespace-pre-wrap"><b>Plan:</b> {q.plan}</p>}
                <p className="mt-2 text-sm" style={{ color: C.muted }}>{[q.room_type, q.hospital_days != null && `${q.hospital_days} days in hospital`, q.india_days != null && `about ${q.india_days} days in India`, q.fly_after_days != null && `fit to fly after ${q.fly_after_days} days`].filter(Boolean).join(' · ')}</p>
              </div>

              <table className="mt-4 w-full text-[15px]">
                <tbody>
                  <tr className="align-top">
                    <td className="py-2 pr-3"><b>A. Treatment package</b><br /><span className="text-sm" style={{ color: C.muted }}>Paid to {q.hospital} at the hospital.{q.included ? ` Includes: ${q.included}.` : ''}</span></td>
                    <td className="py-2 text-right whitespace-nowrap">{both(q.treatment)}</td>
                  </tr>
                  <tr className="align-top border-t" style={{ borderColor: C.border }}>
                    <td className="py-2 pr-3"><b>B. Sehatsandhi service fee ({q.fee_pct}%)</b><br /><span className="text-sm" style={{ color: C.muted }}>Paid to Sehatsandhi as the advance that books your treatment. Covers your coordinator, quotes, visa letter, and help until your follow-ups.</span></td>
                    <td className="py-2 text-right whitespace-nowrap">{both(q.fee)}</td>
                  </tr>
                  <tr className="align-top border-t" style={{ borderColor: C.border }}>
                    <td className="py-2 pr-3"><b>C. Travel and stay</b>
                      {q.travel.length === 0 ? <><br /><span className="text-sm" style={{ color: C.muted }}>Not included. Your coordinator can arrange it.</span></> : (
                        <ul className="text-sm mt-1" style={{ color: C.muted }}>
                          {q.travel.map((l, i) => <li key={i} className="flex justify-between gap-3"><span>{l.label} <i>({l.pay === 'direct' ? 'pay directly' : 'pay Sehatsandhi'})</i></span><span className="whitespace-nowrap">{inr(l.amount)}</span></li>)}
                        </ul>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">{both(travel)}</td>
                  </tr>
                  <tr className="border-t-2" style={{ borderColor: C.ink }}>
                    <td className="py-3 pr-3 text-lg font-bold">Estimated total</td>
                    <td className="py-3 text-right whitespace-nowrap text-lg">{both(total)}</td>
                  </tr>
                </tbody>
              </table>
              {q.excluded && <p className="text-sm mt-1"><b>Not included:</b> {q.excluded}</p>}
              {q.note && <p className="text-sm mt-1"><b>From your coordinator:</b> {q.note}</p>}
              <p className="text-xs mt-2" style={{ color: C.muted }}>
                Valid until {new Date(q.valid_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Flights are not included. The hospital may change its price if tests on arrival show something new; it will tell you before going ahead. Amounts in other currencies are approximate.
              </p>
              {!q.chosen && (
                <button disabled={!!busy || expired} onClick={() => choose(q.id)}
                  className="mt-4 rounded-full px-6 py-3 font-semibold text-white disabled:opacity-40" style={{ background: C.green }}>
                  {expired ? 'Quote expired — message your coordinator' : busy === q.id ? 'Saving…' : `Choose ${q.hospital}`}
                </button>
              )}
              {q.chosen && <p className="mt-4" style={{ color: C.green }}>Your coordinator will send you the link to pay the advance ({inr(q.fee)}) and the next steps for your visa letter.</p>}
            </Card>
          )
        })}
      </div>
    </section>
  )
}
