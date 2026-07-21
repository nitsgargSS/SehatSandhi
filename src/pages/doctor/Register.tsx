import { useState } from 'react'
import { CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react'
import { SPECIALITIES, PIN_CODES } from '../../types'
import { supabase } from '../../lib/supabase'
import CustomAreaSearch, { CustomArea } from '../../components/CustomAreaSearch'

type FormData = {
  name: string; qualification: string; speciality: string; reg_number: string
  clinic_name: string; address: string; consultation_fee: string
  working_days: string[]; from_time: string; to_time: string
  phone: string; email: string
}

const QUALIFICATIONS = ['MBBS', 'MD', 'MS', 'BDS', 'BHMS', 'BAMS', 'DNB', 'DM', 'MCh', 'Other']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Register() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>({
    name: '', qualification: 'MBBS', speciality: '', reg_number: '',
    clinic_name: '', address: '', consultation_fee: '',
    working_days: ['Mon','Tue','Wed','Thu','Fri','Sat'],
    from_time: '10:00', to_time: '18:00', phone: '', email: ''
  })
  const [selectedPins, setSelectedPins] = useState<string[]>([])
  const [customAreas, setCustomAreas] = useState<CustomArea[]>([])
  const [wantsPremium, setWantsPremium] = useState(false)
  const [premPos, setPremPos] = useState<1 | 2 | 3 | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const togglePin = (code: string) =>
    setSelectedPins(p => p.includes(code) ? p.filter(c => c !== code) : [...p, code])

  const upd = (k: keyof FormData, v: string) => setForm(f => ({ ...f, [k]: v }))

  const allSelectedAreaNames = [
    ...selectedPins.map(c => PIN_CODES.find(p => p.code === c)?.area).filter(Boolean),
    ...customAreas.map(a => a.area_name),
  ]

  const handleSubmit = async () => {
    if (!selectedPins.length && !customAreas.length) {
      setError('Please select at least one area'); return
    }
    setLoading(true); setError('')
    try {
      const { error: err } = await supabase.from('doctors').insert({
        name: form.name, qualification: form.qualification,
        reg_number: form.reg_number, speciality: form.speciality,
        clinic_name: form.clinic_name, address: form.address,
        pin_codes: [...selectedPins, ...customAreas.map(a => a.pin_code)],
        phone: form.phone, email: form.email,
        consultation_fee: parseInt(form.consultation_fee) || 0,
        working_hours: `${DAYS.filter(d => form.working_days.includes(d)).join(',')} ${form.from_time}-${form.to_time}`,
        status: 'pending'
      })
      if (err) throw err
      setDone(true)
    } catch (e: any) {
      setError(e.message || 'Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 pt-16">
      <div className="card max-w-md w-full text-center shadow-xl">
        <CheckCircle2 className="w-16 h-16 text-teal-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-navy-700 mb-3">Registration Submitted!</h2>
        <p className="text-gray-500 mb-2">Shukriya, Dr. {form.name.split(' ').pop()}! 🎉</p>
        <p className="text-gray-500 text-sm mb-6">
          Hamare team 24-48 ghante mein aapka MCI number verify karegi, aur
          aapke selected areas ke hisaab se <strong>pricing WhatsApp par</strong> bhejegi.
          Confirm karne ke baad listing turant activate ho jayegi.
        </p>
        <div className="bg-teal-50 rounded-xl p-4 text-sm text-teal-700">
          <p className="font-medium mb-1">Selected areas: {allSelectedAreaNames.length}</p>
          <p>{allSelectedAreaNames.join(', ')}</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pt-20 pb-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {['Details', 'Areas', 'Premium', 'Review'].map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step > i + 1 ? 'bg-teal-500 text-white' : step === i + 1 ? 'bg-navy-700 text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {step > i + 1 ? '✓' : i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${step === i + 1 ? 'text-navy-700 font-medium' : 'text-gray-400'}`}>{s}</span>
                {i < 3 && <div className={`flex-1 h-0.5 mx-2 ${step > i + 1 ? 'bg-teal-400' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>
        </div>

        <div className="card shadow-md">

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-navy-700">Apni Details Bharein</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Full Name *</label>
                  <input className="input-field" placeholder="Dr. Priya Sharma" value={form.name} onChange={e => upd('name', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Qualification *</label>
                  <select className="input-field" value={form.qualification} onChange={e => upd('qualification', e.target.value)}>
                    {QUALIFICATIONS.map(q => <option key={q}>{q}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Speciality *</label>
                  <select className="input-field" value={form.speciality} onChange={e => upd('speciality', e.target.value)}>
                    <option value="">Select speciality...</option>
                    {SPECIALITIES.map(s => <option key={s.id} value={s.id}>{s.en} — {s.hi}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">MCI/NMC Reg. Number *</label>
                  <input className="input-field" placeholder="e.g. DMC/R/2018/45231" value={form.reg_number} onChange={e => upd('reg_number', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Clinic Name *</label>
                  <input className="input-field" placeholder="ABC Clinic" value={form.clinic_name} onChange={e => upd('clinic_name', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Consultation Fee (₹)</label>
                  <input className="input-field" type="number" placeholder="400" value={form.consultation_fee} onChange={e => upd('consultation_fee', e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Clinic Address *</label>
                  <textarea className="input-field" rows={2} placeholder="Full address with landmark" value={form.address} onChange={e => upd('address', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Phone (+91) *</label>
                  <input className="input-field" type="tel" placeholder="9876543210" maxLength={10} value={form.phone} onChange={e => upd('phone', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
                  <input className="input-field" type="email" placeholder="doctor@clinic.com" value={form.email} onChange={e => upd('email', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-2 block">Working Days</label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map(d => (
                      <button key={d} type="button"
                        onClick={() => setForm(f => ({ ...f, working_days: f.working_days.includes(d) ? f.working_days.filter(x => x !== d) : [...f.working_days, d] }))}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition ${form.working_days.includes(d) ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-300 text-gray-500 hover:border-teal-400'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-2 block">Working Hours</label>
                  <div className="flex items-center gap-2">
                    <input type="time" className="input-field" value={form.from_time} onChange={e => upd('from_time', e.target.value)} />
                    <span className="text-gray-400 text-sm">to</span>
                    <input type="time" className="input-field" value={form.to_time} onChange={e => upd('to_time', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: AREA SELECTION (no pricing shown) ── */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-navy-700 mb-1">Apne Areas Chunein</h2>
              <p className="text-gray-500 text-sm mb-4">
                Un areas ko select karein jahan aap patients tak pahunchna chahte hain.
                Pricing aapke selected areas ke hisaab se hamari team confirm karegi.
              </p>
              <div className="flex gap-2 mb-4">
                <button onClick={() => setSelectedPins(PIN_CODES.map(p => p.code))} className="btn-outline text-xs py-1.5 px-4">Select All 20</button>
                <button onClick={() => setSelectedPins([])} className="btn-outline text-xs py-1.5 px-4">Clear</button>
                <button onClick={() => setSelectedPins(['135001', '135003'])} className="btn-outline text-xs py-1.5 px-4">Core 2 Areas</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-6">
                {PIN_CODES.map(p => (
                  <button key={p.code} onClick={() => togglePin(p.code)}
                    className={`flex flex-col items-start p-3 rounded-xl border-2 transition-all text-left ${selectedPins.includes(p.code) ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-teal-300'}`}>
                    <span className="font-bold text-sm text-navy-700">{p.code}</span>
                    <span className="text-xs text-gray-500">{p.area}</span>
                    {selectedPins.includes(p.code) && <span className="text-xs text-teal-600 font-medium mt-1">✓ Selected</span>}
                  </button>
                ))}
              </div>

              {/* Selection count — no rupee amount */}
              <div className={`rounded-2xl p-5 mb-6 ${selectedPins.length ? 'bg-teal-50 border border-teal-200' : 'bg-gray-50 border border-gray-200'}`}>
                {selectedPins.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center">Select at least one area to continue</p>
                ) : (
                  <p className="text-sm text-gray-600 text-center">
                    <span className="font-bold text-navy-700 text-lg">{selectedPins.length}</span> area{selectedPins.length > 1 ? 's' : ''} selected —
                    pricing team se WhatsApp par milegi
                  </p>
                )}
              </div>

              {/* Custom area search — city/district/PIN not in the preset list */}
              <CustomAreaSearch
                existingPins={PIN_CODES.map(p => p.code)}
                onAreasChange={setCustomAreas}
              />
            </div>
          )}

          {/* ── STEP 3: PREMIUM (interest only, no pricing) ── */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-navy-700 mb-1">Premium Positioning <span className="text-gray-400 font-normal text-base">(Optional)</span></h2>
              <p className="text-gray-500 text-sm mb-6">
                Apni speciality mein sabse upar dikhna chahte hain? Interest batayein —
                pricing team confirm karegi.
              </p>
              <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-gray-100 hover:border-teal-200 cursor-pointer mb-4">
                <input type="checkbox" checked={wantsPremium}
                  onChange={e => { setWantsPremium(e.target.checked); if (!e.target.checked) setPremPos(null) }}
                  className="w-5 h-5 accent-teal-600" />
                <span className="text-sm text-gray-700">Haan, mujhe premium position mein interest hai</span>
              </label>

              {wantsPremium && (
                <div className="space-y-3">
                  {([
                    { pos: 1 as const, label: 'Position 1 — Top of List', badge: '🥇 Gold' },
                    { pos: 2 as const, label: 'Position 2 — Second Spot', badge: '🥈 Silver' },
                    { pos: 3 as const, label: 'Position 3 — Third Spot', badge: '🥉 Bronze' },
                  ]).map(opt => (
                    <label key={opt.pos} className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${premPos === opt.pos ? 'border-teal-400 bg-teal-50' : 'border-gray-100 hover:border-gray-200'}`}>
                      <input type="radio" name="pos" value={opt.pos} checked={premPos === opt.pos} onChange={() => setPremPos(opt.pos)} className="accent-teal-600 w-5 h-5" />
                      <p className="font-semibold text-gray-800 text-sm">{opt.badge} — {opt.label}</p>
                    </label>
                  ))}
                  <p className="text-xs text-gray-400 mt-2">
                    Pricing aapke selected areas ke hisaab se WhatsApp par confirm ki jayegi.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: REVIEW & SUBMIT (no payment) ── */}
          {step === 4 && (
            <div>
              <h2 className="text-xl font-bold text-navy-700 mb-6">Review & Submit</h2>
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <p><span className="text-gray-500 w-40 inline-block">Name</span> <strong>{form.name}</strong></p>
                  <p><span className="text-gray-500 w-40 inline-block">Qualification</span> <strong>{form.qualification}</strong></p>
                  <p><span className="text-gray-500 w-40 inline-block">Speciality</span> <strong>{SPECIALITIES.find(s => s.id === form.speciality)?.en || form.speciality}</strong></p>
                  <p><span className="text-gray-500 w-40 inline-block">Reg. Number</span> <strong>{form.reg_number}</strong></p>
                  <p><span className="text-gray-500 w-40 inline-block">Clinic</span> <strong>{form.clinic_name}</strong></p>
                  <p><span className="text-gray-500 w-40 inline-block">Phone</span> <strong>+91 {form.phone}</strong></p>
                  <p><span className="text-gray-500 w-40 inline-block">Areas</span> <strong>{allSelectedAreaNames.join(', ') || 'None selected'}</strong></p>
                  {wantsPremium && <p><span className="text-gray-500 w-40 inline-block">Premium interest</span> <strong>Position {premPos || '—'}</strong></p>}
                </div>

                <div className="bg-navy-700 rounded-xl p-5 text-white">
                  <h3 className="font-bold mb-2">Aage Kya Hoga?</h3>
                  <ol className="text-sm text-white/80 space-y-1 list-decimal list-inside">
                    <li>Hamari team aapka MCI/NMC number verify karegi (24-48 ghante)</li>
                    <li>Aapke selected areas ke hisaab se pricing WhatsApp par bhejenge</li>
                    <li>Confirm karne par listing turant activate ho jayegi</li>
                  </ol>
                </div>

                {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-lg">{error}</p>}
              </div>
            </div>
          )}

          {/* ── NAVIGATION ── */}
          <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-100">
            {step > 1 ? (
              <button onClick={() => setStep(s => s - 1)} className="btn-outline flex items-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            ) : <div />}
            {step < 4 ? (
              <button onClick={() => setStep(s => s + 1)}
                disabled={
                  (step === 1 && (!form.name || !form.speciality || !form.reg_number || !form.clinic_name || !form.phone)) ||
                  (step === 2 && selectedPins.length === 0 && customAreas.length === 0)
                }
                className="btn-teal disabled:opacity-50 disabled:cursor-not-allowed">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={loading} className="btn-teal px-10 disabled:opacity-60">
                {loading ? 'Submitting...' : '✓ Submit Registration'}
              </button>
            )}
          </div>

        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          Already registered? <a href="/doctor/login" className="text-teal-600 hover:underline font-medium">Login here →</a>
        </p>
      </div>
    </div>
  )
}
