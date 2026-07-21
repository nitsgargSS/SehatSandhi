import { useEffect, useState } from 'react'
import { Calendar, MapPin, LogOut, User, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Doctor, Appointment, PIN_CODES } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'

export default function DoctorDashboard() {
  const { t } = useLanguage()
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'appointments' | 'areas'>('overview')

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/doctor/login'; return }
      const { data: doc } = await supabase.from('doctors').select('*').eq('email', user.email).single()
      if (doc) {
        setDoctor(doc)
        const { data: appts } = await supabase.from('appointments').select('*').eq('doctor_id', doc.id).order('created_at', { ascending: false }).limit(20)
        setAppointments(appts || [])
      }
      setLoading(false)
    }
    load()
  }, [])

  const logout = async () => { await supabase.auth.signOut(); window.location.href = '/doctor/login' }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-400">{t('dashboardPage.loading')}</div></div>
  if (!doctor) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-400">
        {t('dashboardPage.noProfileFound')} <a href="/doctor" className="text-teal-600">{t('dashboardPage.registerHereLink')}</a>
      </div>
    </div>
  )

  const tabs = [
    { id: 'overview', label: t('dashboardPage.tabOverview'), icon: <Star className="w-4 h-4" /> },
    { id: 'appointments', label: t('dashboardPage.tabAppointments'), icon: <Calendar className="w-4 h-4" /> },
    { id: 'areas', label: t('dashboardPage.tabAreas'), icon: <MapPin className="w-4 h-4" /> },
  ]

  return (
    <div className="min-h-screen bg-gray-50 pt-20">
      {/* Header */}
      <div className="bg-navy-700 text-white py-6">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-teal-500/30 flex items-center justify-center">
              <User className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{doctor.name}</h1>
              <p className="text-white/60 text-sm">{doctor.qualification} · {doctor.speciality} · {doctor.clinic_name}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${doctor.status === 'active' ? 'bg-teal-500/30 text-teal-300' : 'bg-amber-500/30 text-amber-300'}`}>
                {doctor.status === 'active' ? t('dashboardPage.statusActive') : t('dashboardPage.statusPending')}
              </span>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-2 text-white/60 hover:text-white text-sm transition">
            <LogOut className="w-4 h-4" /> {t('dashboardPage.logout')}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Stats — no pricing shown */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: t('dashboardPage.statTotalAppointments'), value: appointments.length, icon: <Calendar className="w-5 h-5 text-teal-500" /> },
            { label: t('dashboardPage.statThisMonth'), value: appointments.filter(a => new Date(a.created_at).getMonth() === new Date().getMonth()).length, icon: <Calendar className="w-5 h-5 text-teal-500" /> },
            { label: t('dashboardPage.statActiveAreas'), value: doctor.pin_codes?.length || 0, icon: <MapPin className="w-5 h-5 text-navy-600" /> },
            { label: t('dashboardPage.statStatus'), value: doctor.status === 'active' ? '✓' : '⏳', icon: <Star className="w-5 h-5 text-amber-500" /> },
          ].map(s => (
            <div key={s.label} className="card shadow-sm">
              <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-gray-500">{s.label}</span></div>
              <p className="text-2xl font-bold text-navy-700">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-200 rounded-xl p-1 mb-6 w-fit">
          {tabs.map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === tb.id ? 'bg-white text-navy-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {tb.icon} {tb.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="card shadow-sm">
            <h3 className="font-bold text-navy-700 mb-4">{t('dashboardPage.recentAppointments')}</h3>
            {appointments.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">{t('dashboardPage.noAppointmentsYet')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 text-gray-500 text-xs">
                    <th className="text-left py-2 px-2">{t('dashboardPage.colPatient')}</th>
                    <th className="text-left py-2 px-2">{t('dashboardPage.colDateTime')}</th>
                    <th className="text-left py-2 px-2">{t('dashboardPage.colStatus')}</th>
                  </tr></thead>
                  <tbody>{appointments.slice(0, 10).map(a => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-2"><p className="font-medium text-gray-800">{a.patient_name}</p><p className="text-gray-400 text-xs">{t('dashboardPage.ageLabel')} {a.patient_age}</p></td>
                      <td className="py-3 px-2 text-gray-600">{new Date(a.slot_datetime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="py-3 px-2">
                        <span className={a.status === 'completed' ? 'badge-active' : a.status === 'cancelled' ? 'badge-suspended' : 'badge-pending'}>{a.status}</span>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Appointments */}
        {tab === 'appointments' && (
          <div className="card shadow-sm">
            <h3 className="font-bold text-navy-700 mb-4">{t('dashboardPage.allAppointments')}</h3>
            {appointments.length === 0
              ? <p className="text-gray-400 text-sm text-center py-8">{t('dashboardPage.noAppointments')}</p>
              : <div className="space-y-2">
                  {appointments.map(a => (
                    <div key={a.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{a.patient_name}</p>
                        <p className="text-xs text-gray-400">{t('dashboardPage.ageLabel')} {a.patient_age} · {new Date(a.slot_datetime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      </div>
                      <span className={a.status === 'completed' ? 'badge-active' : a.status === 'cancelled' ? 'badge-suspended' : 'badge-pending'}>{a.status}</span>
                    </div>
                  ))}
                </div>
            }
          </div>
        )}

        {/* Areas — no pricing shown */}
        {tab === 'areas' && (
          <div className="card shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-700">{t('dashboardPage.activeAreasHeading')}</h3>
              <span className="badge-active">{doctor.pin_codes?.length || 0} {t('dashboardPage.areasActiveBadge')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {(doctor.pin_codes || []).map(code => {
                const pin = PIN_CODES.find(p => p.code === code)
                return (
                  <div key={code} className="border-2 border-teal-200 bg-teal-50 rounded-xl p-3">
                    <p className="font-bold text-navy-700">{code}</p>
                    <p className="text-xs text-gray-500">{pin?.area || code}</p>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 bg-navy-50 border border-navy-100 rounded-xl p-4">
              <p className="text-sm text-navy-700">{t('dashboardPage.contactAdminNote')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
