import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  getMessagePlans, saveMessagePlan, deleteMessagePlan, surgeryMessagesOn, setSurgeryMessagesOn, dayWords,
  type MessagePlan, type PlanStep,
} from '../../lib/surgeryApi'
import { OffsetPicker } from './PlannedSurgeries'
import { getWaAccount } from '../../lib/marketingApi'

// 0289: the hospital's surgery message plans, under Clinic & team. Each plan
// is a set of messages a number of days before or after the surgery, in the
// hospital's own words; a surgery is planned with one of them, and the patient
// gets those messages by themselves (WhatsApp Pro). The owner, a manager or a
// doctor changes them; only the owner switches surgery messages off.

type Draft = { id?: string; name: string; is_default: boolean; steps: { day_offset: string; send_at: string; body: string }[] }

const toDraft = (p?: MessagePlan): Draft => p
  ? { id: p.id, name: p.name, is_default: p.is_default, steps: p.steps.map(s => ({ day_offset: String(s.day_offset), send_at: s.send_at, body: s.body })) }
  : { name: '', is_default: false, steps: [{ day_offset: '-1', send_at: '18:00', body: '' }, { day_offset: '1', send_at: '10:00', body: '' }] }

export default function SurgeryMessagePlans({ businessId, canEdit, isOwner }: {
  businessId: string; canEdit: boolean; isOwner: boolean
}) {
  const [plans, setPlans] = useState<MessagePlan[] | null>(null)
  const [hasPro, setHasPro] = useState(false)
  const [on, setOn] = useState<boolean | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    getMessagePlans(businessId).then(setPlans).catch(e => { setErr((e as Error).message); setPlans([]) })
    surgeryMessagesOn(businessId).then(setOn).catch(() => setOn(false))
    getWaAccount(businessId).then(a => setHasPro(a?.plan === 'pro')).catch(() => setHasPro(false))
  }, [businessId])
  useEffect(load, [load])

  const save = async () => {
    if (!draft) return
    setBusy(true); setErr('')
    try {
      const steps: PlanStep[] = draft.steps.map(s => ({ day_offset: Number(s.day_offset), send_at: s.send_at, body: s.body.trim() }))
      await saveMessagePlan(businessId, { id: draft.id, name: draft.name.trim(), is_default: draft.is_default, steps })
      setDraft(null); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async (p: MessagePlan) => {
    setErr('')
    try { await deleteMessagePlan(p.id); load() } catch (e) { setErr((e as Error).message) }
  }
  const flip = async () => {
    setErr('')
    try { await setSurgeryMessagesOn(businessId, !on); load() } catch (e) { setErr((e as Error).message) }
  }

  if (!plans) return <p className="text-sm text-gray-400">Loading…</p>
  const step = (i: number, k: keyof Draft['steps'][number], v: string) =>
    draft && setDraft({ ...draft, steps: draft.steps.map((s, j) => j === i ? { ...s, [k]: v } : s) })

  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-600">
        When a surgery is planned (patient → Operations → Plan a surgery), the patient gets these messages by themselves —
        on WhatsApp, or in the Sehatsandhi app if they have it — between 8 am and 9 pm. Change the words for your hospital,
        or make a plan for each kind of operation.
      </p>
      {!hasPro ? (
        <p className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
          These messages are sent with WhatsApp Pro, which this hospital does not have yet. Plans can be made now; they start
          going out once Pro is on (WhatsApp tab).
        </p>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <span className={on ? 'text-teal-700 font-semibold' : 'text-gray-500 font-semibold'}>
            Surgery messages are {on ? 'on' : 'off'}.
          </span>
          {isOwner && <button onClick={flip} className="text-xs py-1.5 px-3 rounded-lg border border-gray-300">{on ? 'Switch off' : 'Switch on'}</button>}
        </div>
      )}

      {plans.map(p => draft?.id === p.id ? null : (
        <div key={p.id} className="border border-gray-200 rounded-xl p-3">
          <div className="flex justify-between gap-2 flex-wrap">
            <b className="text-navy-700">{p.name}{p.is_default && <span className="ml-2 text-xs text-teal-700">usual plan</span>}</b>
            {canEdit && (
              <span className="flex gap-2">
                <button className="text-xs text-teal-700 underline" onClick={() => setDraft(toDraft(p))}>Change</button>
                {!p.is_default && <button className="text-xs text-red-600" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}><Trash2 className="w-3.5 h-3.5" /></button>}
              </span>
            )}
          </div>
          <ul className="mt-2 space-y-1">
            {p.steps.map((s, i) => (
              <li key={i}><b>{dayWords(s.day_offset)}, {s.send_at}</b> — <span className="text-gray-700">{s.body}</span></li>
            ))}
          </ul>
        </div>
      ))}

      {draft && (
        <div className="border border-teal-300 rounded-xl p-3 space-y-3 bg-teal-50/30">
          <div className="flex gap-3 flex-wrap items-center">
            <input className="input-field max-w-xs" placeholder='Plan name, e.g. "Cataract"' value={draft.name} maxLength={80}
              onChange={e => setDraft({ ...draft, name: e.target.value })} />
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.is_default}
              onChange={e => setDraft({ ...draft, is_default: e.target.checked })} /> The usual plan</label>
          </div>
          {draft.steps.map((s, i) => (
            <div key={i} className="space-y-1 border-l-2 border-teal-300 pl-3">
              <div className="flex gap-2 items-center flex-wrap">
                <OffsetPicker value={s.day_offset} onChange={v => step(i, 'day_offset', v)} />
                <span className="text-gray-500">at</span>
                <input type="time" min="08:00" max="20:59" className="input-field w-28" value={s.send_at} onChange={e => step(i, 'send_at', e.target.value)} />
                <button className="text-xs text-red-600 ml-auto" disabled={draft.steps.length === 1}
                  onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}>Remove</button>
              </div>
              <textarea className="input-field" rows={2} maxLength={600} placeholder="What the patient should do that day" value={s.body}
                onChange={e => step(i, 'body', e.target.value)} />
            </div>
          ))}
          {draft.steps.length < 12 && (
            <button className="text-xs text-teal-700 flex items-center gap-1"
              onClick={() => setDraft({ ...draft, steps: [...draft.steps, { day_offset: '7', send_at: '10:00', body: '' }] })}>
              <Plus className="w-3.5 h-3.5" /> Add a message</button>
          )}
          <div className="flex gap-2">
            <button className="btn-teal text-sm py-2 px-4" disabled={busy || draft.name.trim().length < 2 || draft.steps.some(s => s.body.trim().length < 10)} onClick={save}>
              {busy ? 'Saving…' : 'Save plan'}</button>
            <button className="text-sm py-2 px-4 rounded-lg border border-gray-300" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
      {canEdit && !draft && (
        <button className="text-sm text-teal-700 flex items-center gap-1" onClick={() => setDraft(toDraft())}><Plus className="w-4 h-4" /> New plan</button>
      )}
      {err && <p className="text-red-600">{err}</p>}
    </div>
  )
}
