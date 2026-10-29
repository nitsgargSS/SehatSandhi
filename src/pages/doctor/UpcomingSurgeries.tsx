import { useEffect, useState } from 'react'
import { Scissors } from 'lucide-react'
import { upcomingSurgeries, UpcomingSurgery } from '../../lib/surgeryApi'

// 0289: surgeries planned for the next seven days, on the Today tab — who,
// what, when, and how many messages to the patient are still to go.

const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

export default function UpcomingSurgeries({ businessId, onOpenPatient }: { businessId: string; onOpenPatient: (memberId: string) => void }) {
  const [list, setList] = useState<UpcomingSurgery[]>([])
  useEffect(() => { upcomingSurgeries(businessId, 7).then(setList).catch(() => setList([])) }, [businessId])
  if (!list.length) return null
  return (
    <div className="card shadow-sm space-y-2">
      <p className="font-semibold text-navy-700 text-sm flex items-center gap-2"><Scissors className="w-4 h-4" /> Surgeries this week ({list.length})</p>
      <div className="divide-y">
        {list.map(s => (
          <button key={s.id} onClick={() => onOpenPatient(s.patient_member_id)} className="w-full text-left py-2 text-sm flex flex-wrap justify-between gap-2 hover:bg-gray-50">
            <span><b>{s.patient_name}</b> · {s.procedure_name}{s.surgeon_name ? ` · ${s.surgeon_name}` : ''}</span>
            <span className="text-xs text-gray-500">
              {s.ot_type === 'major' ? 'Major' : 'Minor'} · {day(s.planned_on)}{s.planned_time ? ` ${s.planned_time.slice(0, 5)}` : ''}
              {s.messages_left > 0 && ` · ${s.messages_left} message${s.messages_left === 1 ? '' : 's'} to go`}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
