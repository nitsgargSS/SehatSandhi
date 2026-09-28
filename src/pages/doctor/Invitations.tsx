import { useEffect, useState } from 'react'
import { cancelInvitation, listClinicInvitations, listMyInvitations, respondInvitation,
  type ClinicInvitation, type MyInvitation, type PersonMatch } from '../../lib/staffApi'

// 0151: one person, several clinics.
//
//   MyInvitations       top of the dashboard — clinics that invited me; accept/decline
//   ClinicInvitations   Doctors & staff — invitations this clinic sent, still open
//   PersonMatches       the add-staff forms — "already on Sehatsandhi: invite them?"

const ROLE: Record<string, string> = { doctor: 'doctor', nurse: 'nurse', receptionist: 'receptionist', manager: 'manager', owner: 'owner' }

export function MyInvitations({ onJoined }: { onJoined: () => void }) {
  const [rows, setRows] = useState<MyInvitation[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const load = () => { listMyInvitations().then(setRows).catch(() => setRows([])) }
  useEffect(load, [])
  if (!rows.length && !msg) return null

  const answer = async (i: MyInvitation, accept: boolean) => {
    setBusy(i.id); setMsg('')
    try {
      const r = await respondInvitation(i.id, accept)
      setMsg(!accept ? `You declined ${i.business_name}.`
        : r.awaiting_payment ? `✓ You joined ${i.business_name}. You can open it once the clinic pays the extra-doctor fee.`
        : `✓ You joined ${i.business_name}. Switch to it from the clinic list.`)
      load()
      if (accept) onJoined()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="card shadow-sm mb-4 border-2 border-teal-200">
      <h3 className="font-bold text-navy-700 mb-1">Invitations</h3>
      {msg && <p className="text-sm text-teal-700 mb-2">{msg}</p>}
      {rows.map(i => (
        <div key={i.id} className="py-2 flex flex-wrap items-center gap-2 text-sm border-t border-gray-100 first:border-t-0">
          <span><b>{i.business_name}</b>{i.business_city ? `, ${i.business_city}` : ''} invites you to join as a <b>{ROLE[i.role] ?? i.role}</b>
            {i.invited_by_label ? <span className="text-gray-500"> · from {i.invited_by_label}</span> : null}</span>
          <span className="ml-auto flex gap-2">
            <button disabled={busy === i.id} onClick={() => answer(i, true)} className="btn-teal text-xs py-1.5 px-3 disabled:opacity-50">Accept</button>
            <button disabled={busy === i.id} onClick={() => answer(i, false)} className="btn-outline text-xs py-1.5 px-3 disabled:opacity-50">Decline</button>
          </span>
        </div>
      ))}
      <p className="text-xs text-gray-400 mt-2">
        One login works for every clinic you join. You see one clinic at a time, and each clinic's patients stay with that clinic.
      </p>
    </div>
  )
}

export function ClinicInvitations({ businessId, refreshKey }: { businessId: string; refreshKey: number }) {
  const [rows, setRows] = useState<ClinicInvitation[]>([])
  const load = () => { listClinicInvitations(businessId).then(setRows).catch(() => setRows([])) }
  useEffect(load, [businessId, refreshKey])
  if (!rows.length) return null
  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold text-navy-700 mb-1">Invited — waiting for them to accept</h4>
      {rows.map(i => (
        <div key={i.id} className="py-1 text-sm flex gap-3 items-center">
          <span className="font-medium">{i.full_name}</span>
          <span className="text-gray-500">{ROLE[i.role] ?? i.role}</span>
          <button onClick={() => cancelInvitation(i.id).then(load, () => undefined)} className="ml-auto text-xs text-red-600 underline">Withdraw</button>
        </div>
      ))}
    </div>
  )
}

/** Shown when the email or phone typed into an add-staff form is already on Sehatsandhi. */
export function PersonMatches({ matches, onPick, onNew, onCancel }: {
  matches: PersonMatch[]
  onPick: (m: PersonMatch) => void
  onNew: () => void
  onCancel: () => void
}) {
  return (
    <div className="bg-navy-50 rounded-xl p-3 text-sm mt-3">
      <p className="font-semibold text-navy-700 mb-2">Already on Sehatsandhi with this email or phone:</p>
      {matches.map(m => {
        const here = m.here_status && m.here_status !== 'suspended'
        return (
          <div key={m.practitioner_id} className="py-1.5 flex flex-wrap items-center gap-2 border-t border-navy-100 first:border-t-0">
            <span className="font-medium">{m.full_name}</span>
            {m.speciality && <span className="text-gray-500">{m.speciality}</span>}
            {here ? <span className="text-gray-500 ml-auto">already here as {m.here_role}</span> : (
              <button onClick={() => onPick(m)} className="ml-auto btn-teal text-xs py-1 px-3">
                {m.needs_invitation ? 'Invite them' : m.here_status === 'suspended' ? 'Bring back' : 'Add them'}
              </button>
            )}
          </div>
        )
      })}
      <p className="text-xs text-gray-500 mt-2">
        Someone who already has a login, or works at another clinic, gets an invitation and joins when they accept.
      </p>
      <div className="flex gap-3 mt-2">
        <button onClick={onNew} className="text-xs underline text-navy-700">None of these — a different person</button>
        <button onClick={onCancel} className="text-xs underline text-gray-500">Cancel</button>
      </div>
    </div>
  )
}
