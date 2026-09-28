import { useEffect, useState } from 'react'
import { linkNurse, listNurseLinks, setWardNurse, unlinkNurse, type NurseLink } from '../../lib/nurseApi'
import { registerPractitioner } from '../../lib/identityApi'
import { supabase } from '../../lib/supabase'
import StaffCodeModal from './StaffCodeModal'
import { PersonMatches } from './Invitations'
import { findPeople, type PersonMatch } from '../../lib/staffApi'

// 0149: nurses and the doctors they work for, on Doctors & staff (owner and
// manager) and in My practice (a doctor's own nurses). The database decides
// who may link whom; these only show and ask.

export interface StaffLite { id: string; name: string; role: string | null; status: string; ward_nurse?: boolean }

const active = (s: StaffLite) => s.status !== 'suspended'
export const doctorsOf = (staff: StaffLite[]) => staff.filter(s => active(s) && (s.role === 'doctor' || s.role === 'owner'))
export const nursesOf = (staff: StaffLite[]) => staff.filter(s => active(s) && s.role === 'nurse')

/** Nurses who can see no patients: no doctor, and not a ward nurse. */
export function UnlinkedNursesAlert({ staff, links }: { staff: StaffLite[]; links: NurseLink[] }) {
  const lonely = nursesOf(staff).filter(n => !n.ward_nurse && !links.some(l => l.nurse_id === n.id))
  if (!lonely.length) return null
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 mb-3">
      <b>{lonely.map(n => n.name).join(', ')}</b> {lonely.length === 1 ? 'is' : 'are'} not linked to any doctor, so they
      cannot see any patients. Link them to a doctor below, make them a ward nurse, or remove them if they have left.
    </div>
  )
}

/** On a staff row: a nurse's doctors (editable), or a doctor's nurses. */
export function NurseLinksLine({ businessId, person, staff, links, canEdit, onChanged }: {
  businessId: string
  person: StaffLite
  staff: StaffLite[]
  links: NurseLink[]
  canEdit: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!active(person)) return null
  const nameOf = (id: string) => staff.find(s => s.id === id)?.name ?? '—'

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn(); onChanged() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (person.role === 'doctor' || person.role === 'owner') {
    const mine = links.filter(l => l.doctor_id === person.id).map(l => nameOf(l.nurse_id))
    return mine.length ? <div className="text-xs text-gray-500 mt-1">Nurses: {mine.join(', ')}</div> : null
  }
  if (person.role !== 'nurse') return null

  const linked = links.filter(l => l.nurse_id === person.id).map(l => l.doctor_id)
  const free = doctorsOf(staff).filter(d => !linked.includes(d.id))
  return (
    <div className="text-xs mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-gray-500">Works for:</span>
      {linked.length === 0 && <span className="text-amber-700">no doctor</span>}
      {linked.map(id => (
        <span key={id} className="inline-flex items-center gap-1 bg-teal-50 text-teal-800 rounded-full px-2 py-0.5">
          {nameOf(id)}
          {canEdit && (
            <button disabled={busy} aria-label={`Unlink ${nameOf(id)}`} className="text-teal-600 hover:text-red-600"
              onClick={() => run(() => unlinkNurse(businessId, person.id, id))}>×</button>
          )}
        </span>
      ))}
      {canEdit && free.length > 0 && (
        <select className="input-field text-xs py-0.5 px-2 w-auto" value="" disabled={busy}
          onChange={e => e.target.value && run(() => linkNurse(businessId, person.id, e.target.value))}>
          <option value="">+ link to a doctor</option>
          {free.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {canEdit && (
        <label className="inline-flex items-center gap-1 ml-2 text-gray-600" title="Sees every admitted patient, whoever the doctor">
          <input type="checkbox" checked={!!person.ward_nurse} disabled={busy}
            onChange={e => run(() => setWardNurse(businessId, person.id, e.target.checked))} />
          Ward nurse (all admitted patients)
        </label>
      )}
      {err && <span className="text-red-600 w-full">{err}</span>}
    </div>
  )
}

/**
 * My practice → My nurses, for a doctor. Their nurses, linking a nurse already
 * at the clinic, and adding a new one — confirmed by emailed code (0147), and
 * linked to this doctor on the spot. The owner is emailed about the new nurse.
 */
export function MyNurses({ businessId, practitionerId }: { businessId: string; practitionerId: string }) {
  const [staff, setStaff] = useState<StaffLite[]>([])
  const [links, setLinks] = useState<NurseLink[]>([])
  const [form, setForm] = useState({ name: '', phone: '', email: '' })
  const [adding, setAdding] = useState<{ id: string; name: string } | null>(null)
  const [matches, setMatches] = useState<PersonMatch[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = () => {
    supabase.from('business_practitioners').select('practitioner_id, role, status, ward_nurse, practitioners(full_name)')
      .eq('business_id', businessId)
      .then(({ data }) => setStaff(((data ?? []) as unknown as {
        practitioner_id: string; role: string | null; status: string; ward_nurse: boolean; practitioners: { full_name: string } | null
      }[]).filter(r => r.practitioners).map(r => ({
        id: r.practitioner_id, name: r.practitioners!.full_name, role: r.role, status: r.status, ward_nurse: r.ward_nurse,
      }))))
    listNurseLinks(businessId).then(setLinks, () => setLinks([]))
  }
  useEffect(load, [businessId])

  const mine = links.filter(l => l.doctor_id === practitionerId).map(l => l.nurse_id)
  const others = nursesOf(staff).filter(n => !mine.includes(n.id))
  const nameOf = (id: string) => staff.find(s => s.id === id)?.name ?? '—'

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setMsg('')
    try { await fn(); load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const startAdd = (skipLookup = false) => run(async () => {
    // 0151: a nurse already on Sehatsandhi (another clinic, or a login) is invited.
    if (!skipLookup) {
      const found = await findPeople(businessId, form.email, form.phone)
      if (found.length) { setMatches(found); return }
    }
    setMatches(null)
    const id = await registerPractitioner({
      fullName: form.name.trim(), phone: form.phone, email: form.email.trim(), role: 'nurse',
    })
    setAdding({ id, name: form.name.trim() })
  })

  return (
    <div className="card shadow-sm mt-6">
      <h3 className="font-bold text-navy-700 mb-1">My nurses</h3>
      <p className="text-sm text-gray-500 mb-3">
        A nurse sees the patients, queue and admissions of the doctors they work for, and records vitals for them.
      </p>
      {(msg || err) && <p className={`text-sm mb-3 ${err ? 'text-red-600' : 'text-teal-700'}`}>{err || msg}</p>}

      {mine.length === 0 ? <p className="text-sm text-gray-400 mb-3">No nurses yet.</p> : (
        <div className="flex flex-wrap gap-2 mb-3">
          {mine.map(id => (
            <span key={id} className="inline-flex items-center gap-1 bg-teal-50 text-teal-800 rounded-full px-3 py-1 text-sm">
              {nameOf(id)}
              <button disabled={busy} aria-label={`Stop working with ${nameOf(id)}`} className="text-teal-600 hover:text-red-600"
                onClick={() => run(() => unlinkNurse(businessId, id, practitionerId))}>×</button>
            </span>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <select className="input-field text-sm w-auto mb-4" value="" disabled={busy}
          onChange={e => e.target.value && run(() => linkNurse(businessId, e.target.value, practitionerId))}>
          <option value="">+ A nurse already at the clinic</option>
          {others.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      )}

      <div className="border-t border-gray-100 pt-3">
        <p className="text-sm font-medium text-gray-700 mb-2">Add a new nurse</p>
        <div className="grid sm:grid-cols-3 gap-2">
          <input className="input-field text-sm" placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className="input-field text-sm" placeholder="Mobile" inputMode="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          <input className="input-field text-sm" placeholder="Email (they sign in with it)" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <button onClick={() => startAdd()} disabled={busy || !form.name.trim() || !form.phone.trim() || !form.email.trim()}
          className="btn-teal text-sm py-2 px-4 mt-2 disabled:opacity-50">Add nurse</button>
      </div>

      {matches && (
        <PersonMatches matches={matches}
          onPick={m => { setMatches(null); setAdding({ id: m.practitioner_id, name: m.full_name }) }}
          onNew={() => startAdd(true)} onCancel={() => setMatches(null)} />
      )}

      {adding && (
        <StaffCodeModal businessId={businessId} action="add" role="nurse" person={adding}
          onClose={() => setAdding(null)}
          onDone={done => {
            const who = adding
            setAdding(null)
            setForm({ name: '', phone: '', email: '' })
            // Their login invite is queued by the database (0149): the invite
            // function is for owners and managers.
            setMsg(done.result.status === 'invited'
              ? `✓ Invitation sent to ${who.name}. They become your nurse once they accept it.`
              : `✓ ${who.name} added as your nurse and invited to set up their login. The clinic owner has been told.`)
            load()
          }} />
      )}
    </div>
  )
}
