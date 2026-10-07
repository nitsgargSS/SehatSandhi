import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SPECIALITIES } from '../../types'
import { supabase } from '../../lib/supabase'
import {
  bookAppointment, findCamps, findDoctors, findPlaces, me, openTimes, whereAmI,
  type Booked, type Camp, type Me,
} from '../../lib/patientApi'
import { day, Err, MyShell, SignIn } from './MyShell'

// Book a doctor or a lab test on the website (0198) — search needs no login;
// the booking itself is on the number proven with the WhatsApp code, through
// the same open slots the bot, the app and the clinic desk use.
const NOT_DOCTORS = ['LAB', 'PATH', 'RAD', 'PHARMACY']
const DOCTORS = SPECIALITIES.filter(s => !NOT_DOCTORS.includes(s.id))
const DAYS = ['Today', 'Tomorrow', 'Day after']
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const slotText = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const KEY = 'sehat:lastPin'
const lastPin = () => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } }

type Card = { key: string; business: string; doctor: string | null; title: string; sub: string; address: string | null; fee: number | null; day: number; slots: string[] }

function Book() {
  const [q] = useSearchParams()
  const [what, setWhat] = useState(q.get('sp') ?? '')           // a speciality code, or 'LAB'
  const [pin, setPin] = useState(lastPin())
  const [dayN, setDayN] = useState(0)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState<{ card: Card; slot: string } | null>(null)

  const search = async () => {
    if (!what) { setErr('Choose the kind of doctor, or a lab test.'); return }
    if (!/^[1-9][0-9]{5}$/.test(pin)) { setErr('Enter a 6-digit PIN code.'); return }
    try { localStorage.setItem(KEY, pin) } catch { /* fine */ }
    setBusy(true); setErr(''); setPick(null)
    try {
      const rows: Omit<Card, 'day' | 'slots'>[] = what === 'LAB'
        ? (await findPlaces('lab', pin)).map(l => ({ key: l.business_id, business: l.business_id, doctor: null, title: l.title, sub: l.avg_rating != null ? `★ ${l.avg_rating} · ${l.total_reviews} reviews` : 'New on Sehatsandhi', address: l.address, fee: null }))
        : (await findDoctors(what, pin)).map(d => ({ key: `${d.practitioner_id}|${d.business_id}`, business: d.business_id, doctor: d.practitioner_id, title: d.full_name,
            sub: `${d.qualification ? `${d.qualification} · ` : ''}${d.business_name}${d.nearby ? '' : ' · in your district'}`, address: d.address, fee: d.consultation_fee }))
      // 0214: nobody here — this patient's unmet need, counted for "unmet demand served".
      if (!rows.length) supabase.rpc('sehat_note_unmet', { p_speciality: what === 'LAB' ? 'lab' : what, p_pin: pin }).then(() => undefined, () => undefined)
      setCards(await Promise.all(rows.slice(0, 20).map(async r => ({ ...r, ...(await openTimes(r.business, r.doctor, dayN).then(t => ({ day: t.day, slots: t.slots }))) }))))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { if (what && pin.length === 6 && cards) search() }, [dayN]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="card flex flex-col gap-3">
        <label className="text-sm font-semibold text-gray-700 flex flex-col gap-1">What do you need?
          <select className="input-field" value={what} onChange={e => setWhat(e.target.value)}>
            <option value="">Choose…</option>
            <optgroup label="Doctors / डॉक्टर">{DOCTORS.map(s => <option key={s.id} value={s.id}>{s.en} — {s.hi}</option>)}</optgroup>
            <optgroup label="Tests / जांच"><option value="LAB">🧪 Lab test (blood test, X-ray, scan) — जांच</option></optgroup>
          </select>
        </label>
        <div className="flex gap-2 items-end">
          <label className="text-sm font-semibold text-gray-700 flex flex-col gap-1 flex-1">PIN code
            <input className="input-field" inputMode="numeric" maxLength={6} placeholder="110001" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
          </label>
          <button type="button" onClick={() => whereAmI().then(p => p.pin ? setPin(p.pin) : setErr('Could not find your PIN code from your location. Please type it.')).catch(e => setErr((e as Error).message))}
            className="text-sm font-bold text-teal-700 border border-teal-600 rounded-lg px-3 py-2.5 whitespace-nowrap">📍 Use my location</button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {DAYS.map((d, i) => <button key={d} type="button" onClick={() => setDayN(i)}
            className={`text-sm font-bold rounded-full px-3 py-1.5 border ${dayN === i ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-teal-700 border-teal-600'}`}>{d}</button>)}
        </div>
        <Err msg={err} />
        <button onClick={search} disabled={busy} className="btn-teal justify-center disabled:opacity-50">{busy ? 'Searching…' : 'Show doctors and times'}</button>
      </div>

      {cards && !cards.length && <p className="text-gray-500">Nobody near {pin} has joined Sehatsandhi for this yet. We are growing across India and will be in your area soon. Try a nearby PIN code or town.</p>}
      {cards?.map(c => (
        <div key={c.key} className="card p-4">
          <p className="font-bold text-gray-800 text-lg">{c.title}</p>
          <p className="text-sm text-gray-600">{c.sub}</p>
          {c.address && <p className="text-sm text-gray-500">{c.address}</p>}
          {!!c.fee && <p className="text-sm text-gray-500">Fee ₹{c.fee}</p>}
          {c.slots.length ? (
            <>
              <p className="text-xs font-bold text-gray-500 mt-3 mb-1">Open {DAYS[c.day]?.toLowerCase() ?? day(c.slots[0])}:</p>
              <div className="flex flex-wrap gap-2">
                {c.slots.map(s => (
                  <button key={s} onClick={() => setPick({ card: c, slot: s })}
                    className={`text-sm font-extrabold rounded-lg px-3 py-2 ${pick?.slot === s && pick.card.key === c.key ? 'bg-teal-600 text-white' : 'bg-emerald-50 text-teal-700 hover:bg-emerald-100'}`}>{time(s)}</button>
                ))}
              </div>
            </>
          ) : <p className="text-sm text-gray-500 mt-2">No open times in the next 3 days.</p>}
          {pick?.card.key === c.key && <Confirm card={c} slot={pick.slot} />}
        </div>
      ))}
    </>
  )
}

function Confirm({ card, slot }: { card: Card; slot: string }) {
  const [who, setWho] = useState<Me | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Booked | null>(null)
  const reload = () => me().then(m => { setWho(m); if (m?.name) setName(n => n || m.name!) }).catch(() => setWho(null))
  useEffect(() => { reload() }, [])

  if (done) return (
    <div className="mt-4 border-2 border-teal-500 rounded-xl p-4 bg-emerald-50">
      <p className="font-extrabold text-teal-700 text-lg">✅ Booked</p>
      <p className="text-gray-800">{done.name}{done.doctor ? ` · ${done.doctor}` : ''}<br />{done.clinic}<br /><b>{slotText(done.at)}</b></p>
      {done.address && <p className="text-sm text-gray-500">{done.address}</p>}
      <p className="text-sm text-gray-500 mt-1">Please arrive 10 minutes early. The clinic has your booking.</p>
      <Link to="/my" className="btn-teal mt-3">See my bookings</Link>
    </div>
  )
  return (
    <div className="mt-4 border border-gray-200 rounded-xl p-4 bg-gray-50 flex flex-col gap-3">
      <p className="text-gray-800">{card.doctor ? `${card.title}, ` : ''}{card.doctor ? card.sub.split(' · ').slice(-1)[0] : card.title}<br /><b>{slotText(slot)}</b></p>
      {who === undefined ? <p className="text-gray-400">…</p> : !who ? <SignIn onDone={reload} /> : (
        <form className="flex flex-col gap-3" onSubmit={async e => {
          e.preventDefault(); setBusy(true); setErr('')
          try { setDone(await bookAppointment(card.business, card.doctor, slot, name, age.trim() ? Number(age) : null)) }
          catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
        }}>
          <p className="text-sm text-gray-500">Booking on +{who.phone}. Who is the patient?</p>
          <div className="flex gap-2 flex-wrap">
            <input className="input-field flex-1 min-w-[12rem]" placeholder="Patient's name" value={name} onChange={e => setName(e.target.value)} />
            <input className="input-field w-28" placeholder="Age" inputMode="numeric" maxLength={3} value={age} onChange={e => setAge(e.target.value.replace(/\D/g, ''))} />
          </div>
          <Err msg={err} />
          <button className="btn-teal justify-center disabled:opacity-50" disabled={busy || !name.trim()}>{busy ? 'Booking…' : 'Confirm booking'}</button>
        </form>
      )}
    </div>
  )
}

export default function MyBook() {
  return <MyShell title="Book an appointment" needsLogin={false}><Book /></MyShell>
}

// ── Camps & offers (0199), public ──────────────────────────────────────────
function CampsList() {
  const [pin, setPin] = useState(lastPin())
  const [camps, setCamps] = useState<Camp[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = async (p: string) => {
    if (!/^[1-9][0-9]{5}$/.test(p)) { setErr('Enter a 6-digit PIN code.'); return }
    try { localStorage.setItem(KEY, p) } catch { /* fine */ }
    setBusy(true); setErr('')
    try { setCamps(await findCamps(p)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="card flex flex-col gap-3">
        <p className="text-sm text-gray-500">Free health check-up camps and special prices from clinics, hospitals and labs near you.</p>
        <div className="flex gap-2 items-end flex-wrap">
          <label className="text-sm font-semibold text-gray-700 flex flex-col gap-1 flex-1">PIN code
            <input className="input-field" inputMode="numeric" maxLength={6} placeholder="110001" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && load(pin)} />
          </label>
          <button type="button" onClick={() => whereAmI().then(p => { if (p.pin) { setPin(p.pin); load(p.pin) } }).catch(e => setErr((e as Error).message))}
            className="text-sm font-bold text-teal-700 border border-teal-600 rounded-lg px-3 py-2.5">📍</button>
          <button onClick={() => load(pin)} disabled={busy} className="btn-teal disabled:opacity-50">{busy ? '…' : 'Show camps & offers'}</button>
        </div>
        <Err msg={err} />
      </div>
      {camps && !camps.length && <p className="text-gray-500">No camps or offers near {pin} right now. Clinics add new ones often — check again soon.</p>}
      {camps?.map(c => (
        <div key={c.id} className={`card p-4 border-2 ${c.kind === 'free_camp' ? 'border-emerald-200' : 'border-amber-200'}`}>
          <span className={`text-xs font-extrabold rounded-full px-2.5 py-1 ${c.kind === 'free_camp' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
            {c.kind === 'free_camp' ? '🏥 FREE CAMP · निःशुल्क कैंप' : '🎁 OFFER · ऑफर'}</span>
          <p className="font-bold text-gray-800 text-lg mt-2">{c.title}</p>
          <p className="font-semibold text-gray-700">📅 {day(c.date_from)}{c.date_to > c.date_from ? ` – ${day(c.date_to)}` : ''}{c.time_slot ? ` · ${c.time_slot}` : ''}</p>
          {c.description && <p className="text-gray-700 mt-1">{c.description}</p>}
          {c.services && <p className="text-sm text-gray-500">Includes: {c.services}</p>}
          {c.business_name && <p className="font-semibold text-gray-800 mt-2">{c.business_name}{!c.near && c.city ? ` · ${c.city}` : ''}</p>}
          {c.address && <p className="text-sm text-gray-500">📍 {c.address}</p>}
          {c.phone && <a href={`tel:${c.phone}`} className="inline-block text-teal-700 font-extrabold mt-2">📞 Call to ask or register — {c.phone}</a>}
        </div>
      ))}
    </>
  )
}

export function Camps() {
  return <MyShell title="Camps & offers" back="/" needsLogin={false}><CampsList /></MyShell>
}
