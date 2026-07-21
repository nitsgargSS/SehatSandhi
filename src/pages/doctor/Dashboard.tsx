import { useEffect, useState } from 'react'
import { Calendar, MapPin, LogOut, User, Star, Users, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Doctor, Appointment, PIN_CODES } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'

interface StaffMember {
  id: string
  full_name: string
  whatsapp_number: string
  role: string
  can_login_web: boolean
  is_active: boolean
}

export default function DoctorDashboard() {
  const { t } = useLanguage()
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'appointments' | 'areas' | 'staff'>('overview')

  const [showAddStaff, setShowAddStaff] = useState(false)
  const [staffForm, setStaffForm] = useState({ full_name: '', whatsapp_number: '', role: 'receptionist', can_login_web: true })
  const [staffSubmitting, setStaffSubmitting] = useState(false)

  const loadStaff = async (doctorId: string) => {
    const { data } = await supabase.from('clinic_users').select('*').eq('doctor_id', doctorId).order('created_at', { ascending: true })
    setStaff(data || [])
  }

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/doctor/login'; return }
      const { data: doc } = await supabase.from('doctors').select('*').eq('email', user.email).single()
      if (doc) {
        setDoctor(doc)
        const { data: appts } = await supabase.from('appointments').select('*').eq('doctor_id', doc.id).order('created_at', { ascending: false }).limit(20)
        setAppointments(appts || [])
        await loadStaff(doc.id)
      }
      setLoading(false)
    }
    load()
  }, [])

  const logout = async () => { await supabase.auth.signOut(); window.location.href = '/doctor/login' }

  const submitStaff = async () => {
    if (!doctor || !staffForm.full_name || !staffForm.whatsapp_number) return
    setStaffSubmitting(true)
    await supabase.from('clinic_users').insert({
      doctor_id: doctor.id,
      full_name: staffForm.full_name,
      whatsapp_number: staffForm.whatsapp_number,
      role: staffForm.role,
      can_login_web: staffForm.can_login_web,
      is_active: true,
    })
    await loadStaff(doctor.id)
    setStaffForm({ full_name: '', whatsapp_number: '', role: 'receptionist', can_login_web: true })
    setShowAddStaff(false)
    setStaffSubmitting(false)
  }

  const toggleStaffActive = async (member: StaffMember) => {
    await supabase.from('clinic_users').update({ is_active: !member.is_active }).eq('id', member.id)
    if (doctor) await loadStaff(doctor.id)
  }

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
    { id: 'staff', label: t('dashboardPage.tabStaff'), icon: <Users className="w-4 h-4" /> },
  ]

  const roleLabel = (r: string) => r === 'receptionist' ? t('dashboardPage.roleReceptionist') : r === 'manager' ? t('dashboardPage.roleManager') : r === 'doctor' ? t('dashboardPage.roleDoctor') : r

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
        {/* Stats */}
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
        <div className="flex gap-1 bg-gray-200 rounded-xl p-1 mb-6 w-fit flex-wrap">
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

        {/* Areas */}
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

        {/* Staff */}
        {tab === 'staff' && (
          <div className="card shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-700">{t('dashboardPage.staffHeading')}</h3>
              {!showAddStaff && (
                <button onClick={() => setShowAddStaff(true)} className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> {t('dashboardPage.addStaffButton')}
                </button>
              )}
            </div>

            {showAddStaff && (
              <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-3">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-navy-700">{t('dashboardPage.addStaffButton')}</p>
                  <button onClick={() => setShowAddStaff(false)}><X className="w-4 h-4 text-gray-400" /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.staffNameLabel')}</label>
                    <input className="input-field" placeholder="Sunita Devi"
                      value={staffForm.full_name} onChange={e => setStaffForm(f => ({ ...f, full_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.staffWhatsappLabel')}</label>
                    <input className="input-field" type="tel" maxLength={10} placeholder="9876543210"
                      value={staffForm.whatsapp_number} onChange={e => setStaffForm(f => ({ ...f, whatsapp_number: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.staffRoleLabel')}</label>
                    <select className="input-field" value={staffForm.role} onChange={e => setStaffForm(f => ({ ...f, role: e.target.value }))}>
                      <option value="receptionist">{t('dashboardPage.roleReceptionist')}</option>
                      <option value="manager">{t('dashboardPage.roleManager')}</option>
                      <option value="doctor">{t('dashboardPage.roleDoctor')}</option>
                    </select>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={staffForm.can_login_web}
                        onChange={e => setStaffForm(f => ({ ...f, can_login_web: e.target.checked }))}
                        className="w-4 h-4 accent-teal-600" />
                      {t('dashboardPage.staffWebLoginLabel')}
                    </label>
                  </div>
                </div>
                <button onClick={submitStaff} disabled={staffSubmitting || !staffForm.full_name || !staffForm.whatsapp_number}
                  className="btn-teal text-sm disabled:opacity-50">
                  {t('dashboardPage.staffSubmitButton')}
                </button>
              </div>
            )}

            {staff.length === 0 && !showAddStaff ? (
              <p className="text-gray-400 text-sm text-center py-8">{t('dashboardPage.staffNoneYet')}</p>
            ) : (
              <div className="space-y-2">
                {staff.map(m => (
                  <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">{m.full_name}</p>
                      <p className="text-xs text-gray-400">{roleLabel(m.role)} · {m.whatsapp_number}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={m.is_active ? 'badge-active' : 'badge-suspended'}>
                        {m.is_active ? t('dashboardPage.staffActive') : t('dashboardPage.staffInactive')}
                      </span>
                      <button onClick={() => toggleStaffActive(m)}
                        className="text-xs text-gray-400 hover:text-teal-600 underline">
                        {m.is_active ? t('dashboardPage.staffDeactivate') : t('dashboardPage.staffReactivate')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 bg-teal-50 border border-teal-100 rounded-xl p-3">
              <p className="text-xs text-teal-700">💡 {t('dashboardPage.staffNote')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
