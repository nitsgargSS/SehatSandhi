import { useState } from 'react'
import { CheckCircle2, ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PIN_CODES } from '../types'
import CustomAreaSearch, { CustomArea } from '../components/CustomAreaSearch'
import { useLanguage } from '../i18n/LanguageContext'

type PartnerType = 'pharmacy' | 'lab' | 'insurance' | 'ambulance' | null

export default function PartnerRegister() {
  const { t, lang } = useLanguage()
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

  const typeLabel = (en: string, hi: string) => (lang === 'hi' ? hi : en)

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 pt-16">
      <div className="card max-w-md w-full text-center shadow-xl">
        <CheckCircle2 className="w-16 h-16 text-teal-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-navy-700 mb-3">{t('partnerPage.successTitle')}</h2>
        <p className="text-gray-500 mb-6">{t('partnerPage.successDesc')}</p>
        <div className="bg-teal-50 rounded-xl p-4 text-sm text-teal-700">
          <p className="font-medium">{t('partnerPage.successNextTitle')}</p>
          <p className="mt-1">✅ {t('partnerPage.successNext1')}</p>
          <p>✅ {t('partnerPage.successNext2')}</p>
          <p>✅ {t('partnerPage.successNext3')}</p>
          <p>✅ {t('partnerPage.successNext4')}</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pt-20 pb-12">
      <div className="max-w-2xl mx-auto px-4">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-navy-700">{t('partnerPage.heading')}</h1>
          <p className="text-gray-500 mt-2">{t('partnerPage.subheading')}</p>
        </div>

        {/* Partner type selection */}
        {!type && (
          <div>
            <h2 className="text-lg font-semibold text-navy-700 mb-4 text-center">{t('partnerPage.typeQuestionTitle')}</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { id: 'pharmacy', icon: '💊', title: typeLabel(t('partnerPage.typePharmacy'), t('partnerPage.typePharmacyHindi')), sub: typeLabel(t('partnerPage.typePharmacyHindi'), t('partnerPage.typePharmacy')), desc: t('partnerPage.typePharmacyDesc') },
                { id: 'lab',      icon: '🔬', title: typeLabel(t('partnerPage.typeLab'), t('partnerPage.typeLabHindi')), sub: typeLabel(t('partnerPage.typeLabHindi'), t('partnerPage.typeLab')), desc: t('partnerPage.typeLabDesc') },
                { id: 'ambulance',icon: '🚑', title: typeLabel(t('partnerPage.typeAmbulance'), t('partnerPage.typeAmbulanceHindi')), sub: typeLabel(t('partnerPage.typeAmbulanceHindi'), t('partnerPage.typeAmbulance')), desc: t('partnerPage.typeAmbulanceDesc') },
                { id: 'insurance',icon: '🛡️', title: typeLabel(t('partnerPage.typeInsurance'), t('partnerPage.typeInsuranceHindi')), sub: typeLabel(t('partnerPage.typeInsuranceHindi'), t('partnerPage.typeInsurance')), desc: t('partnerPage.typeInsuranceDesc') },
              ].map(p => (
                <button key={p.id} onClick={() => setType(p.id as PartnerType)}
                  className="card hover:border-teal-400 hover:shadow-md transition-all text-center border-2 border-transparent group">
                  <div className="text-4xl mb-3">{p.icon}</div>
                  <p className="font-bold text-navy-700 group-hover:text-teal-600 text-sm">{p.title}</p>
                  <p className="text-teal-600 text-xs">{p.sub}</p>
                  <p className="text-gray-400 text-xs mt-1">{p.desc}</p>
                </button>
              ))}
            </div>

            {/* Benefits */}
            <div className="card shadow-sm">
              <h3 className="font-bold text-navy-700 mb-4">{t('partnerPage.benefitsTitle')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {[
                  t('partnerPage.benefit1'),
                  t('partnerPage.benefit2'),
                  t('partnerPage.benefit3'),
                  t('partnerPage.benefit4'),
                  t('partnerPage.benefit5'),
                  t('partnerPage.benefit6'),
                ].map(b => (
                  <p key={b} className="text-gray-600">✅ {b}</p>
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
              <ChevronLeft className="w-4 h-4" /> {t('partnerPage.changeType')}
            </button>

            <div className="flex items-center gap-2 mb-6">
              <span className="text-2xl">
                {type === 'pharmacy' ? '💊' : type === 'lab' ? '🔬' : type === 'ambulance' ? '🚑' : '🛡️'}
              </span>
              <h2 className="text-xl font-bold text-navy-700">
                {type === 'pharmacy' ? t('partnerPage.typePharmacy') : type === 'lab' ? t('partnerPage.typeLab') : type === 'ambulance' ? t('partnerPage.typeAmbulance') : t('partnerPage.typeInsurance')} {t('partnerPage.registrationSuffix')}
              </h2>
            </div>

            <div className="space-y-4">
              {/* Common fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    {type === 'insurance' ? t('partnerPage.labelAgentName') : type === 'ambulance' ? t('partnerPage.labelFleetName') : t('partnerPage.labelBusinessName')}
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
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelPhone')}</label>
                  <input className="input-field" type="tel" maxLength={10} placeholder="10 digit number"
                    value={form.phone || ''} onChange={e => upd('phone', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelEmail')}</label>
                  <input className="input-field" type="email" placeholder="email@example.com"
                    value={form.email || ''} onChange={e => upd('email', e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelAddress')}</label>
                  <textarea className="input-field" rows={2}
                    placeholder={t('partnerPage.placeholderAddress')}
                    value={form.address || ''} onChange={e => upd('address', e.target.value)} />
                </div>
              </div>

              {/* Area selection — multi-select grid + custom search */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">{t('partnerPage.areaSectionLabel')}</label>
                <p className="text-xs text-gray-400 mb-3">
                  {t('partnerPage.areaSectionNoteBase')}
                  {type === 'pharmacy' && t('partnerPage.areaNotePharmacy')}
                  {type === 'lab' && t('partnerPage.areaNoteLab')}
                  {type === 'ambulance' && t('partnerPage.areaNoteAmbulance')}
                  {type === 'insurance' && t('partnerPage.areaNoteInsurance')}.
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
                />
              </div>

              {/* Pharmacy specific */}
              {type === 'pharmacy' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelLicense')}</label>
                    <input className="input-field" placeholder="DL-HR-XXXXX"
                      value={form.license || ''} onChange={e => upd('license', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelDelivery')}</label>
                    <select className="input-field" value={form.delivery || ''}
                      onChange={e => upd('delivery', e.target.value)}>
                      <option value="">—</option>
                      <option value="yes">{t('partnerPage.yes')}</option>
                      <option value="no">{t('partnerPage.no')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelHours')}</label>
                    <input className="input-field" placeholder="8am-10pm"
                      value={form.hours || ''} onChange={e => upd('hours', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.label24Open')}</label>
                    <select className="input-field" value={form.open24 || ''}
                      onChange={e => upd('open24', e.target.value)}>
                      <option value="">—</option>
                      <option value="yes">{t('partnerPage.yes247')}</option>
                      <option value="no">{t('partnerPage.noFixed')}</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Lab specific */}
              {type === 'lab' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelLabLicense')}</label>
                    <input className="input-field" placeholder="Lab registration number"
                      value={form.license || ''} onChange={e => upd('license', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelNABL')}</label>
                    <select className="input-field" value={form.nabl || ''}
                      onChange={e => upd('nabl', e.target.value)}>
                      <option value="">—</option>
                      <option value="yes">{t('partnerPage.nablYes')}</option>
                      <option value="no">{t('partnerPage.nablNo')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelHomeCollection')}</label>
                    <select className="input-field" value={form.home_collection || ''}
                      onChange={e => upd('home_collection', e.target.value)}>
                      <option value="">—</option>
                      <option value="yes">{t('partnerPage.collectionYes')}</option>
                      <option value="no">{t('partnerPage.collectionNo')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelCollectionTiming')}</label>
                    <input className="input-field" placeholder="6am-10am"
                      value={form.collection_time || ''} onChange={e => upd('collection_time', e.target.value)} />
                  </div>
                </div>
              )}

              {/* Ambulance specific */}
              {type === 'ambulance' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelPermit')}</label>
                    <input className="input-field" placeholder="Permit number"
                      value={form.permit || ''} onChange={e => upd('permit', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelAmbulanceType')}</label>
                    <select className="input-field" value={form.ambulance_type || ''}
                      onChange={e => upd('ambulance_type', e.target.value)}>
                      <option value="">—</option>
                      <option value="BLS">{t('partnerPage.typeBLS')}</option>
                      <option value="ALS">{t('partnerPage.typeALS')}</option>
                      <option value="transport">{t('partnerPage.typeTransport')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.label247')}</label>
                    <select className="input-field" value={form.available_24_7 || ''}
                      onChange={e => upd('available_24_7', e.target.value)}>
                      <option value="">—</option>
                      <option value="yes">{t('partnerPage.available247Yes')}</option>
                      <option value="no">{t('partnerPage.available247No')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelResponseTime')}</label>
                    <select className="input-field" value={form.response_time || ''}
                      onChange={e => upd('response_time', e.target.value)}>
                      <option value="">—</option>
                      <option value="15">{t('partnerPage.response15')}</option>
                      <option value="20">{t('partnerPage.response20')}</option>
                      <option value="30">{t('partnerPage.response30')}</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2 bg-red-50 border border-red-100 rounded-xl p-3">
                    <p className="text-xs text-red-700">{t('partnerPage.ambulanceWarning')}</p>
                  </div>
                </div>
              )}

              {/* Insurance specific */}
              {type === 'insurance' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelIRDA')}</label>
                    <input className="input-field" placeholder="IRDA/XXXXX"
                      value={form.irda || ''} onChange={e => upd('irda', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('partnerPage.labelCompany')}</label>
                    <input className="input-field" placeholder="Star Health, Niva Bupa..."
                      value={form.company || ''} onChange={e => upd('company', e.target.value)} />
                  </div>
                </div>
              )}

              {/* Next steps — no pricing shown */}
              <div className="bg-navy-700 rounded-xl p-5 text-white">
                <h3 className="font-bold mb-2">{t('partnerPage.nextStepsTitle')}</h3>
                <ol className="text-sm text-white/80 space-y-1 list-decimal list-inside">
                  <li>{t('partnerPage.nextStep1')}</li>
                  <li>{t('partnerPage.nextStep2')}</li>
                  <li>{t('partnerPage.nextStep3')}</li>
                </ol>
              </div>

              <button onClick={handleSubmit}
                disabled={loading || !form.business_name || !form.phone || (selectedPins.length === 0 && customAreas.length === 0)}
                className="btn-teal w-full justify-center py-3 text-base disabled:opacity-50">
                {loading ? t('partnerPage.btnSubmitting') : t('partnerPage.btnSubmit')}
              </button>
              <p className="text-xs text-gray-400 text-center">
                {t('partnerPage.selectedAreasPrefix')} {allSelectedAreaNames.join(', ') || t('partnerPage.noneYet')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
