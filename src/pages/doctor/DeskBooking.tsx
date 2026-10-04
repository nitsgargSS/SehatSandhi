import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchOpenWindows, type TimeSlot } from '../../lib/availability'
import { listBusinessDoctors, type BusinessDoctor } from '../../lib/doctorsApi'
import { phoneProblem } from '../../lib/credentials'
import PhoneError from '../../components/PhoneError'

// 0152: book an appointment at the desk, into the same open slots the WhatsApp
// bot offers — so a doctor's leave, their hours at another clinic and full
// slots are all respected. A nurse sees only the doctors they work with.

export default function DeskBooking({ businessId, onBooked }: { businessId: string; onBooked: () => void }) {
  const today = new Date().toLocaleDateString('en-CA')
  const [doctors, setDoctors] = useState<BusinessDoctor[]>([])
  const [doctorId, setDoctorId] = useState('')
  const [date, setDate] = useState(today)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [slot, setSlot] = useState('')
  const [p, setP] = useState({ name: '', phone: '', age: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    listBusinessDoctors(businessId).then(d => { setDoctors(d); if (d.length === 1) setDoctorId(d[0].practitioner_id) }).catch(() => setDoctors([]))
  }, [businessId])

  useEffect(() => {
    setSlot(''); setSlots([])
    if (!doctorId || !date) return
    // Noon, not midnight: fetchOpenWindows sends the UTC date, and IST midnight
    // is the previous day in UTC.
    fetchOpenWindows(businessId, new Date(`${date}T12:00`), doctorId).then(setSlots)
  }, [businessId, doctorId, date])

  const book = async () => {
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.rpc('sehat_desk_book', {
      p_business: businessId, p_practitioner: doctorId, p_slot: slot,
      p_name: p.name, p_phone: p.phone, p_age: p.age.trim() ? Number(p.age) : null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    const when = slots.find(s => s.datetime === slot)?.time
    setMsg(`✓ Booked ${p.name} with ${doctors.find(d => d.practitioner_id === doctorId)?.full_name} on ${new Date(`${date}T12:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} at ${when}.`)
    setP({ name: '', phone: '', age: '' }); setSlot('')
    fetchOpenWindows(businessId, new Date(`${date}T12:00`), doctorId).then(setSlots)
    onBooked()
  }

  if (!doctors.length) return null
  const open = slots.filter(s => s.available)
  const why = slots.length && !open.length
    ? (slots.every(s => s.blockedElsewhere) ? 'The doctor is on leave or at another clinic that day.' : 'Every slot that day is full.')
    : !slots.length ? 'The doctor does not sit on this day.' : ''

  return (
    <div className="card shadow-sm">
      <h3 className="font-bold text-navy-700 mb-1">Book an appointment</h3>
      <p className="text-sm text-gray-500 mb-3">For a patient on the phone or at the desk. Only free slots are shown.</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {doctors.length > 1 && (
          <select className="input-field text-sm w-auto" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
            <option value="">Choose a doctor…</option>
            {doctors.map(d => <option key={d.practitioner_id} value={d.practitioner_id}>{d.full_name}</option>)}
          </select>
        )}
        <input type="date" className="input-field text-sm w-auto" min={today} value={date} onChange={e => setDate(e.target.value)} />
      </div>

      {doctorId && (
        open.length ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {open.map(s => (
              <button key={s.datetime} onClick={() => setSlot(s.datetime)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${slot === s.datetime ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200 hover:border-teal-400'}`}>
                {s.time}{s.capacity && s.capacity > 1 ? ` (${s.seatsLeft})` : ''}
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-amber-700 mb-3">{why}</p>
      )}

      {slot && (
        <div className="grid sm:grid-cols-4 gap-2">
          <input className="input-field text-sm sm:col-span-2" placeholder="Patient name" value={p.name} onChange={e => setP(v => ({ ...v, name: e.target.value }))} />
          <div>
            <input className="input-field text-sm w-full" placeholder="Mobile (10 digits)" inputMode="tel" value={p.phone} onChange={e => setP(v => ({ ...v, phone: e.target.value.replace(/[^\d+ ]/g, '') }))} />
            <PhoneError value={p.phone} />
          </div>
          <input className="input-field text-sm" placeholder="Age" inputMode="numeric" value={p.age} onChange={e => setP(v => ({ ...v, age: e.target.value }))} />
          <button onClick={book} disabled={busy || !p.name.trim() || !!phoneProblem(p.phone)}
            className="btn-teal text-sm py-2 px-4 disabled:opacity-50 sm:col-span-4 sm:w-auto sm:justify-self-start">
            {busy ? 'Booking…' : 'Book'}
          </button>
        </div>
      )}
      {(msg || err) && <p className={`text-sm mt-2 ${err ? 'text-red-600' : 'text-teal-700'}`}>{err || msg}</p>}
    </div>
  )
}
