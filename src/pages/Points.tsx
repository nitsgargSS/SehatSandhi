import { useState } from 'react'
import { Gift, Users, TrendingUp, Copy, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'

interface PatientData {
  id: string
  name: string
  referral_code: string
  badge: string
  total_points: number
  history: { description: string; points: number; created_at: string }[]
}

export default function Points() {
  const { t } = useLanguage()
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp' | 'dashboard'>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [patient, setPatient] = useState<PatientData | null>(null)
  const [copied, setCopied] = useState(false)

  const REWARDS = [
    { points: 500,  label: t('pointsPage.rewardDiscount'),      icon: '💰', desc: t('pointsPage.rewardDiscountDesc') },
    { points: 1000, label: t('pointsPage.rewardFreeTest'),      icon: '🔬', desc: t('pointsPage.rewardFreeTestDesc') },
    { points: 1500, label: t('pointsPage.rewardMedDiscount'),   icon: '💊', desc: t('pointsPage.rewardMedDiscountDesc') },
    { points: 2000, label: t('pointsPage.rewardFreeConsult'),   icon: '🏥', desc: t('pointsPage.rewardFreeConsultDesc') },
  ]

  const sendOTP = async () => {
    if (phone.length !== 10) { setError(t('pointsPage.errorPhone')); return }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithOtp({
      phone: `+91${phone}`,
      options: { channel: 'whatsapp' }
    })
    if (err) setError(t('pointsPage.errorOtpSend'))
    else setStep('otp')
    setLoading(false)
  }

  const verifyOTP = async () => {
    if (otp.length < 4) { setError(t('pointsPage.errorOtp')); return }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.verifyOtp({
      phone: `+91${phone}`, token: otp, type: 'sms'
    })
    if (err) { setError(t('pointsPage.errorOtpWrong')); setLoading(false); return }
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
        name: profile.name || t('pointsPage.patientDefaultName'),
        referral_code: profile.referral_code || `SEHAT-${phone.slice(-4)}`,
        badge: profile.badge || t('pointsPage.badgeStarter'),
        total_points: total,
        history: pointsData || []
      })
      setStep('dashboard')
    } else {
      // New patient
      setPatient({
        id: '', name: t('pointsPage.patientDefaultName'), referral_code: `SEHAT-${phone.slice(-4)}`,
        badge: t('pointsPage.badgeStarter'), total_points: 50,
        history: [{ description: t('pointsPage.welcomeBonus'), points: 50, created_at: new Date().toISOString() }]
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
          <h1 className="text-2xl font-bold text-navy-700">{t('pointsPage.headerTitle')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('pointsPage.headerSubtitle')}</p>
        </div>

        {/* STEP 1 — Phone */}
        {step === 'phone' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-bold text-navy-700 mb-1">{t('pointsPage.step1Title')}</h2>
            <p className="text-gray-500 text-sm mb-5">{t('pointsPage.step1Desc')}</p>
            <div className="flex gap-2 mb-4">
              <span className="border border-gray-300 rounded-lg px-3 py-2.5 text-gray-500 text-sm bg-gray-50">+91</span>
              <input className="input-field flex-1" type="tel" maxLength={10}
                placeholder={t('pointsPage.phonePlaceholder')}
                value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} />
            </div>
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <button onClick={sendOTP} disabled={loading || phone.length !== 10}
              className="btn-teal w-full justify-center py-3 disabled:opacity-50">
              {loading ? t('pointsPage.btnSending') : t('pointsPage.btnSendOtp')}
            </button>
            <p className="text-xs text-gray-400 text-center mt-3">{t('pointsPage.otpHelpText')}</p>

            {/* How to earn */}
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">{t('pointsPage.howToEarnTitle')}</p>
              <div className="space-y-2">
                {[
                  ['📅', t('pointsPage.earn1'), '+50'],
                  ['✅', t('pointsPage.earn2'), '+100'],
                  ['👥', t('pointsPage.earn3'), '+200'],
                  ['👤', t('pointsPage.earn4'), '+50'],
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
            <h2 className="font-bold text-navy-700 mb-1">{t('pointsPage.step2Title')}</h2>
            <p className="text-gray-500 text-sm mb-5">
              +91 {phone} {t('pointsPage.step2DescPrefix')}
            </p>
            <input className="input-field text-center text-2xl tracking-widest mb-4"
              type="number" maxLength={6} placeholder="------"
              value={otp} onChange={e => setOtp(e.target.value)} />
            {error && <p className="text-red-500 text-sm mb-3 text-center">{error}</p>}
            <button onClick={verifyOTP} disabled={loading || otp.length < 4}
              className="btn-teal w-full justify-center py-3 disabled:opacity-50">
              {loading ? t('pointsPage.btnVerifying') : t('pointsPage.btnVerify')}
            </button>
            <button onClick={() => { setStep('phone'); setOtp(''); setError('') }}
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600 mt-3">
              {t('pointsPage.btnBack')}
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
                  <p className="text-white/70 text-sm">{t('pointsPage.greeting')} {patient.name}!</p>
                  <p className="text-4xl font-bold mt-1">{patient.total_points}</p>
                  <p className="text-white/70 text-sm">{t('pointsPage.pointsLabel')}</p>
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
                    <span>{t('pointsPage.nextRewardPrefix')} {nextReward.label}</span>
                    <span>{patient.total_points}/{nextReward.points} pts</span>
                  </div>
                  <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full transition-all"
                      style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-white/60 text-xs mt-1">
                    {nextReward.points - patient.total_points} {t('pointsPage.pointsMoreNeeded')}
                  </p>
                </div>
              )}
            </div>

            {/* Rewards */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-bold text-navy-700 mb-4 flex items-center gap-2">
                <Gift className="w-4 h-4 text-amber-500" /> {t('pointsPage.rewardsTitle')}
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
                      {patient.total_points >= r.points ? `✅ ${t('pointsPage.redeemHint')}` : `${r.points} pts`}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 text-center mt-3">{t('pointsPage.redeemInstructions')}</p>
            </div>

            {/* Referral */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-bold text-navy-700 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-500" /> {t('pointsPage.referTitle')}
              </h3>
              <p className="text-gray-500 text-sm mb-4">
                {t('pointsPage.referDescPrefix')} <strong className="text-teal-600">200 {t('pointsPage.referDescSuffix')}</strong>
              </p>
              <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-3">
                <p className="text-xs text-gray-500 mb-1">{t('pointsPage.referCodeLabel')}</p>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-navy-700 text-lg tracking-wider">
                    {patient.referral_code}
                  </p>
                  <button onClick={copyCode}
                    className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
                    {copied ? <><CheckCircle2 className="w-4 h-4" /> {t('pointsPage.copied')}</> : <><Copy className="w-4 h-4" /> {t('pointsPage.copy')}</>}
                  </button>
                </div>
              </div>
              <a href={`https://wa.me/?text=${encodeURIComponent(
                `Yamuna Nagar mein doctor dhundho Sehatsandhi par - free mein! Mera referral code use karo: ${patient.referral_code}\nwa.me/${WA_NUMBER}`
              )}`}
                target="_blank" rel="noreferrer"
                className="btn-teal w-full justify-center py-3 text-sm">
                {t('pointsPage.shareButton')}
              </a>
            </div>

            {/* Points history */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-bold text-navy-700 mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-teal-500" /> {t('pointsPage.historyTitle')}
              </h3>
              {patient.history.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">{t('pointsPage.historyEmpty')}</p>
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
              {t('pointsPage.bookCta')}
            </a>

          </div>
        )}

      </div>
    </div>
  )
}
