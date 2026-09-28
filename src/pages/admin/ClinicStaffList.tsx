import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import StaffCodeModal from '../doctor/StaffCodeModal'

// 0148: a clinic's staff as Sehatsandhi sees it, inside a business's Verify
// panel. Admins and managers may remove or bring back a staff member — with
// the same emailed code and reason the clinic's owner uses — for the call that
// says "Dr X has left". Hiring and roles stay with the clinic.

interface Row {
  practitioner_id: string
  role: string | null
  status: string
  awaiting_payment?: boolean
  practitioners: { full_name: string; phone: string | null; email: string | null; auth_uid: string | null } | null
}

export default function ClinicStaffList({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [msg, setMsg] = useState('')
  const [change, setChange] = useState<{ action: 'remove' | 'restore'; row: Row } | null>(null)

  const load = () => {
    supabase.from('business_practitioners')
      .select('practitioner_id, role, status, awaiting_payment, practitioners(full_name, phone, email, auth_uid)')
      .eq('business_id', businessId).order('sort_order')
      .then(({ data }) => setRows((data as unknown as Row[]) ?? []))
  }
  useEffect(load, [businessId])

  if (!rows.length) return null

  return (
    <div className="mt-4">
      <p className="font-bold text-navy-700 text-sm mb-2">Staff</p>
      {msg && <p className="text-xs text-teal-700 mb-2">{msg}</p>}
      <div className="divide-y divide-navy-100 text-xs">
        {rows.map(r => {
          const off = r.status === 'suspended'
          return (
            <div key={r.practitioner_id} className={`py-1.5 flex items-center gap-2 flex-wrap ${off ? 'opacity-60' : ''}`}>
              <span className="font-medium text-gray-700">{r.practitioners?.full_name}</span>
              <span className="capitalize text-gray-500">{r.role ?? 'doctor'}</span>
              <span className="text-gray-400">{off ? 'removed' : r.awaiting_payment ? 'fee pending' : r.status}</span>
              {r.practitioners?.phone && <span className="text-gray-400">{r.practitioners.phone}</span>}
              <span className="text-gray-400">{r.practitioners?.auth_uid ? 'has login' : 'no login yet'}</span>
              <button onClick={() => { setMsg(''); setChange({ action: off ? 'restore' : 'remove', row: r }) }}
                className={`ml-auto px-2 py-1 rounded-lg font-medium ${off ? 'bg-teal-50 text-teal-700 hover:bg-teal-100' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                {off ? 'Bring back' : 'Remove'}
              </button>
            </div>
          )
        })}
      </div>
      {change && (
        <StaffCodeModal businessId={businessId} action={change.action}
          person={{ id: change.row.practitioner_id, name: change.row.practitioners?.full_name ?? 'this person', currentRole: change.row.role }}
          onClose={() => setChange(null)}
          onDone={() => {
            setMsg(`✓ ${change.row.practitioners?.full_name} ${change.action === 'remove' ? 'removed' : 'brought back'}. The clinic and the staff member were emailed.`)
            setChange(null)
            load()
          }} />
      )}
    </div>
  )
}
