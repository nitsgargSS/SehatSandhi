import { useEffect, useState } from 'react'
import { Calendar, MapPin, LogOut, User, Star, Users, Plus, X, Tent, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Doctor, Appointment, PIN_CODES } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { generateSlotsForDate, DAYS_OF_WEEK, AvailabilityTemplate } from '../../lib/availability'

interface StaffMember {
  id: string
  full_name: string
  whatsapp_number: string
  role: string
  can_login_web: boolean
  is_active: boolean
}

interface CampOffer {
  id: string
  camp_type: 'free_camp' | 'special_offer'
  title: string
  description: string
  services_offered: string | null
  date_from: string
  date_to: string
  time_slot: string | null
  pin_codes: string[]
  status: string
  created_at: string
}

export default function DoctorDashboard() {
  const { t } = useLanguage()
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [camps, setCamps] = useState<CampOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'appointments' | 'areas' | 'staff' | 'camps' | 'availability'>('overview')
  const [availability, setAvailability] = useState<AvailabilityTemplate[]>([])
  const [availSaving, setAvailSaving] = useState(false)
  const [availSaved, setAvailSaved] = useState(false)

  const [showAddStaff, setShowAddStaff] = useState(false)
  const [staffForm, setStaffForm] = useState({ full_name: '', whatsapp_number: '', role: 'receptionist', can_login_web: true })
  const [staffSubmitting, setStaffSubmitting] = useState(false)

  const [showAddCamp, setShowAddCamp] = useState(false)
  const [campForm, setCampForm] = useState({
    camp_type: 'free_camp' as 'free_camp' | 'special_offer',
    title: '', description: '', services_offered: '',
    date_from: '', date_to: '', time_slot: '', pin_codes: [] as string[],
  })
  const [campSubmitting, setCampSubmitting] = useState(false)

  const loadStaff = async (doctorId: string) => {
    const { data } = await supabase.from('clinic_users').select('*').eq('doctor_id', doctorId).order('created_at', { ascending: true })
    setStaff(data || [])
  }

  const loadCamps = async (doctorId: string) => {
    const { data } = await supabase.from('camps_offers').select('*').eq('doctor_id', doctorId).order('created_at', { ascending: false })
    setCamps(data || [])
  }

  const loadAvailability = async (doctorId: string) => {
    const { data } = await supabase.from('doctor_availability').select('*').eq('doctor_id', doctorId).eq('is_active', true)
    setAvailability((data as AvailabilityTemplate[]) || [])
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
        await loadCamps(doc.id)
        await loadAvailability(doc.id)
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

  const toggleCampArea = (code: string) =>
    setCampForm(f => ({ ...f, pin_codes: f.pin_codes.includes(code) ? f.pin_codes.filter(c => c !== code) : [...f.pin_codes, code] }))

  const submitCamp = async () => {
    if (!doctor || !campForm.title || !campForm.date_from || !campForm.date_to || campForm.pin_codes.length === 0) return
    setCampSubmitting(true)
    await supabase.from('camps_offers').insert({
      doctor_id: doctor.id,
      camp_type: campForm.camp_type,
      title: campForm.title,
      description: campForm.description,
      services_offered: campForm.services_offered || null,
      date_from: campForm.date_from,
      date_to: campForm.date_to,
      time_slot: campForm.time_slot || null,
      pin_codes: campForm.pin_codes,
      status: 'pending_approval',
    })
    await loadCamps(doctor.id)
    setCampForm({ camp_type: 'free_camp', title: '', description: '', services_offered: '', date_from: '', date_to: '', time_slot: '', pin_codes: [] })
    setShowAddCamp(false)
    setCampSubmitting(false)
  }

  // Soft, informational quota — not a hard block, just a guideline
  // shown to the doctor (admin uses judgment during approval)
  const now = new Date()
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const freeCampsThisQuarter = camps.filter(c =>
    c.camp_type === 'free_camp' && ['approved', 'completed'].includes(c.status) && new Date(c.date_from) >= quarterStart
  ).length
  const offersThisMonth = camps.filter(c =>
    c.camp_type === 'special_offer' && ['approved', 'completed'].includes(c.status) && new Date(c.date_from) >= monthStart
  ).length

  const campStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending_approval: 'badge-pending', approved: 'badge-active', completed: 'badge-active',
      rejected: 'badge-suspended', cancelled: 'badge-suspended',
    }
    return map[status] || 'badge-pending'
  }
  const campStatusLabel = (status: string, t: (k: string) => string) => {
    const map: Record<string, string> = {
      pending_approval: t('dashboardPage.statusPendingApproval'), approved: t('dashboardPage.statusApproved'),
      completed: t('dashboardPage.statusCompleted'), rejected: t('dashboardPage.statusRejected'), cancelled: t('dashboardPage.statusCancelled'),
    }
    return map[status] || status
  }

  // ── Availability management ──
  // One row per working day in local state; toggling "working
  // this day" adds/removes a row, editing fields just mutates
  // it directly. Nothing hits the database until Save.
  const getDayRow = (dow: number) => availability.find(a => a.day_of_week === dow)

  const toggleWorkingDay = (dow: number) => {
    const existing = getDayRow(dow)
    if (existing) {
      setAvailability(prev => prev.filter(a => a.day_of_week !== dow))
    } else {
      setAvailability(prev => [...prev, {
        id: `new-${dow}`, doctor_id: doctor?.id || '', day_of_week: dow,
        start_time: '10:00:00', end_time: '18:00:00', slot_duration_minutes: 15, is_active: true,
      }])
    }
  }

  const updateDayRow = (dow: number, field: 'start_time' | 'end_time' | 'slot_duration_minutes', value: string | number) => {
    setAvailability(prev => prev.map(a => a.day_of_week === dow ? { ...a, [field]: value } : a))
  }

  const saveAvailability = async () => {
    if (!doctor) return
    setAvailSaving(true)
    // Simplest reliable approach: clear this doctor's existing
    // template, then insert the current state fresh — avoids
    // having to diff old vs new rows individually
    await supabase.from('doctor_availability').delete().eq('doctor_id', doctor.id)
    if (availability.length > 0) {
      await supabase.from('doctor_availability').insert(
        availability.map(a => ({
          doctor_id: doctor.id,
          day_of_week: a.day_of_week,
          start_time: a.start_time,
          end_time: a.end_time,
          slot_duration_minutes: a.slot_duration_minutes,
          is_active: true,
        }))
      )
    }
    await loadAvailability(doctor.id)
    setAvailSaving(false)
    setAvailSaved(true)
    setTimeout(() => setAvailSaved(false), 2000)
  }

  // Preview: today's actual slots, minus already-booked ones
  const todaysBookedTimes = appointments
    .filter(a => a.status !== 'cancelled')
    .map(a => a.slot_datetime)
  const todaysSlots = generateSlotsForDate(availability, new Date(), todaysBookedTimes)

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
    { id: 'camps', label: t('dashboardPage.tabCamps'), icon: <Tent className="w-4 h-4" /> },
    { id: 'availability', label: t('dashboardPage.tabAvailability'), icon: <Clock className="w-4 h-4" /> },
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

        {/* Camps & Offers */}
        {tab === 'camps' && (
          <div className="card shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-700">{t('dashboardPage.campsHeading')}</h3>
              {!showAddCamp && (
                <button onClick={() => setShowAddCamp(true)} className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> {t('dashboardPage.addCampButton')}
                </button>
              )}
            </div>

            {/* Quota guidance — informational only */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">{t('dashboardPage.campQuotaFreeNote')}</p>
                <p className="text-lg font-bold text-navy-700">{freeCampsThisQuarter}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">{t('dashboardPage.campQuotaOfferNote')}</p>
                <p className="text-lg font-bold text-navy-700">{offersThisMonth}</p>
              </div>
            </div>

            {showAddCamp && (
              <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-3">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-navy-700">{t('dashboardPage.campsHeading')}</p>
                  <button onClick={() => setShowAddCamp(false)}><X className="w-4 h-4 text-gray-400" /></button>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.campTypeLabel')}</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setCampForm(f => ({ ...f, camp_type: 'free_camp' }))}
                      className={`flex-1 text-sm py-2 rounded-lg border-2 transition ${campForm.camp_type === 'free_camp' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-500'}`}>
                      {t('dashboardPage.campTypeFree')}
                    </button>
                    <button type="button" onClick={() => setCampForm(f => ({ ...f, camp_type: 'special_offer' }))}
                      className={`flex-1 text-sm py-2 rounded-lg border-2 transition ${campForm.camp_type === 'special_offer' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-500'}`}>
                      {t('dashboardPage.campTypeOffer')}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.campTitleLabel')}</label>
                  <input className="input-field" placeholder="Free Skin Checkup Camp"
                    value={campForm.title} onChange={e => setCampForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.campDescLabel')}</label>
                  <textarea className="input-field" rows={2}
                    value={campForm.description} onChange={e => setCampForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.campServicesLabel')}</label>
                  <input className="input-field" placeholder="Free BP check, sugar test, eye screening"
                    value={campForm.services_offered} onChange={e => setCampForm(f => ({ ...f, services_offered: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.campDateFromLabel')}</label>
                    <input className="input-field" type="date" value={campForm.date_from} onChange={e => setCampForm(f => ({ ...f, date_from: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.campDateToLabel')}</label>
                    <input className="input-field" type="date" value={campForm.date_to} onChange={e => setCampForm(f => ({ ...f, date_to: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">{t('dashboardPage.campTimeLabel')}</label>
                  <input className="input-field" placeholder="10am-1pm"
                    value={campForm.time_slot} onChange={e => setCampForm(f => ({ ...f, time_slot: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-2 block">{t('dashboardPage.campAreasLabel')}</label>
                  <div className="flex flex-wrap gap-2">
                    {(doctor?.pin_codes || []).map(code => {
                      const pin = PIN_CODES.find(p => p.code === code)
                      return (
                        <button key={code} type="button" onClick={() => toggleCampArea(code)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${campForm.pin_codes.includes(code) ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-300 text-gray-500 hover:border-teal-400'}`}>
                          {pin?.area || code}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <button onClick={submitCamp}
                  disabled={campSubmitting || !campForm.title || !campForm.date_from || !campForm.date_to || campForm.pin_codes.length === 0}
                  className="btn-teal text-sm disabled:opacity-50">
                  {t('dashboardPage.campSubmitButton')}
                </button>
              </div>
            )}

            <h4 className="text-sm font-medium text-navy-700 mb-3">{t('dashboardPage.campHistoryTitle')}</h4>
            {camps.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">{t('dashboardPage.campNoneYet')}</p>
            ) : (
              <div className="space-y-2">
                {camps.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl flex-wrap gap-2">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">
                        {c.camp_type === 'free_camp' ? '🆓' : '💰'} {c.title}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(c.date_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(c.date_to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        {' · '}{c.pin_codes.join(', ')}
                      </p>
                    </div>
                    <span className={campStatusBadge(c.status)}>{campStatusLabel(c.status, t)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Availability */}
        {tab === 'availability' && (
          <div className="card shadow-sm">
            <h3 className="font-bold text-navy-700 mb-1">{t('dashboardPage.availabilityHeading')}</h3>
            <p className="text-gray-500 text-sm mb-5">{t('dashboardPage.availabilityDesc')}</p>

            <div className="space-y-2 mb-6">
              {DAYS_OF_WEEK.map(day => {
                const row = getDayRow(day.value)
                const isWorking = !!row
                return (
                  <div key={day.value} className={`rounded-xl border-2 p-3 transition-all ${isWorking ? 'border-teal-200 bg-teal-50/30' : 'border-gray-100'}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 min-w-[110px]">
                        <input type="checkbox" checked={isWorking} onChange={() => toggleWorkingDay(day.value)} className="w-4 h-4 accent-teal-600" />
                        {day.labelEn}
                      </label>
                      {isWorking && row && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input type="time" className="input-field w-auto text-sm py-1.5"
                            value={row.start_time.slice(0, 5)}
                            onChange={e => updateDayRow(day.value, 'start_time', `${e.target.value}:00`)} />
                          <span className="text-gray-400 text-sm">–</span>
                          <input type="time" className="input-field w-auto text-sm py-1.5"
                            value={row.end_time.slice(0, 5)}
                            onChange={e => updateDayRow(day.value, 'end_time', `${e.target.value}:00`)} />
                          <select className="input-field w-auto text-sm py-1.5"
                            value={row.slot_duration_minutes}
                            onChange={e => updateDayRow(day.value, 'slot_duration_minutes', parseInt(e.target.value))}>
                            {[10, 15, 20, 30].map(m => <option key={m} value={m}>{m} {t('dashboardPage.minutesSuffix')}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3 mb-8">
              <button onClick={saveAvailability} disabled={availSaving} className="btn-teal text-sm px-6 disabled:opacity-60">
                {t('dashboardPage.saveAvailabilityButton')}
              </button>
              {availSaved && <span className="text-teal-600 text-sm font-medium">{t('dashboardPage.availabilitySaved')}</span>}
            </div>

            <div className="border-t border-gray-100 pt-5">
              <h4 className="text-sm font-medium text-navy-700 mb-3">{t('dashboardPage.previewTitle')}</h4>
              {todaysSlots.length === 0 ? (
                <p className="text-gray-400 text-sm">{t('dashboardPage.noSlotsToday')}</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {todaysSlots.map(s => (
                    <div key={s.datetime}
                      className={`text-center text-xs py-2 rounded-lg border ${s.available ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-gray-200 bg-gray-100 text-gray-400 line-through'}`}>
                      {s.time}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
