import { useState } from 'react'
import { Star, Gift, Users, TrendingUp, Copy, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { WA_NUMBER } from '../types'

interface PatientData {
  id: string
  name: string
  referral_code: string
  badge: string
  total_points: number
  history: { description: string; points: number; created_at: string }[]
}

const REWARDS = [
  { points: 500,  label: '₹50 Discount',        icon: '💰', desc: 'Next appointment par' },
  { points: 1000, label: 'Free Blood Test',       icon: '🔬', desc: 'Partner lab mein' },
  { points: 1500, label: '₹150 Medicine Discount',icon: '💊', desc: 'Partner pharmacy mein' },
  { points: 2000, label: 'Free Consultation',     icon: '🏥', desc: 'Basic doctor visit' },
]

export default function Points() {
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp' | 'dashboard'>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [patient, setPatient] = useState<PatientData | null>(null)
  const [copied, setCopied] = useState(false)

  const sendOTP = async () => {
    if (phone.length !== 10) { setError('Sahi 10 digit number daalen'); return }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithOtp({
      phone: `+91${phone}`,
      options: { channel: 'whatsapp' }
    })
    if (err) setError('OTP bhejne mein problem. Dobara try karein.')
    else setStep('otp')
    setLoading(false)
  }

  const verifyOTP = async () => {
    if (otp.length < 4) { setError('OTP daalen'); return }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.verifyOtp({
      phone: `+91${phone}`, token: otp, type: 'sms'
    })
    if (err) { setError('OTP sahi nahi. Dobara try karein.'); setLoading(false); return }
    // Load patient data
    const phoneHash = btoa(`+91${phone}`)
    const { data: profile } = await supabase
      .from('patient_profiles')
      .select('*')
      .eq('phone_hash', phoneHash)
      .single()
    if (profile) {
      const { data: pointsData } = await supabase
        .from('sehat_points')
        .select('*')
        .eq('patient_id', profile.id)
        .order('created_at', { ascending: false })
      const total = (pointsData || []).reduce((s: number, r: any) => s + r.points, 0)
      setPatient({
        id: profile.id,
        name: profile.name || 'Patient',
        referral_code: profile.referral_code || `SEHAT-${phone.slice(-4)}`,
        badge: profile.badge || 'Sehat Starter',
        total_points: total,
        history: pointsData || []
      })
      setStep('dashboard')
    } else {
      // New patient
      setPatient({
        id: '', name: 'Patient', referral_code: `SEHAT-${phone.slice(-4)}`,
        badge: 'Sehat Starter', total_points: 50,
        history: [{ description: 'Welcome bonus', points: 50, created_at: new Date().toISOString() }]
      })
      setStep('dashboard')
    }
    setLoading(false)
  }

  const copyCode = () => {
    navigator.clipboard.writeText(patient?.referral_code || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const nextReward = REWARDS.find(r => r.points > (patient?.total_points || 0))
  const progress = nextReward ? Math.min(100, ((patient?.total_points || 0) / nextReward.points) * 100) : 100

  return (
    <div className="min-h-screen bg-gray-50 pt-16">
      <div className="max-w-lg mx-auto px-4 py-8">

        {/* Header */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Sehatsandhi" className="h-12 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-700">🌟 Sehat Points</h1>
          <p className="text-gray-500 text-sm mt-1">Book karo, points kamao, rewards pao</p>
        </div>

        {/* STEP 1 — Phone */}
        {step === 'phone' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-bold text-navy-700 mb-1">Apne points dekhen</h2>
            <p className="text-gray-500 text-sm mb-5">Aapka WhatsApp number daalen — OTP aayega</p>
            <div className="flex gap-2 mb-4">
              <span className="border border-gray-300 rounded-lg px-3 py-2.5 text-gray-500 text-sm bg-gray-50">+91</span>
              <input className="input-field flex-1" type="tel" maxLength={10}
                placeholder="10 digit mobile number"
                value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} />
            </div>
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <button onClick={sendOTP} disabled={loading || phone.length !== 10}
              className="btn-teal w-full justify-center py-3 disabled:opacity-50">
              {loading ? 'Bhej rahe hain...' : '📱 WhatsApp par OTP bhejein'}
            </button>
            <p className="text-xs text-gray-400 text-center mt-3">
              OTP aapke WhatsApp par aayega
            </p>

            {/* How to earn */}
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Points kaise kamayein?</p>
              <div className="space-y-2">
                {[
                  ['📅', 'Appointment book karein', '+50'],
                  ['✅', 'Appointment attend karein', '+100'],
                  ['👥', 'Dost ko refer karein', '+200'],
                  ['👤', 'Profile complete karein', '+50'],
                ].map(([icon, label, pts]) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{icon} {label}</span>
                    <span className="text-teal-600 font-semibold">{pts} pts</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2 — OTP */}
        {step === 'otp' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-bold text-navy-700 mb-1">OTP daalen</h2>
            <p className="text-gray-500 text-sm mb-5">
              +91 {phone} par WhatsApp OTP bheja gaya
            </p>
            <input className="input-field text-center text-2xl tracking-widest mb-4"
              type="number" maxLength={6} placeholder="------"
              value={otp} onChange={e => setOtp(e.target.value)} />
            {error && <p className="text-red-500 text-sm mb-3 text-center">{error}</p>}
            <button onClick={verifyOTP} disabled={loading || otp.length < 4}
              className="btn-teal w-full justify-center py-3 disabled:opacity-50">
              {loading ? 'Verify ho raha hai...' : 'Verify karein →'}
            </button>
            <button onClick={() => { setStep('phone'); setOtp(''); setError('') }}
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600 mt-3">
              ← Wapas jayen
            </button>
          </div>
        )}

        {/* STEP 3 — Dashboard */}
        {step === 'dashboard' && patient && (
          <div className="space-y-4">

            {/* Points balance */}
            <div className="bg-gradient-to-br from-teal-600 to-navy-700 rounded-2xl p-6 text-white">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-white/70 text-sm">Namaste, {patient.name}!</p>
                  <p className="text-4xl font-bold mt-1">{patient.total_points}</p>
                  <p className="text-white/70 text-sm">Sehat Points</p>
                </div>
                <div className="text-right">
                  <span className="bg-white/20 text-white text-xs px-3 py-1.5 rounded-full">
                    {patient.badge}
                  </span>
                </div>
              </div>
              {nextReward && (
                <div>
                  <div className="flex justify-between text-xs text-white/70 mb-1">
                    <span>Next: {nextReward.label}</span>
                    <span>{patient.total_points}/{nextReward.points} pts</span>
                  </div>
                  <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full transition-all"
                      style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-white/60 text-xs mt-1">
                    {nextReward.points - patient.total_points} aur points chahiye
                  </p>
                </div>
              )}
            </div>

            {/* Rewards */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-bold text-navy-700 mb-4 flex items-center gap-2">
                <Gift className="w-4 h-4 text-amber-500" /> Available Rewards
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {REWARDS.map(r => (
                  <div key={r.points}
                    className={`border-2 rounded-xl p-3 text-center transition ${
                      patient.total_points >= r.points
                        ? 'border-teal-400 bg-teal-50 cursor-pointer hover:bg-teal-100'
                        : 'border-gray-100 bg-gray-50 opacity-60'
                    }`}>
                    <div className="text-2xl mb-1">{r.icon}</div>
                    <p className="font-semibold text-navy-700 text-xs">{r.label}</p>
                    <p className="text-gray-400 text-xs">{r.desc}</p>
                    <p className={`text-xs font-bold mt-1 ${
                      patient.total_points >= r.points ? 'text-teal-600' : 'text-gray-400'
                    }`}>
                      {patient.total_points >= r.points ? '✅ Redeem karein' : `${r.points} pts`}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 text-center mt-3">
                Redeem karne ke liye WhatsApp karein: "Points redeem"
              </p>
            </div>

            {/* Referral */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-bold text-navy-700 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-500" /> Refer & Earn
              </h3>
              <p className="text-gray-500 text-sm mb-4">
                Dost ko refer karein → unki pehli appointment par
                aapko <strong className="text-teal-600">200 points</strong> milenge!
              </p>
              <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-3">
                <p className="text-xs text-gray-500 mb-1">Aapka referral code</p>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-navy-700 text-lg tracking-wider">
                    {patient.referral_code}
                  </p>
                  <button onClick={copyCode}
                    className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
                    {copied ? <><CheckCircle2 className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy</>}
                  </button>
                </div>
              </div>
              <a href={`https://wa.me/?text=${encodeURIComponent(
                `Yamuna Nagar mein doctor dhundho Sehatsandhi par - free mein! Mera referral code use karo: ${patient.referral_code}\nwa.me/${WA_NUMBER}`
              )}`}
                target="_blank" rel="noreferrer"
                className="btn-teal w-full justify-center py-3 text-sm">
                📤 WhatsApp par Share Karein
              </a>
            </div>

            {/* Points history */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-bold text-navy-700 mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-teal-500" /> Points History
              </h3>
              {patient.history.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">
                  Abhi koi activity nahi. Doctor book karein aur points kamayein!
                </p>
              ) : (
                <div className="space-y-2">
                  {patient.history.map((h, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-sm text-gray-700">{h.description}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(h.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <span className={`font-bold text-sm ${h.points > 0 ? 'text-teal-600' : 'text-red-500'}`}>
                        {h.points > 0 ? '+' : ''}{h.points}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Book appointment CTA */}
            <a href={`https://wa.me/${WA_NUMBER}?text=Doctor book karna hai`}
               target="_blank" rel="noreferrer"
               className="btn-teal w-full justify-center py-4 text-base shadow-lg shadow-teal-100">
              📱 Appointment Book Karein — Points Kamayein
            </a>

          </div>
        )}

      </div>
    </div>
  )
}
