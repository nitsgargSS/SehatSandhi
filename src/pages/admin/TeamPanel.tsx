import { useEffect, useState } from 'react'
import { addManager, listActivity, listTeam, setMemberActive, type StaffActivity, type TeamMember } from '../../lib/teamApi'

// 0145: the Team tab (full admins only) and the activity feed it shares with a
// manager's Account tab. Who is on the team, adding and switching off managers,
// and what each person approved, rejected, disabled or changed.

const ACTION_LABEL: Record<string, string> = {
  business_approved: 'Approved business',
  business_rejected: 'Rejected business',
  business_reactivated: 'Reactivated business',
  business_disabled: 'Disabled business',
  business_status: 'Changed business status',
  phone_verified: 'Marked phone verified',
  camp_approved: 'Approved camp/offer',
  camp_rejected: 'Rejected camp/offer',
  camp_status: 'Changed camp/offer status',
  imr_confirmed: 'Confirmed IMR registration',
  imr_no_match: 'Marked IMR registration wrong',
  imr_unchecked: 'Reset IMR check',
  speciality_changed: 'Changed speciality',
  lead_created: 'Added lead',
  lead_updated: 'Updated lead',
  manager_added: 'Added manager',
  manager_deactivated: 'Deactivated manager',
  manager_reactivated: 'Reactivated manager',
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

function detailLine(a: StaffActivity): string {
  const d = a.detail as Record<string, string | null | undefined>
  const parts: string[] = []
  if (d.from !== undefined && d.to !== undefined) parts.push(`${d.from ?? '—'} → ${d.to ?? '—'}`)
  if (d.stage_from !== d.stage_to && d.stage_to) parts.push(`stage ${d.stage_from ?? '—'} → ${d.stage_to}`)
  if (d.followup_to && d.followup_from !== d.followup_to) parts.push(`follow-up ${d.followup_to}`)
  if (d.note) parts.push(`“${d.note}”`)
  return parts.join(' · ')
}

/** Recent actions. An admin may filter by person; a manager is shown only their own by RLS. */
export function ActivityFeed({ members, title = 'Activity' }: { members?: TeamMember[]; title?: string }) {
  const [rows, setRows] = useState<StaffActivity[]>([])
  const [who, setWho] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    listActivity({ actorUid: who || null, limit: 150 }).then(setRows).catch(e => setError(e.message))
  }, [who])

  return (
    <div className="card shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="font-bold text-navy-700">{title}</h3>
        {members && (
          <select className="input-field w-auto text-sm" value={who} onChange={e => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {members.map(m => <option key={m.id} value={m.auth_uid}>{m.full_name || m.email}</option>)}
          </select>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && rows.length === 0 && <p className="text-sm text-gray-400">Nothing yet.</p>}
      <div className="divide-y divide-gray-100">
        {rows.map(a => (
          <div key={a.id} className="py-2 text-sm flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="text-gray-400 whitespace-nowrap">{when(a.created_at)}</span>
            {members && <span className="text-gray-600">{a.actor_email ?? 'system'}{a.actor_role === 'manager' ? ' (manager)' : ''}</span>}
            <span className="font-medium text-navy-700">{ACTION_LABEL[a.action] ?? a.action}</span>
            {a.entity_name && <span className="text-gray-700">{a.entity_name}</span>}
            {detailLine(a) && <span className="text-gray-500 w-full sm:w-auto">{detailLine(a)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TeamPanel() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    listTeam().then(setMembers).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const add = async () => {
    setBusy(true); setError(''); setMsg('')
    try {
      const r = await addManager(form)
      setMsg(r.emailed
        ? `✓ ${r.member.full_name} added. We emailed them how to sign in.`
        : `✓ ${r.member.full_name} added, but the welcome email failed (${r.emailError}). Tell them to sign in with their email.`)
      setForm({ fullName: '', email: '', phone: '' })
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (m: TeamMember) => {
    const verb = m.is_active ? 'Deactivate' : 'Reactivate'
    if (m.is_active && !window.confirm(`${verb} ${m.full_name || m.email}? They lose access immediately.`)) return
    setError(''); setMsg('')
    try {
      await setMemberActive(m.id, !m.is_active)
      setMsg(`✓ ${m.full_name || m.email} ${m.is_active ? 'deactivated' : 'reactivated'}.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-navy-700">Team</h2>
        <p className="text-sm text-gray-500 mt-1">
          Managers approve businesses and camps, work leads, and read reports. They cannot see patients, GST,
          coupons, insights or wallet money, and cannot change billing.
        </p>
      </div>

      {(msg || error) && (
        <div className={`rounded-xl p-3 text-sm ${error ? 'bg-red-50 text-red-600' : 'bg-teal-50 text-teal-700'}`}>{error || msg}</div>
      )}

      <div className="card shadow-sm">
        <h3 className="font-bold text-navy-700 mb-3">People</h3>
        {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b">
                  <th className="text-left py-2 px-2">Name</th>
                  <th className="text-left py-2 px-2">Email</th>
                  <th className="text-left py-2 px-2">Phone</th>
                  <th className="text-left py-2 px-2">Role</th>
                  <th className="text-left py-2 px-2">Last sign-in</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id} className={`border-b border-gray-50 ${m.is_active ? '' : 'opacity-50'}`}>
                    <td className="py-2 px-2 font-medium text-navy-700">{m.full_name || '—'}</td>
                    <td className="py-2 px-2">{m.email}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{m.phone ? `+${m.phone}` : '—'}</td>
                    <td className="py-2 px-2 capitalize">{m.role === 'owner' ? 'admin' : m.role}{m.is_active ? '' : ' (off)'}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-gray-500">{when(m.last_sign_in_at)}</td>
                    <td className="py-2 px-2 text-right">
                      {m.role === 'manager' && (
                        <button onClick={() => toggle(m)}
                          className={`text-xs font-medium px-3 py-1.5 rounded-lg ${m.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'}`}>
                          {m.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card shadow-sm max-w-xl">
        <h3 className="font-bold text-navy-700 mb-3">Add a manager</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Full name</label>
            <input className="input-field" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Email (they sign in with it)</label>
            <input className="input-field" type="email" autoComplete="off" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Mobile number</label>
            <input className="input-field" inputMode="tel" placeholder="98765 43210" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <p className="text-xs text-gray-400">
            Use an email that is not a clinic or doctor login. Each phone number can belong to one team member only.
          </p>
          <button onClick={add} disabled={busy || !form.fullName.trim() || !form.email.trim() || !form.phone.trim()}
            className="btn-teal text-sm py-2 px-5 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add manager'}
          </button>
        </div>
      </div>

      <ActivityFeed members={members} title="What the team did" />
    </div>
  )
}
