import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { myActivity, type Activity } from '../../lib/patientApi'
import { Err, MyShell, useMe } from './MyShell'
import { RateList, RequestList, requests, toRate } from './lists'

// sehatsandhi.com/my — the patient's home on the website, the same as My
// Sehatsandhi in the app: six doors, then the latest three ratings and requests.
const TILES = [
  { to: '/my/book', icon: '🩺', hi: 'अपॉइंटमेंट', en: 'Book an appointment', ring: 'border-emerald-200' },
  { to: '/my/order', icon: '💊', hi: 'दवाई घर पर', en: 'Medicines', ring: 'border-pink-200' },
  { to: '/my/ambulance', icon: '🚑', hi: 'एम्बुलेंस', en: 'Ambulance', ring: 'border-red-200' },
  { to: '/my/insurance', icon: '🛡️', hi: 'बीमा', en: 'Insurance', ring: 'border-sky-200' },
  { to: '/camps', icon: '🎁', hi: 'कैंप और ऑफर', en: 'Camps & offers', ring: 'border-amber-200' },
  { to: '/my/records', icon: '📋', hi: 'रिकॉर्ड और मैसेज', en: 'Records & messages', ring: 'border-violet-200' },
]

function Home() {
  const { who } = useMe()
  const [act, setAct] = useState<Activity | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { myActivity().then(setAct).catch(e => setErr((e as Error).message)) }, [])
  useEffect(() => { load() }, [load])
  return (
    <>
      <div>
        <p className="text-xl font-bold text-gray-800">नमस्ते{who.name ? `, ${who.name.split(' ')[0]}` : ''} 🙏</p>
        <p className="text-sm text-gray-500">+{who.phone}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {TILES.map(t => (
          <Link key={t.to} to={t.to} className={`bg-white border-2 ${t.ring} rounded-2xl py-4 px-2 text-center hover:shadow-md transition-shadow`}>
            <div className="text-3xl" aria-hidden>{t.icon}</div>
            <div className="font-bold text-gray-800 text-sm mt-1 leading-tight">{t.hi}<br />{t.en}</div>
          </Link>
        ))}
      </div>
      <Err msg={err} />
      <RateList items={toRate(act)} limit={3} />
      <RequestList items={requests(act)} limit={3} onChanged={load} />
    </>
  )
}

export default function MyHome() {
  return <MyShell title="My Sehatsandhi" back={null}><Home /></MyShell>
}

function All() {
  const [act, setAct] = useState<Activity | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { myActivity().then(setAct).catch(e => setErr((e as Error).message)) }, [])
  useEffect(() => { load() }, [load])
  return <><Err msg={err} /><RateList items={toRate(act)} /><RequestList items={requests(act)} onChanged={load} /></>
}

export function MyRequests() {
  return <MyShell title="My requests"><All /></MyShell>
}
