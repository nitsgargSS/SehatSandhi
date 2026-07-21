import { useState } from 'react'
import { CheckCircle2, ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PIN_CODES } from '../types'
import CustomAreaSearch, { CustomArea } from '../components/CustomAreaSearch'

type PartnerType = 'pharmacy' | 'lab' | 'insurance' | 'ambulance' | null

export default function PartnerRegister() {
  const [type, setType] = useState<PartnerType>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [selectedPins, setSelectedPins] = useState<string[]>([])
  const [customAreas, setCustomAreas] = useState<CustomArea[]>([])
  const upd = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const togglePin = (code: string) =>
    setSelectedPins(p => p.includes(code) ? p.filter(c => c !== code) : [...p, code])

  const allSelectedAreaNames = [
    ...selectedPins.map(c => PIN_CODES.find(p => p.code === c)?.area).filter(Boolean),
    ...customAreas.map(a => a.area_name),
  ]

  const handleSubmit = async () => {
    setLoading(true)
    await supabase.from('doctors').insert({
      name: form.business_name || form.agent_name,
      speciality: type?.toUpperCase(),
      clinic_name: form.business_name || form.agent_name,
      address: form.address,
      pin_codes: [...selectedPins, ...customAreas.map(a => a.pin_code)],
      phone: form.phone,
      email: form.email,
      qualification:
        type === 'insurance' ? 'IRDA Licensed' :
        type === 'lab' ? 'Diagnostic Lab' :
        type === 'ambulance' ? 'Ambulance Service' :
        'Pharmacy',
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
        <h2 className="text-2xl font-bold text-navy-700 mb-3">Registration Submitted! 🎉</h2>
        <p className="text-gray-500 mb-6">
          Shukriya! Hamare team 24-48 ghante mein aapki details verify karengi,
          aapke selected areas ke hisaab se <strong>pricing WhatsApp par</strong> bhejegi,
          aur agreement share karegi.
        </p>
        <div className="bg-teal-50 rounded-xl p-4 text-sm text-teal-700">
          <p className="font-medium">Aage kya hoga:</p>
          <p className="mt-1">✅ Team call karegi verification ke liye</p>
          <p>✅ Aapke areas ke hisaab se pricing confirm hogi</p>
          <p>✅ Agreement share kiya jayega</p>
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { id: 'pharmacy', icon: '💊', label: 'Pharmacy', hindi: 'दवाई की दुकान', desc: 'Medicine store, chemist' },
                { id: 'lab',      icon: '🔬', label: 'Diagnostic Lab', hindi: 'जांच केंद्र', desc: 'Blood tests, reports' },
                { id: 'ambulance',icon: '🚑', label: 'Ambulance Service', hindi: 'एम्बुलेंस सेवा', desc: 'Emergency & patient transport' },
                { id: 'insurance',icon: '🛡️', label: 'Insurance Agent', hindi: 'बीमा एजेंट', desc: 'Health insurance' },
              ].map(p => (
                <button key={p.id} onClick={() => setType(p.id as PartnerType)}
                  className="card hover:border-teal-400 hover:shadow-md transition-all text-center border-2 border-transparent group">
                  <div className="text-4xl mb-3">{p.icon}</div>
                  <p className="font-bold text-navy-700 group-hover:text-teal-600 text-sm">{p.label}</p>
                  <p className="text-teal-600 text-xs">{p.hindi}</p>
                  <p className="text-gray-400 text-xs mt-1">{p.desc}</p>
                </button>
              ))}
            </div>

            {/* Benefits — no pricing numbers */}
            <div className="card shadow-sm">
              <h3 className="font-bold text-navy-700 mb-4">Partner banne ke fayde</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {[
                  '✅ Sehatsandhi ki listing mein aayenge',
                  '✅ WhatsApp par direct orders/calls milenge',
                  '✅ Doctor referrals directly milenge',
                  '✅ Monthly analytics report milegi',
                  '✅ Verified partner badge milega',
                  '✅ Pricing aapke area ke hisaab se — team confirm karegi',
                ].map(b => (
                  <p key={b} className="text-gray-600">{b}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Registration form */}
        {type && (
          <div className="card shadow-md">
            {/* Back */}
            <button onClick={() => { setType(null); setForm({}); setSelectedPins([]); setCustomAreas([]) }}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6">
              <ChevronLeft className="w-4 h-4" /> Partner type badlein
            </button>

            <div className="flex items-center gap-2 mb-6">
              <span className="text-2xl">
                {type === 'pharmacy' ? '💊' : type === 'lab' ? '🔬' : type === 'ambulance' ? '🚑' : '🛡️'}
              </span>
              <h2 className="text-xl font-bold text-navy-700">
                {type === 'pharmacy' ? 'Pharmacy' : type === 'lab' ? 'Diagnostic Lab' : type === 'ambulance' ? 'Ambulance Service' : 'Insurance Agent'} Registration
              </h2>
            </div>

            <div className="space-y-4">
              {/* Common fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    {type === 'insurance' ? 'Aapka naam *' : type === 'ambulance' ? 'Service/Fleet naam *' : 'Business/Shop naam *'}
                  </label>
                  <input className="input-field"
                    placeholder={
                      type === 'insurance' ? 'Ramesh Kumar' :
                      type === 'pharmacy' ? 'Sharma Medical Store' :
                      type === 'ambulance' ? 'Quick Response Ambulance' :
                      'City Diagnostics'
                    }
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
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Address *</label>
                  <textarea className="input-field" rows={2}
                    placeholder="Full address with landmark"
                    value={form.address || ''} onChange={e => upd('address', e.target.value)} />
                </div>
              </div>

              {/* Area selection — multi-select grid + custom search, matches doctor flow */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">
                  Kaun se areas mein service dete hain? *
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  Sirf woh areas chunein jahan aap genuinely service commit kar sakte hain
                  {type === 'pharmacy' && ' (delivery)'}
                  {type === 'lab' && ' (home collection)'}
                  {type === 'ambulance' && ' (24/7 response)'}
                  {type === 'insurance' && ' (home visit)'}.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {PIN_CODES.map(p => (
                    <button key={p.code} type="button" onClick={() => togglePin(p.code)}
                      className={`flex flex-col items-start p-2.5 rounded-xl border-2 transition-all text-left ${selectedPins.includes(p.code) ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-teal-300'}`}>
                      <span className="font-bold text-xs text-navy-700">{p.code}</span>
                      <span className="text-xs text-gray-500">{p.area}</span>
                    </button>
                  ))}
                </div>
                <CustomAreaSearch
                  existingPins={PIN_CODES.map(p => p.code)}
                  onAreasChange={setCustomAreas}
                  label="Yeh list mein nahi hai? Aur area add karein"
                />
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

              {/* Ambulance specific */}
              {type === 'ambulance' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Ambulance Permit/Registration *</label>
                    <input className="input-field" placeholder="Permit number"
                      value={form.permit || ''} onChange={e => upd('permit', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Ambulance Type *</label>
                    <select className="input-field" value={form.ambulance_type || ''}
                      onChange={e => upd('ambulance_type', e.target.value)}>
                      <option value="">Select</option>
                      <option value="BLS">Basic Life Support (BLS)</option>
                      <option value="ALS">Advanced Life Support (ALS)</option>
                      <option value="transport">Patient Transport (non-emergency)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">24/7 Available?</label>
                    <select className="input-field" value={form.available_24_7 || ''}
                      onChange={e => upd('available_24_7', e.target.value)}>
                      <option value="">Select</option>
                      <option value="yes">Haan, 24/7 available</option>
                      <option value="no">Nahi, fixed hours</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Response Time Commitment *</label>
                    <select className="input-field" value={form.response_time || ''}
                      onChange={e => upd('response_time', e.target.value)}>
                      <option value="">Select</option>
                      <option value="15">15 minutes</option>
                      <option value="20">20 minutes</option>
                      <option value="30">30 minutes</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2 bg-red-50 border border-red-100 rounded-xl p-3">
                    <p className="text-xs text-red-700">
                      🚑 Emergency response is a serious public commitment — sirf woh
                      response time chunein jo aap genuinely 24/7 nibha sakte hain.
                    </p>
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

              {/* Next steps — no pricing shown */}
              <div className="bg-navy-700 rounded-xl p-5 text-white">
                <h3 className="font-bold mb-2">Aage Kya Hoga?</h3>
                <ol className="text-sm text-white/80 space-y-1 list-decimal list-inside">
                  <li>Hamari team aapki details 24-48 ghante mein verify karegi</li>
                  <li>Aapke selected areas ke hisaab se pricing WhatsApp par bhejenge</li>
                  <li>Confirm karne par agreement + listing activate ho jayegi</li>
                </ol>
              </div>

              <button onClick={handleSubmit}
                disabled={loading || !form.business_name || !form.phone || (selectedPins.length === 0 && customAreas.length === 0)}
                className="btn-teal w-full justify-center py-3 text-base disabled:opacity-50">
                {loading ? 'Submit ho raha hai...' : '✓ Registration Submit Karein'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                Selected areas: {allSelectedAreaNames.join(', ') || 'None yet'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
