import { useEffect, useState } from 'react'
import {
  DOCTOR_SPECIALITIES, MAX_OTHER_SPECIALITIES, listSubSpecialities, subsFor, type SubSpeciality,
} from '../lib/specialitiesApi'

// What else a doctor practises, beside their main speciality (0221):
// up to two more specialities, and the problems they treat. An MD physician
// ticks Diabetes and Thyroid here and is then found when a patient searches
// "sugar" — beside the diabetologist, not instead of them.

const chip = (on: boolean, dim = false) =>
  `text-xs px-3 py-1.5 rounded-full border transition ${on ? 'bg-teal-50 border-teal-500 text-teal-800 font-semibold'
    : dim ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed' : 'bg-white border-gray-200 text-gray-600 hover:border-teal-300'}`

export default function SpecialityChooser({ main, other, subs, onChange }: {
  /** The main speciality's code — chosen elsewhere, and not offered again here. */
  main: string
  other: string[]
  subs: string[]
  onChange: (other: string[], subs: string[]) => void
}) {
  const [all, setAll] = useState<SubSpeciality[]>([])
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { listSubSpecialities().then(setAll) }, [])

  const full = other.length >= MAX_OTHER_SPECIALITIES
  const toggleOther = (id: string) =>
    onChange(other.includes(id) ? other.filter(x => x !== id) : full ? other : [...other, id], subs)
  const toggleSub = (code: string) =>
    onChange(other, subs.includes(code) ? subs.filter(x => x !== code) : [...subs, code])

  // The problems a doctor of these specialities usually treats come first; the
  // rest are behind "show all". Anything already ticked always shows.
  const usual = subsFor(all, [main, ...other])
  const shown = showAll ? all : all.filter(s => usual.includes(s) || subs.includes(s.code))

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-xs font-medium text-gray-600 mb-1">
          Other specialities you practise <span className="text-gray-400 font-normal">— up to {MAX_OTHER_SPECIALITIES} more</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {DOCTOR_SPECIALITIES.filter(s => s.id !== main).map(s => {
            const on = other.includes(s.id)
            return (
              <button key={s.id} type="button" disabled={!on && full} onClick={() => toggleOther(s.id)} className={chip(on, !on && full)}>
                {s.en}
              </button>
            )
          })}
        </div>
      </div>
      {all.length > 0 && (
        <div>
          <span className="block text-xs font-medium text-gray-600 mb-1">
            Problems you treat <span className="text-gray-400 font-normal">— tick all that apply; patients who search for one will find you</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {shown.map(s => (
              <button key={s.code} type="button" onClick={() => toggleSub(s.code)} className={chip(subs.includes(s.code))}>
                {s.name_en}
              </button>
            ))}
            {!showAll && shown.length < all.length && (
              <button type="button" onClick={() => setShowAll(true)} className="text-xs px-3 py-1.5 text-teal-700 underline">
                Show all {all.length}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
