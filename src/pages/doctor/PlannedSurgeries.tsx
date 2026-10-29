import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, MessageCircle, Plus } from 'lucide-react'
import { BIZ } from '../business/shared'
import {
  getPlannedSurgeries, getSurgeryMessages, getMessagePlans, planSurgery, rescheduleSurgery, cancelPlannedSurgery,
  saveSurgeryMessage, skipSurgeryMessage, surgeryMessagesOn, dayWords,
  type PlannedSurgery, type SurgeryMessage, type MessagePlan, type OtType,
} from '../../lib/surgeryApi'
import type { Admission } from '../../lib/admissionsApi'
import type { BusinessDoctor } from '../../lib/doctorsApi'

// 0289: a surgery planned for a date, on the patient's Operations pane, and
// the messages the hospital's plan sends the patient before and after it.
// Each message can be changed or skipped for this patient, and more added.
// When the operation is done it is recorded in the OT register as before —
// "Record the operation" fills that form in from the plan.

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: 16 }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: BIZ.mutedWarm }
const input: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, fontFamily: 'inherit', fontSize: 14,
  border: `1px solid ${BIZ.inputBorder}`, background: '#fff', color: BIZ.ink,
}
const btn = (primary = false): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', borderRadius: 9,
  border: primary ? 'none' : `1px solid ${BIZ.inputBorder}`, background: primary ? BIZ.green : '#fff', color: primary ? '#fff' : BIZ.ink,
})
const small = (primary = false): React.CSSProperties => ({ ...btn(primary), padding: '4px 10px', fontSize: 12 })

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
const dayText = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const dueText = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const istTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })

const STATUS: Record<SurgeryMessage['status'], [string, string]> = {
  pending: ['To go', '#8a5a00'], sending: ['Sending', '#8a5a00'], sent: ['Sent', '#1f6b2c'],
  skipped: ['Skipped', BIZ.muted], failed: ['Not sent', '#b3261e'], cancelled: ['Cancelled', BIZ.muted],
}

type Draft = { procedure_name: string; planned_on: string; planned_time: string; ot_type: OtType; surgeon_id: string
               surgeon_name: string; admission_id: string; plan_id: string; notes: string }

export default function PlannedSurgeries({ businessId, memberId, stays, doctors, onRecord, refreshKey }: {
  businessId: string; memberId: string; stays: Admission[]; doctors: BusinessDoctor[]
  onRecord: (p: PlannedSurgery) => void; refreshKey: number
}) {
  const [list, setList] = useState<PlannedSurgery[]>([])
  const [plans, setPlans] = useState<MessagePlan[]>([])
  const [on, setOn] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => { getPlannedSurgeries(memberId, businessId).then(setList) }, [memberId, businessId])
  useEffect(load, [load, refreshKey])
  useEffect(() => { surgeryMessagesOn(businessId).then(setOn).catch(() => setOn(false)) }, [businessId])

  const start = async () => {
    setErr('')
    const ps = await getMessagePlans(businessId).catch(() => [] as MessagePlan[])
    setPlans(ps)
    const open = stays.find(s => s.status === 'admitted')
    setDraft({ procedure_name: '', planned_on: '', planned_time: '', ot_type: 'major', surgeon_id: '', surgeon_name: '',
               admission_id: open?.id ?? '', plan_id: ps.find(p => p.is_default)?.id ?? ps[0]?.id ?? '', notes: '' })
  }
  const save = async () => {
    if (!draft) return
    setBusy(true); setErr('')
    try {
      await planSurgery(businessId, memberId, {
        procedure_name: draft.procedure_name, planned_on: draft.planned_on, planned_time: draft.planned_time || null,
        ot_type: draft.ot_type, surgeon_id: draft.surgeon_id || null, surgeon_name: draft.surgeon_name || null,
        admission_id: draft.admission_id || null, notes: draft.notes || null,
        plan_id: draft.plan_id && draft.plan_id !== 'none' ? draft.plan_id : null, no_messages: draft.plan_id === 'none',
      })
      setDraft(null); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const planned = list.filter(p => p.status === 'planned')
  const past = list.filter(p => p.status !== 'planned')
  const chosen = plans.find(p => p.id === draft?.plan_id)

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!draft && (
        <div><button style={btn()} onClick={start}>
          <CalendarClock className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 4 }} />Plan a surgery
        </button></div>
      )}

      {draft && (
        <div style={{ ...card, display: 'grid', gap: 10, borderColor: '#9fd8bf' }}>
          <div style={{ fontWeight: 800, color: BIZ.ink }}>Plan a surgery</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 240px' }}><div style={label}>Operation *</div>
              <input style={input} value={draft.procedure_name} placeholder="Cataract surgery, right eye"
                onChange={e => setDraft({ ...draft, procedure_name: e.target.value })} /></div>
            <div style={{ flex: '0 1 150px' }}><div style={label}>Date *</div>
              <input type="date" min={today()} style={input} value={draft.planned_on} onChange={e => setDraft({ ...draft, planned_on: e.target.value })} /></div>
            <div style={{ flex: '0 1 110px' }}><div style={label}>Time</div>
              <input type="time" style={input} value={draft.planned_time} onChange={e => setDraft({ ...draft, planned_time: e.target.value })} /></div>
            <div style={{ flex: '0 1 130px' }}><div style={label}>OT</div>
              <select style={input} value={draft.ot_type} onChange={e => setDraft({ ...draft, ot_type: e.target.value as OtType })}>
                <option value="major">Major OT</option><option value="minor">Minor OT</option></select></div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}><div style={label}>Surgeon</div>
              <select style={input} value={draft.surgeon_id} onChange={e => setDraft({ ...draft, surgeon_id: e.target.value })}>
                <option value="">Visiting surgeon (type the name)</option>
                {doctors.map(d => <option key={d.practitioner_id} value={d.practitioner_id}>{d.full_name}</option>)}</select></div>
            {!draft.surgeon_id && (
              <div style={{ flex: '1 1 180px' }}><div style={label}>Surgeon's name</div>
                <input style={input} value={draft.surgeon_name} onChange={e => setDraft({ ...draft, surgeon_name: e.target.value })} /></div>
            )}
            <div style={{ flex: '1 1 200px' }}><div style={label}>Admission (IPD)</div>
              <select style={input} value={draft.admission_id} onChange={e => setDraft({ ...draft, admission_id: e.target.value })}>
                <option value="">Not admitted yet</option>
                {stays.filter(s => s.status === 'admitted').map(s => <option key={s.id} value={s.id}>{s.admission_no}</option>)}</select></div>
          </div>
          <div>
            <div style={label}>Messages to the patient</div>
            <select style={input} value={draft.plan_id} onChange={e => setDraft({ ...draft, plan_id: e.target.value })}>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (usual)' : ''} — {p.steps.length} message{p.steps.length === 1 ? '' : 's'}</option>)}
              <option value="none">No messages</option>
            </select>
            {chosen && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: BIZ.muted }}>
                {chosen.steps.map((s, i) => <li key={i}><b>{dayWords(s.day_offset)}, {s.send_at}</b> — {s.body}</li>)}
              </ul>
            )}
            {!on && (
              <div style={{ fontSize: 12.5, color: '#8a5a00', marginTop: 6 }}>
                Surgery messages go out with WhatsApp Pro, and it is not on here (or they are switched off), so none will be sent.
                The plan is still kept.
              </div>
            )}
          </div>
          <div><div style={label}>Notes</div>
            <textarea style={{ ...input, minHeight: 48 }} value={draft.notes} placeholder="Pre-op tests, consent, blood arranged…"
              onChange={e => setDraft({ ...draft, notes: e.target.value })} /></div>
          {err && <div style={{ color: '#8a2b2b', fontSize: 13 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn(true)} disabled={busy || draft.procedure_name.trim().length < 3 || !draft.planned_on} onClick={save}>
              {busy ? 'Saving…' : 'Plan surgery'}</button>
            <button style={btn()} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      {planned.map(p => <PlannedCard key={p.id} p={p} onChanged={load} onRecord={onRecord} />)}
      {past.length > 0 && (
        <details style={{ fontSize: 13, color: BIZ.muted }}>
          <summary style={{ cursor: 'pointer' }}>Earlier plans ({past.length})</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {past.map(p => <PlannedCard key={p.id} p={p} onChanged={load} onRecord={onRecord} />)}
          </div>
        </details>
      )}
    </div>
  )
}

function PlannedCard({ p, onChanged, onRecord }: { p: PlannedSurgery; onChanged: () => void; onRecord: (p: PlannedSurgery) => void }) {
  const [msgs, setMsgs] = useState<SurgeryMessage[] | null>(null)
  const [moving, setMoving] = useState<{ date: string; time: string } | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; day_offset: string; send_at: string; body: string } | null>(null)
  const [err, setErr] = useState('')
  const loadMsgs = useCallback(() => { getSurgeryMessages(p.id).then(setMsgs).catch(() => setMsgs([])) }, [p.id])
  useEffect(loadMsgs, [loadMsgs])

  const run = async (f: () => Promise<unknown>, after?: () => void) => {
    setErr('')
    try { await f(); after?.(); loadMsgs(); onChanged() } catch (e) { setErr((e as Error).message) }
  }
  const planned = p.status === 'planned'
  const left = (msgs ?? []).filter(m => m.status === 'pending').length

  return (
    <div style={{ ...card, opacity: p.status === 'cancelled' ? 0.6 : 1, borderColor: planned ? '#9fd8bf' : BIZ.border }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: BIZ.ink }}>
          {p.procedure_name}
          <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 99,
            background: planned ? '#e7f1fb' : p.status === 'done' ? '#e5f4e4' : '#f0efec',
            color: planned ? '#1d4f8a' : p.status === 'done' ? '#1f6b2c' : BIZ.muted }}>
            {planned ? 'Planned' : p.status === 'done' ? 'Done' : 'Cancelled'}
          </span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#9a3412' }}>
          {p.ot_type === 'major' ? 'Major OT' : 'Minor OT'} · {dayText(p.planned_on)}{p.planned_time ? ` · ${p.planned_time.slice(0, 5)}` : ''}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: BIZ.muted, marginTop: 3 }}>
        {[p.surgeon_name && `Surgeon ${p.surgeon_name}`, p.created_by_name && `planned by ${p.created_by_name}`,
          p.status === 'cancelled' && p.cancelled_reason && `cancelled: ${p.cancelled_reason}`].filter(Boolean).join(' · ')}
      </div>
      {p.notes && <div style={{ fontSize: 13, color: BIZ.ink, marginTop: 4, whiteSpace: 'pre-wrap' }}>{p.notes}</div>}

      {planned && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <button style={small(true)} onClick={() => onRecord(p)}>Record the operation</button>
          <button style={small()} onClick={() => setMoving({ date: p.planned_on, time: p.planned_time?.slice(0, 5) ?? '' })}>Change date</button>
          <button style={small()} onClick={() => setCancelling('')}>Cancel surgery</button>
        </div>
      )}
      {moving && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <input type="date" min={today()} style={{ ...input, width: 160 }} value={moving.date} onChange={e => setMoving({ ...moving, date: e.target.value })} />
          <input type="time" style={{ ...input, width: 110 }} value={moving.time} onChange={e => setMoving({ ...moving, time: e.target.value })} />
          <button style={small(true)} disabled={!moving.date}
            onClick={() => run(() => rescheduleSurgery(p.id, moving.date, moving.time || null), () => setMoving(null))}>Move</button>
          <button style={small()} onClick={() => setMoving(null)}>Keep</button>
          <span style={{ fontSize: 12, color: BIZ.muted }}>Messages still to go move with it.</span>
        </div>
      )}
      {cancelling !== null && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input style={input} placeholder="Why is it cancelled?" value={cancelling} onChange={e => setCancelling(e.target.value)} />
          <button style={small(true)} disabled={cancelling.trim().length < 3}
            onClick={() => run(() => cancelPlannedSurgery(p.id, cancelling), () => setCancelling(null))}>Cancel surgery</button>
          <button style={small()} onClick={() => setCancelling(null)}>Keep</button>
        </div>
      )}

      {msgs && (msgs.length > 0 || planned) && (
        <details style={{ marginTop: 10 }} open={planned}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: BIZ.ink }}>
            <MessageCircle className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 4 }} />
            Messages to the patient ({msgs.length}{left ? `, ${left} to go` : ''})
          </summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {msgs.map(m => editing?.id === m.id ? (
              <MessageForm key={m.id} v={editing} set={setEditing}
                save={() => run(() => saveSurgeryMessage(p.id, m.id, Number(editing.day_offset), editing.send_at, editing.body), () => setEditing(null))} />
            ) : (
              <div key={m.id} style={{ fontSize: 13, borderLeft: `3px solid ${STATUS[m.status][1]}`, paddingLeft: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <b>{dayWords(m.day_offset)}</b>
                  <span style={{ color: BIZ.muted }}>{dueText(m.sent_at ?? m.due_at)}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: STATUS[m.status][1] }}>
                    {STATUS[m.status][0]}{m.status === 'sent' && m.channel ? (m.channel === 'push' ? ' · in the app' : ' · WhatsApp') : ''}
                  </span>
                  {m.status === 'pending' && planned !== false && (
                    <>
                      <button style={{ ...small(), padding: '1px 8px' }}
                        onClick={() => setEditing({ id: m.id, day_offset: String(m.day_offset), send_at: istTime(m.due_at), body: m.body })}>Change</button>
                      <button style={{ ...small(), padding: '1px 8px' }} onClick={() => run(() => skipSurgeryMessage(m.id))}>Skip</button>
                    </>
                  )}
                </div>
                <div style={{ color: BIZ.ink, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                {m.why && m.status !== 'sent' && <div style={{ fontSize: 11.5, color: BIZ.muted }}>{m.why}</div>}
              </div>
            ))}
            {p.status !== 'cancelled' && (editing?.id === null ? (
              <MessageForm v={editing} set={setEditing}
                save={() => run(() => saveSurgeryMessage(p.id, null, Number(editing.day_offset), editing.send_at, editing.body), () => setEditing(null))} />
            ) : (
              <div><button style={small()} onClick={() => setEditing({ id: null, day_offset: '1', send_at: '10:00', body: '' })}>
                <Plus className="w-3 h-3" style={{ display: 'inline', marginRight: 3 }} />Add a message</button></div>
            ))}
          </div>
        </details>
      )}
      {err && <div style={{ color: '#8a2b2b', fontSize: 13, marginTop: 6 }}>{err}</div>}
    </div>
  )
}

type MsgDraft = { id: string | null; day_offset: string; send_at: string; body: string }

export function OffsetPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const n = Number(value) || 0
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input style={{ ...input, width: 70 }} inputMode="numeric" value={String(Math.abs(n))}
        onChange={e => { const d = Math.min(Number(e.target.value.replace(/\D/g, '')) || 0, 90); onChange(String(n < 0 ? -d : d)) }} aria-label="Days" />
      <select style={{ ...input, width: 150 }} value={n < 0 ? 'before' : n === 0 ? 'day' : 'after'}
        onChange={e => onChange(e.target.value === 'day' ? '0' : String((e.target.value === 'before' ? -1 : 1) * (Math.abs(n) || 1)))}>
        <option value="before">days before</option><option value="day">on the day</option><option value="after">days after</option>
      </select>
    </span>
  )
}

function MessageForm({ v, set, save }: { v: MsgDraft; set: (v: MsgDraft | null) => void; save: () => void }) {
  return (
    <div style={{ display: 'grid', gap: 6, background: '#f6faf8', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <OffsetPicker value={v.day_offset} onChange={d => set({ ...v, day_offset: d })} />
        <span style={{ fontSize: 12.5, color: BIZ.muted }}>at</span>
        <input type="time" min="08:00" max="20:59" style={{ ...input, width: 110 }} value={v.send_at} onChange={e => set({ ...v, send_at: e.target.value })} />
      </div>
      <textarea style={{ ...input, minHeight: 64 }} maxLength={600} value={v.body} placeholder="What the patient should do that day"
        onChange={e => set({ ...v, body: e.target.value })} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={small(true)} disabled={v.body.trim().length < 10} onClick={save}>Save message</button>
        <button style={small()} onClick={() => set(null)}>Cancel</button>
        <span style={{ fontSize: 11.5, color: BIZ.muted, marginLeft: 'auto' }}>{v.body.length}/600 · sent between 8 am and 9 pm</span>
      </div>
    </div>
  )
}
