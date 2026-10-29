import { useCallback, useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { getReportsReady, markReportSeen, ReportReady } from '../../lib/labApi'

// 0288: reports signed for tests this doctor ordered, on their Today tab until
// they open one — the report itself, or the patient. A phone notification goes
// out too when the app is on their phone.

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function ReportsReady({ businessId, onOpenPatient }: { businessId: string; onOpenPatient: (memberId: string) => void }) {
  const [list, setList] = useState<ReportReady[]>([])
  const load = useCallback(() => { getReportsReady(businessId).then(setList).catch(() => setList([])) }, [businessId])
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  const seen = (r: ReportReady) => { markReportSeen(r.order_id).catch(() => {}).finally(load) }
  if (!list.length) return null
  return (
    <div className="card shadow-sm border-teal-300 space-y-2">
      <p className="font-semibold text-navy-700 text-sm flex items-center gap-2">
        <FlaskConical className="w-4 h-4" /> Reports ready ({list.length})
      </p>
      <div className="divide-y">
        {list.map(r => (
          <div key={r.order_id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <b>{r.patient_name}</b> · {r.tests ?? r.order_no}
              {r.out_of_range > 0 && <span className="ml-2 text-xs font-bold text-red-600">{r.out_of_range} out of range</span>}
              <span className="block text-xs text-gray-500">{r.order_no} · signed {when(r.approved_at)}</span>
            </span>
            <span className="flex gap-2">
              <a href={`/lab/${r.report_token}`} target="_blank" rel="noreferrer" onClick={() => seen(r)}
                className="btn-teal text-xs py-1.5 px-3">Open report</a>
              <button onClick={() => { seen(r); onOpenPatient(r.patient_member_id) }}
                className="text-xs py-1.5 px-3 rounded-lg border border-gray-300 text-gray-600">Patient</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
