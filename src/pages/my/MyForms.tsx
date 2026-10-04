import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { askAmbulance, askInsurance, orderMedicines, rate, uploadPhoto, whereAmI, type Place, type RateKind, type Reply } from '../../lib/patientApi'
import { Err, MyShell, useMe } from './MyShell'

// Medicines, ambulance and insurance requests, and ratings — the app's forms on
// the website, through the same functions (0196) on the signed-in number.
const Field = ({ label, children }: { label: string; children: React.ReactNode }) =>
  <label className="text-sm font-semibold text-gray-700 flex flex-col gap-1">{label}{children}</label>
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) =>
  <button type="button" onClick={onClick} className={`text-sm font-bold rounded-full px-3 py-1.5 border ${on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-teal-700 border-teal-600'}`}>{children}</button>
const Done = ({ r, link }: { r: Reply; link?: string }) => (
  <div className="card">
    <p className="whitespace-pre-wrap text-gray-800">{(r.text ?? '').replace(/https:\/\/\S+/g, '').trim()}</p>
    {link && <Link to={link} className="btn-teal mt-4">Open my request</Link>}
    <Link to="/my" className="block text-sm text-teal-700 font-semibold mt-3">Back to My Sehatsandhi</Link>
  </div>
)
const pinOk = (p: string) => /^[1-9][0-9]{5}$/.test(p)

function Order() {
  const { who } = useMe()
  const [name, setName] = useState(who.name ?? '')
  const [pin, setPin] = useState(who.pin_code ?? '')
  const [address, setAddress] = useState('')
  const [meds, setMeds] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Reply | null>(null)
  const locate = () => whereAmI().then(p => { if (p.pin) setPin(p.pin); if (p.area && !address) setAddress(p.area) }).catch(e => setErr((e as Error).message))
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { const rx = photo ? await uploadPhoto(photo) : ''; setDone(await orderMedicines(pin, name, address, meds, rx)) }
    catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
  }
  if (done) return <Done r={done} link={done.token ? `/o/${done.token}` : undefined} />
  return (
    <form onSubmit={send} className="flex flex-col gap-4">
      <div className="card flex flex-col gap-3">
        <Field label="Name"><input className="input-field" value={name} onChange={e => setName(e.target.value)} /></Field>
        <div className="flex gap-2 items-end">
          <Field label="PIN code"><input className="input-field" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
          <button type="button" onClick={locate} className="text-sm font-bold text-teal-700 border border-teal-600 rounded-lg px-3 py-2.5 whitespace-nowrap">📍 Use my location</button>
        </div>
        <Field label="Full delivery address"><textarea className="input-field" rows={2} placeholder="House no., street, landmark" value={address} onChange={e => setAddress(e.target.value)} /></Field>
      </div>
      <div className="card flex flex-col gap-3">
        <Field label="Prescription photo (optional)">
          <input type="file" accept="image/*" capture="environment" className="text-sm" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
        </Field>
        {photo && <img src={URL.createObjectURL(photo)} alt="Prescription" className="rounded-lg max-h-56 w-fit" />}
        <Field label="Medicine names and how many"><textarea className="input-field" rows={3} placeholder="e.g. Paracetamol 650 – 10 tablets" value={meds} onChange={e => setMeds(e.target.value)} /></Field>
      </div>
      <p className="text-sm text-gray-500">A pharmacy near you sends the total, with any delivery fee. Nothing is delivered until you approve it. You pay the pharmacy when the medicines arrive.</p>
      <Err msg={err} />
      <button className="btn-teal justify-center disabled:opacity-50" disabled={busy || !name.trim() || !pinOk(pin) || !address.trim() || (!meds.trim() && !photo)}>{busy ? 'Sending…' : 'Send order'}</button>
    </form>
  )
}
export function MyOrder() { return <MyShell title="Order medicines"><Order /></MyShell> }

function Ambulance() {
  const { who } = useMe()
  const [name, setName] = useState(who.name ?? '')
  const [kind, setKind] = useState<'emergency' | 'scheduled'>('emergency')
  const [place, setPlace] = useState<Place | null>(null)
  const [pin, setPin] = useState(who.pin_code ?? '')
  const [address, setAddress] = useState('')
  const [need, setNeed] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Reply | null>(null)
  const locate = () => whereAmI().then(p => { setPlace(p); if (p.pin) setPin(p.pin); if (p.area) setAddress(a => a || p.area!) }).catch(e => setErr((e as Error).message))
  useEffect(() => { locate() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { setDone(await askAmbulance(pin, name, kind, address, need, place?.lat ?? null, place?.lng ?? null)) }
    catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-4">
      <a href="tel:108" className="block text-center font-extrabold text-white bg-red-600 rounded-2xl py-4 text-lg">📞 Call 108 now — free, 24×7</a>
      <p className="text-sm text-gray-500">In an emergency call 108 first. You can also alert private ambulances near you — the first to accept calls you.</p>
      {done ? <Done r={done} link={done.token ? `/a/${done.token}` : undefined} /> : (
        <form onSubmit={send} className="flex flex-col gap-4">
          <div className="card flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Chip on={kind === 'emergency'} onClick={() => setKind('emergency')}>🚨 Emergency now</Chip>
              <Chip on={kind === 'scheduled'} onClick={() => setKind('scheduled')}>📅 Booking (transfer / discharge)</Chip>
            </div>
            <p className="text-sm text-gray-500">{place ? `📍 Your location will be sent to the ambulance${place.area ? ` (near ${place.area})` : ''}.` : <button type="button" onClick={locate} className="text-teal-700 font-semibold">📍 Share my location with the ambulance</button>}</p>
            <Field label="Pickup address or landmark"><textarea className="input-field" rows={2} value={address} onChange={e => setAddress(e.target.value)} /></Field>
            <Field label="PIN code"><input className="input-field" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="What happened / what is needed"><input className="input-field" value={need} onChange={e => setNeed(e.target.value)} placeholder={kind === 'emergency' ? 'e.g. accident, chest pain, needs oxygen' : 'date and time, from where to where'} /></Field>
            <Field label="Patient's name"><input className="input-field" value={name} onChange={e => setName(e.target.value)} /></Field>
          </div>
          <Err msg={err} />
          <button className="btn-teal justify-center disabled:opacity-50" disabled={busy || !pinOk(pin)}>{busy ? 'Sending…' : 'Alert ambulances near me'}</button>
        </form>
      )}
    </div>
  )
}
export function MyAmbulance() { return <MyShell title="Ambulance"><Ambulance /></MyShell> }

const COVERS = ['Family floater', 'Just me', 'Parents / senior citizen', 'Top-up of existing policy']
const TIMES = ['Morning', 'Afternoon', 'After 6 pm']
function Insurance() {
  const { who } = useMe()
  const [name, setName] = useState(who.name ?? '')
  const [pin, setPin] = useState(who.pin_code ?? '')
  const [cover, setCover] = useState('')
  const [members, setMembers] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Reply | null>(null)
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { setDone(await askInsurance(pin, name, cover, members, time)) } catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
  }
  if (done) return <Done r={done} link={done.token ? `/i/${done.token}` : undefined} />
  return (
    <form onSubmit={send} className="flex flex-col gap-4">
      <div className="card flex flex-col gap-3">
        <p className="text-sm font-semibold text-gray-700">What cover?</p>
        <div className="flex flex-wrap gap-2">{COVERS.map(c => <Chip key={c} on={cover === c} onClick={() => setCover(c)}>{c}</Chip>)}</div>
        <Field label="Who should be covered, with ages"><input className="input-field" placeholder="e.g. me 34, wife 31, 2 kids" value={members} onChange={e => setMembers(e.target.value)} /></Field>
        <p className="text-sm font-semibold text-gray-700">When should the advisor call?</p>
        <div className="flex flex-wrap gap-2">{TIMES.map(c => <Chip key={c} on={time === c} onClick={() => setTime(c)}>{c}</Chip>)}</div>
        <Field label="Your name"><input className="input-field" value={name} onChange={e => setName(e.target.value)} /></Field>
        <div className="flex gap-2 items-end">
          <Field label="PIN code"><input className="input-field" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
          <button type="button" onClick={() => whereAmI().then(p => p.pin && setPin(p.pin)).catch(e => setErr((e as Error).message))} className="text-sm font-bold text-teal-700 border border-teal-600 rounded-lg px-3 py-2.5 whitespace-nowrap">📍 Use my location</button>
        </div>
      </div>
      <p className="text-sm text-gray-500">Only the licensed advisor who takes your request gets your number, and you can see their IRDAI licence. Sehatsandhi takes nothing from any policy.</p>
      <Err msg={err} />
      <button className="btn-teal justify-center disabled:opacity-50" disabled={busy || !pinOk(pin) || !cover}>{busy ? 'Sending…' : 'Ask an advisor to call me'}</button>
    </form>
  )
}
export function MyInsurance() { return <MyShell title="Health insurance"><Insurance /></MyShell> }

function Rate() {
  const [q] = useSearchParams()
  const kind = q.get('kind') as RateKind, id = q.get('id') ?? '', title = q.get('title') ?? ''
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')
  const [paid, setPaid] = useState('')
  const [bought, setBought] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { await rate(kind, id, stars, review, paid === '' ? null : Number(paid), bought); setDone(true) }
    catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
  }
  if (done) return (
    <div className="card"><p className="text-lg font-bold text-navy-700">धन्यवाद! / Thank you!</p><p className="text-sm text-gray-500">Your rating helps other families choose.</p>
      <Link to="/my" className="btn-teal mt-4">Back to My Sehatsandhi</Link></div>
  )
  return (
    <form onSubmit={send} className="card flex flex-col gap-3">
      <p className="text-lg font-bold text-navy-700">{title || 'कैसा रहा? / How was it?'}</p>
      <div className="flex gap-1" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map(n => (
          <button type="button" key={n} onClick={() => setStars(n)} aria-label={`${n} stars`} aria-checked={stars === n} role="radio"
            className={`text-4xl leading-none ${n <= stars ? 'text-amber-400' : 'text-gray-300'}`}>★</button>
        ))}
      </div>
      {(kind === 'order' || kind === 'trip') && <Field label="How much did you pay? (₹)"><input className="input-field" inputMode="decimal" value={paid} onChange={e => setPaid(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
      {kind === 'insurance' && (
        <div className="flex items-center gap-2 flex-wrap"><span className="text-sm text-gray-700">Did you buy a policy?</span>
          <Chip on={bought === true} onClick={() => setBought(true)}>Yes</Chip><Chip on={bought === false} onClick={() => setBought(false)}>No</Chip></div>
      )}
      <Field label="Anything to add? (optional)"><textarea className="input-field" rows={3} value={review} onChange={e => setReview(e.target.value)} /></Field>
      <Err msg={err} />
      <button className="btn-teal justify-center disabled:opacity-50" disabled={busy || stars === 0 || !id}>{busy ? 'Sending…' : 'Send rating'}</button>
    </form>
  )
}
export function MyRate() { return <MyShell title="Rate"><Rate /></MyShell> }
