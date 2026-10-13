import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// What patients said about this clinic — the stars and words that show on its
// public profile, here for the doctor and the desk. Ratings carry no name or
// number: a review is the patient's own, and the clinic cannot edit or remove one.
interface Review { id: string; overall_rating: number; review_text: string | null; created_at: string }

const when = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function ReviewsCard({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<Review[] | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    supabase.from('ratings').select('id, overall_rating, review_text, created_at')
      .eq('business_id', businessId).eq('is_visible', true).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setRows((data ?? []) as Review[]))
  }, [businessId])

  if (!rows) return null
  const n = rows.length
  const avg = n ? rows.reduce((s, r) => s + r.overall_rating, 0) / n : 0
  const shown = all ? rows : rows.slice(0, 5)
  return (
    <div className="card shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3 className="font-bold text-navy-700">Patient reviews</h3>
        {n > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
            <b>{avg.toFixed(1)}</b><span className="text-gray-500">from {n} review{n === 1 ? '' : 's'}</span>
          </div>
        )}
      </div>
      {n === 0 ? (
        <p className="text-sm text-gray-500">No reviews yet. Patients can rate you from the Review QR (Clinic &amp; team), from “Ask for review” in the visit register, or after a booked visit.</p>
      ) : (
        <div className="divide-y">
          {shown.map(r => (
            <div key={r.id} className="py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-amber-500 tracking-tight" aria-label={`${r.overall_rating} out of 5`}>{'★'.repeat(r.overall_rating)}<span className="text-gray-300">{'★'.repeat(5 - r.overall_rating)}</span></span>
                <span className="text-xs text-gray-400">{when(r.created_at)}</span>
              </div>
              {r.review_text ? <p className="text-gray-800 mt-1 whitespace-pre-wrap">“{r.review_text}”</p> : <p className="text-gray-400 mt-1">Rated without writing a review.</p>}
            </div>
          ))}
        </div>
      )}
      {n > 5 && <button onClick={() => setAll(a => !a)} className="text-teal-700 text-sm font-semibold mt-2 hover:underline">{all ? 'Show fewer' : `Show all ${n}`}</button>}
      {n > 0 && <p className="text-xs text-gray-500 mt-3">These show on your public profile. Reviews are the patient's own words; they carry no name or number, and cannot be edited.</p>}
    </div>
  )
}
