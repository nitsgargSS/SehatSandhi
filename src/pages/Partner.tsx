import { useState } from 'react'
import { CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'

type PartnerType = 'pharmacy' | 'lab' | 'insurance' | null

const PARTNER_PRICING = {
  pharmacy: { basic: 2000, full: 3500, commission: '8%' },
  lab:      { basic: 1500, full: 3000, commission: '12%' },
  insurance:{ basic: 2000, full: 4000, commission: '₹200/lead' },
}

export default function PartnerRegister() {
  const [type, setType] = useState<PartnerType>(null)
  const [step, setStep] = useState(1)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const upd = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    setLoading(true)
    await supabase.from('doctors').insert({
      name: form.business_name || form.agent_name,
      speciality: type?.toUpperCase(),
      clinic_name: form.business_name || form.agent_name,
      address: form.address,
      pin_codes: [form.pin_code],
      phone: form.phone,
      email: form.email,
      qualification: type === 'insurance' ? 'IRDA Licensed' : type === 'lab' ? 'Diagnostic Lab' : 'Pharmacy',
      status: 'pending',
      consultation_fee: 0,
    })
    setDone(true)
    setLoading(false)
  }

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 pt-16">
      <div className="card max-w-md w-full text-center shadow-xl">
        <CheckCircle2 className="w-16 h-16 text-teal-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-navy-700 mb-3">Registration Done! 🎉</h2>
        <p className="text-gray-500 mb-6">
          Shukriya! Hamare team 24-48 ghante mein aapki details verify karengi
          aur WhatsApp par confirm karenge.
        </p>
        <div className="bg-teal-50 rounded-xl p-4 text-sm text-teal-700">
          <p className="font-medium">Aage kya hoga:</p>
          <p className="mt-1">✅ Team call karegi verification ke liye</p>
          <p>✅ Agreement share kiya jayega</p>
          <p>✅ Payment link bheja jayega</p>
          <p>✅ Listing activate ho jayegi</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pt-20 pb-12">
      <div className="max-w-2xl mx-auto px-4">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-navy-700">Sehatsandhi Partner Banein</h1>
          <p className="text-gray-500 mt-2">Yamuna Nagar ke hazaron patients tak pahunchein</p>
        </div>

        {/* Partner type selection */}
        {!type && (
          <div>
            <h2 className="text-lg font-semibold text-navy-700 mb-4 text-center">Aap kya hain?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {[
                { id: 'pharmacy', icon: '💊', label: 'Pharmacy', hindi: 'दवाई की दुकान', desc: 'Medicine store, chemist' },
                { id: 'lab',      icon: '🔬', label: 'Diagnostic Lab', hindi: 'जांच केंद्र', desc: 'Blood tests, reports' },
                { id: 'insurance',icon: '🛡️', label: 'Insurance Agent', hindi: 'बीमा एजेंट', desc: 'Health insurance' },
              ].map(p => (
                <button key={p.id} onClick={() => setType(p.id as PartnerType)}
                  className="card hover:border-teal-400 hover:shadow-md transition-all text-center border-2 border-transparent group">
                  <div className="text-4xl mb-3">{p.icon}</div>
                  <p className="font-bold text-navy-700 group-hover:text-teal-600">{p.label}</p>
                  <p className="text-teal-600 text-sm">{p.hindi}</p>
                  <p className="text-gray-400 text-xs mt-1">{p.desc}</p>
                </button>
              ))}
            </div>

            {/* Benefits */}
            <div className="card shadow-sm mb-6">
              <h3 className="font-bold text-navy-700 mb-4">Partner banne ke fayde</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {[
                  '✅ Sehatsandhi ki listing mein aayenge',
                  '✅ WhatsApp par direct orders milenge',
                  '✅ Doctor prescriptions directly milenge',
                  '✅ Monthly analytics report milegi',
                  '✅ Verified partner badge milega',
                  '✅ Commission on every transaction',
                ].map(b => (
                  <p key={b} className="text-gray-600">{b}</p>
                ))}
              </div>
            </div>

            {/* Pricing preview */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { type: 'pharmacy', icon: '💊', name: 'Pharmacy' },
                { type: 'lab',      icon: '🔬', name: 'Lab' },
                { type: 'insurance',icon: '🛡️', name: 'Insurance' },
              ].map(p => {
                const pricing = PARTNER_PRICING[p.type as keyof typeof PARTNER_PRICING]
                return (
                  <div key={p.type} className="bg-navy-50 rounded-xl p-4 text-center">
                    <p className="text-2xl mb-1">{p.icon}</p>
                    <p className="font-medium text-navy-700 text-sm">{p.name}</p>
                    <p className="text-teal-600 font-bold">₹{pricing.basic}/mo</p>
                    <p className="text-gray-400 text-xs">+ {pricing.commission} commission</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Registration form */}
        {type && (
          <div className="card shadow-md">
            {/* Back */}
            <button onClick={() => { setType(null); setStep(1); setForm({}) }}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6">
              <ChevronLeft className="w-4 h-4" /> Partner type badlein
            </button>

            <div className="flex items-center gap-2 mb-6">
              <span className="text-2xl">{type === 'pharmacy' ? '💊' : type === 'lab' ? '🔬' : '🛡️'}</span>
              <h2 className="text-xl font-bold text-navy-700">
                {type === 'pharmacy' ? 'Pharmacy' : type === 'lab' ? 'Diagnostic Lab' : 'Insurance Agent'} Registration
              </h2>
            </div>

            <div className="space-y-4">
              {/* Common fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    {type === 'insurance' ? 'Aapka naam *' : 'Business/Shop naam *'}
                  </label>
                  <input className="input-field"
                    placeholder={type === 'insurance' ? 'Ramesh Kumar' : type === 'pharmacy' ? 'Sharma Medical Store' : 'City Diagnostics'}
                    value={form.business_name || ''}
                    onChange={e => upd('business_name', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Phone number *</label>
                  <input className="input-field" type="tel" maxLength={10} placeholder="10 digit number"
                    value={form.phone || ''} onChange={e => upd('phone', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
                  <input className="input-field" type="email" placeholder="email@example.com"
                    value={form.email || ''} onChange={e => upd('email', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">PIN code *</label>
                  <select className="input-field" value={form.pin_code || ''}
                    onChange={e => upd('pin_code', e.target.value)}>
                    <option value="">Select PIN code</option>
                    {['135001-Yamuna Nagar','135003-Jagadhri','135002-Radaur','135004-Bilaspur'].map(p => (
                      <option key={p} value={p.split('-')[0]}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Address *</label>
                  <textarea className="input-field" rows={2}
                    placeholder="Full address with landmark"
                    value={form.address || ''} onChange={e => upd('address', e.target.value)} />
                </div>
              </div>

              {/* Pharmacy specific */}
              {type === 'pharmacy' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Drug License Number *</label>
                    <input className="input-field" placeholder="DL-HR-XXXXX"
                      value={form.license || ''} onChange={e => upd('license', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Home Delivery?</label>
                    <select className="input-field" value={form.delivery || ''}
                      onChange={e => upd('delivery', e.target.value)}>
                      <option value="">Select</option>
                      <option value="yes">Haan, delivery available</option>
                      <option value="no">Nahi, sirf pickup</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Opening Hours</label>
                    <input className="input-field" placeholder="8am-10pm"
                      value={form.hours || ''} onChange={e => upd('hours', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">24 hours open?</label>
                    <select className="input-field" value={form.open24 || ''}
                      onChange={e => upd('open24', e.target.value)}>
                      <option value="">Select</option>
                      <option value="yes">Haan, 24/7</option>
                      <option value="no">Nahi</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Lab specific */}
              {type === 'lab' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Lab License/Registration</label>
                    <input className="input-field" placeholder="Lab registration number"
                      value={form.license || ''} onChange={e => upd('license', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">NABL Certified?</label>
                    <select className="input-field" value={form.nabl || ''}
                      onChange={e => upd('nabl', e.target.value)}>
                      <option value="">Select</option>
                      <option value="yes">Haan, NABL certified</option>
                      <option value="no">Nahi</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Home Collection?</label>
                    <select className="input-field" value={form.home_collection || ''}
                      onChange={e => upd('home_collection', e.target.value)}>
                      <option value="">Select</option>
                      <option value="yes">Haan, ghar par aate hain</option>
                      <option value="no">Nahi, sirf lab mein</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Collection Timing</label>
                    <input className="input-field" placeholder="6am-10am"
                      value={form.collection_time || ''} onChange={e => upd('collection_time', e.target.value)} />
                  </div>
                </div>
              )}

              {/* Insurance specific */}
              {type === 'insurance' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">IRDA License Number *</label>
                    <input className="input-field" placeholder="IRDA/XXXXX"
                      value={form.irda || ''} onChange={e => upd('irda', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Company represented</label>
                    <input className="input-field" placeholder="Star Health, Niva Bupa..."
                      value={form.company || ''} onChange={e => upd('company', e.target.value)} />
                  </div>
                </div>
              )}

              {/* Pricing summary */}
              {type && (
                <div className="bg-navy-700 rounded-xl p-5 text-white">
                  <h3 className="font-bold mb-3">Partnership Plan</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/70">Monthly listing fee</span>
                      <span>₹{PARTNER_PRICING[type].basic}/month</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Commission per order</span>
                      <span>{PARTNER_PRICING[type].commission}</span>
                    </div>
                    <div className="border-t border-white/20 pt-2 flex justify-between font-bold">
                      <span>Monthly investment</span>
                      <span>₹{PARTNER_PRICING[type].basic}</span>
                    </div>
                  </div>
                  <p className="text-white/50 text-xs mt-2">
                    Payment verification ke baad request hogi
                  </p>
                </div>
              )}

              <button onClick={handleSubmit}
                disabled={loading || !form.business_name || !form.phone || !form.pin_code}
                className="btn-teal w-full justify-center py-3 text-base disabled:opacity-50">
                {loading ? 'Submit ho raha hai...' : '✓ Registration Submit Karein'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                Submit karne ke baad hamare team 24 ghante mein contact karegi
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
