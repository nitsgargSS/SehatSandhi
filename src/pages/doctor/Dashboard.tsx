import { useEffect, useState } from 'react'
import { Calendar, MapPin, LogOut, User, Star, Clock, Plus, X, Users, TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Doctor, Appointment, PracticeLocation, PIN_CODES, SPECIALITIES } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { generateSlotsForDate, fetchOpenWindows, DAYS_OF_WEEK, AvailabilityTemplate, TimeSlot } from '../../lib/availability'
import { cancelAppointment, rescheduleAppointment, setAppointmentStatus } from '../../lib/appointmentApi'
import { isValidGstin, GST_STATE_NAMES } from '../../hooks/useTaxSettings'
import { StatTile, ColumnChart, BarList, RangePicker, Point } from '../../components/Charts'
import { headcountFor, marginalDoctorCost, describeHeadcount } from '../../../supabase/functions/_shared/headcount'

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
  // Appointment actions. Cancelling asks for a reason and rescheduling shows the
  // doctor's real open slots, so neither is a blind click.
  const [apptBusy, setApptBusy] = useState<string | null>(null)
  const [apptError, setApptError] = useState('')
  const [cancelling, setCancelling] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null)
  const [reschedDate, setReschedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [camps, setCamps] = useState<CampOffer[]>([])
  const [loading, setLoading] = useState(true)
  // Consolidated from 6 tabs to 3 — Today / Schedule / Clinic —
  // so a busy or less tech-savvy doctor sees one obvious default
  // (today's patients) instead of having to figure out which of
  // six tabs has what they need.
  const [tab, setTab] = useState<'today' | 'schedule' | 'clinic' | 'reports'>('today')

  // ── Reports ──
  interface ReportRow {
    day: string; times_listed: number; profile_views: number; whatsapp_clicks: number
    unique_visitors: number; bookings: number; completed: number; cancelled: number; no_show: number
  }
  const [reportDays, setReportDays] = useState(30)
  const [report, setReport] = useState<ReportRow[]>([])
  const [reportLoading, setReportLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'reports' || !doctor) return
    let cancelled = false
    setReportLoading(true)
    supabase.rpc('sehat_business_report', { p_doctor_id: doctor.id, p_days: reportDays })
      .then(({ data }) => {
        if (cancelled) return
        setReport((data as ReportRow[]) || [])
        setReportLoading(false)
      })
    return () => { cancelled = true }
  }, [tab, doctor, reportDays])

  const rTotal = (k: keyof ReportRow) => report.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  const dayLabel = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

  // GSTIN, editable by the clinic itself. doctors_update_own already permits a
  // signed-in clinic to update its own row, so this needs no new policy.
  // ── Hospital roster ──
  // Only present when this listing belongs to an organisation. A solo practice
  // never sees any of it.
  const [roster, setRoster] = useState<Doctor[]>([])
  const [rosterBusy, setRosterBusy] = useState(false)
  const [rosterErr, setRosterErr] = useState('')
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [docForm, setDocForm] = useState({ name: '', speciality: 'GEN', qualification: '', phone: '' })
  interface PlanTerms {
    doctor_billing: string
    monthly_price: number | null
    included_doctors: number
    extra_doctor_price: number
  }
  const [plan, setPlan] = useState<PlanTerms | null>(null)

  const loadRoster = async (orgId: string) => {
    const { data } = await supabase.from('doctors')
      .select('*').eq('organization_id', orgId).eq('is_hospital_doctor', true)
      .order('name')
    setRoster((data as Doctor[]) || [])
  }

  const addRosterDoctor = async () => {
    if (!doctor || !docForm.name.trim()) return
    setRosterBusy(true); setRosterErr('')
    const { error } = await supabase.rpc('sehat_org_add_doctor', {
      p_org_listing_id: doctor.id,
      p_name: docForm.name.trim(),
      p_speciality: docForm.speciality,
      p_qualification: docForm.qualification || null,
      p_phone: docForm.phone || null,
    })
    setRosterBusy(false)
    if (error) { setRosterErr(error.message); return }
    setDocForm({ name: '', speciality: 'GEN', qualification: '', phone: '' })
    setShowAddDoc(false)
    if (doctor.organization_id) await loadRoster(doctor.organization_id)
  }

  const setRosterStatus = async (id: string, status: 'suspended' | 'active') => {
    if (!doctor) return
    setRosterBusy(true); setRosterErr('')
    const { error } = await supabase.rpc('sehat_org_set_doctor_status', {
      p_doctor_id: id, p_status: status,
    })
    setRosterBusy(false)
    if (error) { setRosterErr(error.message); return }
    if (doctor.organization_id) await loadRoster(doctor.organization_id)
  }

  // Consultants that count towards the bill — suspended ones do not, which is
  // the whole reason removing one is worth doing promptly.
  const billableDoctors = roster.filter(d => d.status !== 'suspended').length
  // All of this comes from _shared/headcount.ts, which the pricing engine and
  // the signup wizard also use. Computing it here separately is what let this
  // panel go on quoting a superseded model.
  const hc = plan ? headcountFor(plan, billableDoctors) : null
  const marginalCost = plan ? marginalDoctorCost(plan, billableDoctors) : 0
  const headcountSentence = plan ? describeHeadcount(plan, billableDoctors) : null

  const [gstinDraft, setGstinDraft] = useState('')
  const [gstSaving, setGstSaving] = useState(false)
  const [gstMsg, setGstMsg] = useState('')
  useEffect(() => { setGstinDraft(doctor?.gstin ?? '') }, [doctor?.gstin])

  const saveGstin = async () => {
    if (!doctor) return
    setGstSaving(true); setGstMsg('')
    const value = gstinDraft.trim()
    const { error } = await supabase.from('doctors').update({
      gstin: value || null,
      // Derived, never typed separately — it is the first two digits by
      // definition, and letting them drift apart would misstate the tax split.
      state_code: value ? value.slice(0, 2) : null,
    }).eq('id', doctor.id)
    setGstSaving(false)
    setGstMsg(error ? `Could not save: ${error.message}` : 'Saved.')
    if (!error) setDoctor({ ...doctor, gstin: value || undefined })
    setTimeout(() => setGstMsg(''), 4000)
  }
  // ── Practice locations ──
  // A doctor may sit in several places. Hours and capacity are per location,
  // because "Mon-Wed Jagadhri, Thu-Sat Radaur" is the whole point.
  const [locations, setLocations] = useState<PracticeLocation[]>([])
  const [activeLoc, setActiveLoc] = useState<string>('')
  const [locForm, setLocForm] = useState({ name: '', address: '', pin_code: '', phone: '' })
  const [showAddLoc, setShowAddLoc] = useState(false)
  const [locBusy, setLocBusy] = useState(false)

  const loadLocations = async (doctorId: string) => {
    const { data } = await supabase.from('practice_locations')
      .select('*').eq('doctor_id', doctorId).eq('is_active', true)
      .order('is_primary', { ascending: false }).order('created_at')
    const rows = (data as PracticeLocation[]) || []
    setLocations(rows)
    setActiveLoc(cur => cur && rows.some(r => r.id === cur) ? cur : (rows[0]?.id ?? ''))
  }

  const addLocation = async () => {
    if (!doctor || !locForm.name.trim()) return
    setLocBusy(true)
    const { error } = await supabase.from('practice_locations').insert({
      doctor_id: doctor.id,
      name: locForm.name.trim(),
      address: locForm.address.trim() || null,
      pin_code: locForm.pin_code.trim() || null,
      phone: locForm.phone.trim() || null,
      // Never primary on creation: exactly one primary exists and it is the
      // fallback every un-located booking lands on. Promote deliberately.
      is_primary: false,
    })
    setLocBusy(false)
    if (!error) {
      setLocForm({ name: '', address: '', pin_code: '', phone: '' })
      setShowAddLoc(false)
      await loadLocations(doctor.id)
    }
  }

  const makePrimary = async (id: string) => {
    if (!doctor) return
    setLocBusy(true)
    // Clear first: a partial unique index allows only one primary, so setting
    // the new one before clearing the old would violate it.
    await supabase.from('practice_locations').update({ is_primary: false }).eq('doctor_id', doctor.id)
    await supabase.from('practice_locations').update({ is_primary: true }).eq('id', id)
    await loadLocations(doctor.id)
    setLocBusy(false)
  }

  const deactivateLocation = async (id: string) => {
    if (!doctor) return
    setLocBusy(true)
    await supabase.from('practice_locations').update({ is_active: false }).eq('id', id)
    await loadLocations(doctor.id)
    setLocBusy(false)
  }

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
        await loadLocations(doc.id)
        if (doc.organization_id) {
          await loadRoster(doc.organization_id)
          const { data: p } = await supabase.from('active_pricing_plan')
            .select('doctor_billing, monthly_price, included_doctors, extra_doctor_price').maybeSingle()
          if (p) setPlan(p as PlanTerms)
        }
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
  // Scoped to the location being edited — otherwise Monday at the branch would
  // silently show Monday at the main clinic.
  const getDayRow = (dow: number) =>
    availability.find(a => a.day_of_week === dow && (a.location_id ?? '') === activeLoc)

  const toggleWorkingDay = (dow: number) => {
    const existing = getDayRow(dow)
    if (existing) {
      setAvailability(prev => prev.filter(
        a => !(a.day_of_week === dow && (a.location_id ?? '') === activeLoc)))
    } else {
      setAvailability(prev => [...prev, {
        id: `new-${dow}-${activeLoc}`, doctor_id: doctor?.id || '', location_id: activeLoc,
        day_of_week: dow,
        // Hourly by default: patients are given a 12-1 window to arrive in
        // rather than a 15-minute appointment nobody can keep to.
        start_time: '10:00:00', end_time: '18:00:00',
        slot_duration_minutes: 60, slot_capacity: 4, is_active: true,
      }])
    }
  }

  const updateDayRow = (
    dow: number,
    field: 'start_time' | 'end_time' | 'slot_duration_minutes' | 'slot_capacity',
    value: string | number,
  ) => {
    setAvailability(prev => prev.map(a =>
      a.day_of_week === dow && (a.location_id ?? '') === activeLoc ? { ...a, [field]: value } : a))
  }

  const saveAvailability = async () => {
    if (!doctor) return
    setAvailSaving(true)
    // Delete-then-insert scoped to the location being edited. Unscoped, saving
    // the Radaur branch would delete the main clinic's hours, because the editor
    // only ever holds the rows for one location.
    await supabase.from('doctor_availability')
      .delete().eq('doctor_id', doctor.id).eq('location_id', activeLoc)

    const rows = availability.filter(a => (a.location_id ?? '') === activeLoc)
    if (rows.length > 0) {
      await supabase.from('doctor_availability').insert(
        rows.map(a => ({
          doctor_id: doctor.id,
          location_id: activeLoc || null,
          day_of_week: a.day_of_week,
          start_time: a.start_time,
          end_time: a.end_time,
          slot_duration_minutes: a.slot_duration_minutes,
          slot_capacity: a.slot_capacity ?? 4,
          is_active: true,
        }))
      )
    }
    await loadAvailability(doctor.id)
    setAvailSaving(false)
    setAvailSaved(true)
    setTimeout(() => setAvailSaved(false), 2000)
  }

  const reloadAppointments = async () => {
    if (!doctor) return
    const { data } = await supabase.from('appointments').select('*')
      .eq('doctor_id', doctor.id).order('created_at', { ascending: false }).limit(20)
    setAppointments(data || [])
  }

  // One wrapper so every action gets the same busy state, error surface and
  // refresh — and so a failure is shown rather than silently swallowed.
  const runApptAction = async (id: string, fn: () => Promise<void>) => {
    setApptBusy(id); setApptError('')
    try {
      await fn()
      await reloadAppointments()
      setCancelling(null); setRescheduling(null); setCancelReason('')
    } catch (e) {
      setApptError((e as Error).message)
    } finally {
      setApptBusy(null)
    }
  }

  // Open windows on the chosen day, from the server.
  //
  // sehat_open_windows is the same source the capacity trigger enforces against,
  // so a window offered here cannot be rejected on submit. The local generator
  // could only see this doctor's own loaded appointments and knew nothing about
  // locations, so it would have offered windows that were already full.
  const [reschedSlots, setReschedSlots] = useState<TimeSlot[]>([])
  useEffect(() => {
    if (!rescheduling || !doctor) { setReschedSlots([]); return }
    let cancelled = false
    fetchOpenWindows(doctor.id, new Date(reschedDate + 'T00:00:00')).then(w => {
      if (cancelled) return
      // Keep the window this appointment already sits on: it is "full" only
      // because of this booking, and hiding it makes a same-day location change
      // impossible.
      setReschedSlots(w.filter(sl => sl.available || sl.datetime === rescheduling.slot_datetime))
    })
    return () => { cancelled = true }
  }, [rescheduling, reschedDate, doctor])

  // Today's actual slots, minus already-booked ones — this is
  // now the FIRST thing a doctor sees, not buried in a 5th tab
  const todaysBookedTimes = appointments
    // A no-show frees nothing retroactively, but a cancelled slot is bookable
    // again — which is why cancel and no-show are separate outcomes.
    .filter(a => a.status !== 'cancelled')
    .map(a => a.slot_datetime)
  const todaysSlots = generateSlotsForDate(availability, new Date(), todaysBookedTimes)

  const roleLabel = (r: string) => r === 'receptionist' ? t('dashboardPage.roleReceptionist') : r === 'manager' ? t('dashboardPage.roleManager') : r === 'doctor' ? t('dashboardPage.roleDoctor') : r

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-400">{t('dashboardPage.loading')}</div></div>
  if (!doctor) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-400">
        {t('dashboardPage.noProfileFound')} <a href="/doctor" className="text-teal-600">{t('dashboardPage.registerHereLink')}</a>
      </div>
    </div>
  )

  const tabs = [
    { id: 'today', label: t('dashboardPage.tabToday'), icon: <Star className="w-4 h-4" /> },
    { id: 'schedule', label: t('dashboardPage.tabSchedule'), icon: <Clock className="w-4 h-4" /> },
    { id: 'clinic', label: t('dashboardPage.tabClinic'), icon: <Users className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports', icon: <TrendingUp className="w-4 h-4" /> },
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
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: t('dashboardPage.statTotalAppointments'), value: appointments.length, icon: <Calendar className="w-5 h-5 text-teal-500" /> },
            { label: t('dashboardPage.statThisMonth'), value: appointments.filter(a => new Date(a.created_at).getMonth() === new Date().getMonth()).length, icon: <Calendar className="w-5 h-5 text-teal-500" /> },
            { label: t('dashboardPage.statActiveAreas'), value: doctor.pin_codes?.length || 0, icon: <MapPin className="w-5 h-5 text-navy-600" /> },
            { label: t('dashboardPage.statStatus'), value: doctor.status === 'active' ? '✓' : '⏳', icon: <Star className="w-5 h-5 text-amber-500" /> },
          ].map(s => (
            <div key={s.label} className="card shadow-sm">
              <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-sm text-gray-500">{s.label}</span></div>
              <p className="text-2xl font-bold text-navy-700">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs — just 3 now, Today selected by default */}
        <div className="flex gap-1 bg-gray-200 rounded-xl p-1 mb-6 w-fit flex-wrap">
          {tabs.map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id as any)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition ${tab === tb.id ? 'bg-white text-navy-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {tb.icon} {tb.label}
            </button>
          ))}
        </div>

        {/* ══════════ TODAY (default) — today's slot grid + recent appointments ══════════ */}
        {tab === 'today' && (
          <div className="space-y-4">
            <div className="card shadow-sm">
              <h3 className="font-bold text-navy-700 mb-1">{t('dashboardPage.todaysScheduleTitle')}</h3>
              <p className="text-gray-500 text-sm mb-4">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              {todaysSlots.length === 0 ? (
                <p className="text-gray-400 text-sm">{t('dashboardPage.noSlotsToday')}</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {todaysSlots.map(s => (
                    <div key={s.datetime}
                      className={`text-center text-sm py-2.5 rounded-lg border ${s.available ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-gray-200 bg-gray-100 text-gray-400 line-through'}`}>
                      {s.time}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card shadow-sm">
              <h3 className="font-bold text-navy-700 mb-4">{t('dashboardPage.recentAppointments')}</h3>
              {appointments.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">{t('dashboardPage.noAppointmentsYet')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {apptError && (
                    <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{apptError}</div>
                  )}
                  {appointments.map(a => {
                    const open = a.status === 'booked' || a.status === 'confirmed'
                    const busy = apptBusy === a.id
                    return (
                      <div key={a.id} className="p-3 bg-gray-50 rounded-xl">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <p className="font-medium text-gray-800 text-sm">{a.patient_name}</p>
                            <p className="text-sm text-gray-400">
                              {t('dashboardPage.ageLabel')} {a.patient_age} · {new Date(a.slot_datetime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                            {/* The original time matters: a patient may still be
                                holding a reminder for it. */}
                            {a.previous_slot_datetime && (
                              <p className="text-xs text-amber-600 mt-0.5">
                                Moved from {new Date(a.previous_slot_datetime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                              </p>
                            )}
                            {a.status === 'cancelled' && a.cancelled_by && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                Cancelled by {a.cancelled_by === 'patient' ? 'the patient' : a.cancelled_by}
                                {a.cancel_reason ? ` — ${a.cancel_reason}` : ''}
                              </p>
                            )}
                          </div>
                          <span className={a.status === 'completed' ? 'badge-active'
                            : (a.status === 'cancelled' || a.status === 'no_show') ? 'badge-suspended'
                            : 'badge-pending'}>{a.status === 'no_show' ? 'no show' : a.status}</span>
                        </div>

                        {open && (
                          <div className="flex gap-1.5 mt-3 flex-wrap">
                            {a.status === 'booked' && (
                              <button disabled={busy}
                                onClick={() => runApptAction(a.id, () => setAppointmentStatus(a.id, 'confirmed'))}
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 disabled:opacity-50">
                                Confirm
                              </button>
                            )}
                            <button disabled={busy}
                              onClick={() => { setRescheduling(a); setApptError('') }}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">
                              Reschedule
                            </button>
                            <button disabled={busy}
                              onClick={() => runApptAction(a.id, () => setAppointmentStatus(a.id, 'completed'))}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">
                              Completed
                            </button>
                            <button disabled={busy}
                              onClick={() => runApptAction(a.id, () => setAppointmentStatus(a.id, 'no_show'))}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">
                              No show
                            </button>
                            <button disabled={busy}
                              onClick={() => { setCancelling(a); setCancelReason(''); setApptError('') }}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50">
                              Cancel
                            </button>
                            {busy && <span className="text-xs text-gray-400 self-center">working…</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════ SCHEDULE — areas info + weekly availability template ══════════ */}
        {tab === 'schedule' && (
          <div className="space-y-4">
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
                      <p className="text-sm text-gray-500">{pin?.area || code}</p>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 bg-navy-50 border border-navy-100 rounded-xl p-4">
                <p className="text-sm text-navy-700">{t('dashboardPage.contactAdminNote')}</p>
              </div>
            </div>

            {/* Where you sit. Hours below are set per location. */}
            <div className="card shadow-sm">
              <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                <h3 className="font-bold text-navy-700">Your locations</h3>
                {!showAddLoc && (
                  <button onClick={() => setShowAddLoc(true)} className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> Add location
                  </button>
                )}
              </div>
              <p className="text-gray-500 text-sm mb-4">
                If you sit at more than one clinic, add each one here. Patients are told which building to
                come to, and you set separate hours for each below. There is no extra charge for a second
                location.
              </p>

              {showAddLoc && (
                <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input className="input-field text-sm" placeholder="Name, e.g. Radaur branch"
                      value={locForm.name} onChange={e => setLocForm(f => ({ ...f, name: e.target.value }))} />
                    <input className="input-field text-sm" placeholder="Phone at this clinic (optional)"
                      value={locForm.phone} onChange={e => setLocForm(f => ({ ...f, phone: e.target.value }))} />
                    <input className="input-field text-sm sm:col-span-2" placeholder="Full address"
                      value={locForm.address} onChange={e => setLocForm(f => ({ ...f, address: e.target.value }))} />
                    <input className="input-field text-sm" placeholder="PIN code"
                      value={locForm.pin_code} onChange={e => setLocForm(f => ({ ...f, pin_code: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={addLocation} disabled={locBusy || !locForm.name.trim()}
                      className="btn-teal text-sm py-2 px-5 disabled:opacity-50">
                      {locBusy ? 'Saving…' : 'Add'}
                    </button>
                    <button onClick={() => setShowAddLoc(false)}
                      className="text-sm text-gray-500 px-4">Cancel</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {locations.map(l => (
                  <div key={l.id} className="flex items-center gap-3 flex-wrap border border-gray-100 rounded-xl p-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-navy-700 flex items-center gap-2">
                        {l.name}
                        {l.is_primary && (
                          <span className="text-[10px] font-bold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded">MAIN</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {[l.address, l.pin_code].filter(Boolean).join(', ') || 'No address yet'}
                        {l.phone ? ` · ${l.phone}` : ''}
                      </div>
                    </div>
                    {!l.is_primary && (
                      <>
                        <button onClick={() => makePrimary(l.id)} disabled={locBusy}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50">
                          Make main
                        </button>
                        <button onClick={() => deactivateLocation(l.id)} disabled={locBusy}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 disabled:opacity-50">
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {/* The main location is where any booking that does not name one
                  lands, so it cannot be removed — only replaced. */}
              <p className="text-xs text-gray-400 mt-3">
                Your main location receives any booking that does not name a clinic. Make another one main
                first if you want to remove it.
              </p>
            </div>

            <div className="card shadow-sm">
              <h3 className="font-bold text-navy-700 mb-1">{t('dashboardPage.availabilityHeading')}</h3>
              <p className="text-gray-500 text-sm mb-4">{t('dashboardPage.availabilityDesc')}</p>

              {locations.length > 1 && (
                <div className="flex gap-2 flex-wrap mb-4">
                  {locations.map(l => (
                    <button key={l.id} onClick={() => setActiveLoc(l.id)}
                      className={`text-sm font-semibold px-4 py-2 rounded-xl transition ${
                        activeLoc === l.id ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="bg-navy-50 border border-navy-100 rounded-xl p-3 mb-4 text-sm text-navy-700">
                Patients book an <strong>hourly window</strong> — 12–1, 1–2 and so on — not an exact minute.
                Set how many patients you can see in one hour and we will stop taking bookings once that
                hour is full.
              </div>

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
                              {[30, 60, 120].map(m => (
                                <option key={m} value={m}>
                                  {m === 60 ? 'Hourly windows' : m === 120 ? '2-hour windows' : 'Half-hourly'}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-center gap-1.5 text-sm text-gray-600">
                              <input type="number" min={1} max={200}
                                className="input-field w-16 text-sm py-1.5"
                                value={row.slot_capacity ?? 4}
                                onChange={e => updateDayRow(day.value, 'slot_capacity', parseInt(e.target.value) || 1)} />
                              patients per window
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center gap-3">
                <button onClick={saveAvailability} disabled={availSaving} className="btn-teal text-sm px-6 disabled:opacity-60">
                  {t('dashboardPage.saveAvailabilityButton')}
                </button>
                {availSaved && <span className="text-teal-600 text-sm font-medium">{t('dashboardPage.availabilitySaved')}</span>}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ CLINIC — staff management + camps & offers ══════════ */}
        {tab === 'reports' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-bold text-navy-700">How your listing is doing</h2>
                <p className="text-sm text-gray-500">
                  What patients did on Sehatsandhi, and what came of it.
                </p>
              </div>
              <RangePicker value={reportDays} onChange={setReportDays} />
            </div>

            {reportLoading ? (
              <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatTile label="Times you appeared" value={rTotal('times_listed')}
                    sub="in patient searches" />
                  <StatTile label="Profile opened" value={rTotal('profile_views')} />
                  <StatTile label="WhatsApp taps" value={rTotal('whatsapp_clicks')} />
                  <StatTile label="Appointments booked" value={rTotal('bookings')} />
                </div>

                <div className="card shadow-sm">
                  {/* Ordered stages, so the drop between two of them is the
                      finding — "seen 240 times, opened 12" is what tells a clinic
                      the photo is the problem, not the price. */}
                  <BarList
                    title="From search to appointment"
                    data={[
                      { label: 'Appeared in a search', value: rTotal('times_listed') },
                      { label: 'Profile opened', value: rTotal('profile_views') },
                      { label: 'Tapped WhatsApp', value: rTotal('whatsapp_clicks') },
                      { label: 'Booked an appointment', value: rTotal('bookings') },
                    ] as Point[]} />
                  {rTotal('times_listed') > 0 && (
                    <p className="text-xs text-gray-500 mt-4">
                      {rTotal('profile_views') === 0
                        ? 'Patients are seeing you in results but not opening your profile. A photo and clear timings usually fix that.'
                        : `${Math.round((rTotal('profile_views') / rTotal('times_listed')) * 100)}% of the patients who saw you opened your profile.`}
                    </p>
                  )}
                </div>

                <div className="card shadow-sm">
                  <ColumnChart title="Profile opens per day" height={140}
                    data={report.map(r => ({ label: dayLabel(r.day), value: r.profile_views }))} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="card shadow-sm">
                    <ColumnChart title="Appointments booked per day" height={120}
                      data={report.map(r => ({ label: dayLabel(r.day), value: r.bookings }))} />
                  </div>
                  <div className="card shadow-sm">
                    <BarList title="What happened to those appointments"
                      data={[
                        { label: 'Completed', value: rTotal('completed') },
                        { label: 'Cancelled', value: rTotal('cancelled') },
                        { label: 'Did not turn up', value: rTotal('no_show') },
                      ] as Point[]}
                      alertWhen={d => d.label === 'Did not turn up' && d.value > 0} />
                    {rTotal('no_show') > 0 && (
                      <p className="text-xs text-gray-500 mt-4">
                        {rTotal('no_show')} patient{rTotal('no_show') === 1 ? '' : 's'} did not turn up.
                        A reminder the evening before is the usual remedy.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'clinic' && (
          <div className="space-y-4">
            {/* Consultants. Only for a hospital — a solo practice never sees this. */}
            {doctor.organization_id && (
              <div className="card shadow-sm">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                  <h3 className="font-bold text-navy-700">Your doctors</h3>
                  {!showAddDoc && (
                    <button onClick={() => setShowAddDoc(true)} className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                      <Plus className="w-4 h-4" /> Add doctor
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  Each doctor gets their own profile and appointment calendar. A new one is checked by our
                  team before going live, the same as any listing.
                </p>

                {/* What the roster costs, stated where it is changed rather than
                    discovered on the next invoice. */}
                {hc?.billsHeadcount && headcountSentence && (
                  <div className="bg-navy-50 border border-navy-100 rounded-xl p-3 mb-4 text-sm text-navy-700">
                    <strong>{billableDoctors}</strong> doctor{billableDoctors === 1 ? '' : 's'} on your bill.
                    {' '}{headcountSentence}
                    {' '}A change takes effect from your next renewal, not mid-term.
                  </div>
                )}

                {rosterErr && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3 mb-3">{rosterErr}</div>}

                {showAddDoc && (
                  <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input className="input-field text-sm" placeholder="Doctor's name"
                        value={docForm.name} onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))} />
                      <select className="input-field text-sm" value={docForm.speciality}
                        onChange={e => setDocForm(f => ({ ...f, speciality: e.target.value }))}>
                        {SPECIALITIES.map(sp => <option key={sp.id} value={sp.id}>{sp.en}</option>)}
                      </select>
                      <input className="input-field text-sm" placeholder="Qualification, e.g. MD"
                        value={docForm.qualification} onChange={e => setDocForm(f => ({ ...f, qualification: e.target.value }))} />
                      <input className="input-field text-sm" placeholder="Phone (optional)"
                        value={docForm.phone} onChange={e => setDocForm(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    {marginalCost > 0 && (
                      <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
                        Adding this doctor takes you to {billableDoctors + 1}, which adds
                        ₹{marginalCost.toLocaleString('en-IN')}/month from your next renewal.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={addRosterDoctor} disabled={rosterBusy || !docForm.name.trim()}
                        className="btn-teal text-sm py-2 px-5 disabled:opacity-50">
                        {rosterBusy ? 'Adding…' : 'Add'}
                      </button>
                      <button onClick={() => { setShowAddDoc(false); setRosterErr('') }}
                        className="text-sm text-gray-500 px-4">Cancel</button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {roster.length === 0 && (
                    <p className="text-sm text-gray-400 py-2">No doctors added yet.</p>
                  )}
                  {roster.map(d => {
                    const suspended = d.status === 'suspended'
                    return (
                      <div key={d.id} className={`flex items-center gap-3 flex-wrap border rounded-xl p-3 ${suspended ? 'border-gray-100 bg-gray-50 opacity-70' : 'border-gray-100'}`}>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-navy-700 flex items-center gap-2 flex-wrap">
                            {d.name}
                            {d.status === 'pending' && (
                              <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">AWAITING APPROVAL</span>
                            )}
                            {suspended && (
                              <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">REMOVED</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {SPECIALITIES.find(sp => sp.id === d.speciality)?.en ?? d.speciality}
                            {d.qualification ? ` · ${d.qualification}` : ''}
                            {suspended ? ' · not on your bill' : ''}
                          </div>
                        </div>
                        <button disabled={rosterBusy}
                          onClick={() => setRosterStatus(d.id, suspended ? 'active' : 'suspended')}
                          className={`text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 ${
                            suspended ? 'bg-teal-50 hover:bg-teal-100 text-teal-700'
                                      : 'bg-red-50 hover:bg-red-100 text-red-500'}`}>
                          {suspended ? 'Bring back' : 'Remove'}
                        </button>
                      </div>
                    )
                  })}
                </div>
                {/* Removing is reversible and keeps history — worth saying, or a
                    clinic will hesitate to remove someone who has left. */}
                <p className="text-xs text-gray-400 mt-3">
                  Removing a doctor takes them off the site and off your bill, and keeps their past
                  appointments. You can bring them back at any time.
                </p>
              </div>
            )}

            {/* GST number — added here as well as in signup, because a business
                often registers for GST after joining, and without this their
                only route to a claimable invoice would be asking us to edit the
                database. Applies to invoices issued from now on; ones already
                issued cannot be altered. */}
            <div className="card shadow-sm">
              <h3 className="font-bold text-navy-700 mb-1">GST number</h3>
              <p className="text-sm text-gray-500 mb-3">
                Optional. Add your GSTIN and we will print it on your tax invoices, so you can claim the
                18% GST back as input credit. Invoices already issued are not changed — this applies to
                your next renewal onwards.
              </p>
              <div className="flex gap-2 flex-wrap items-start">
                <div>
                  <input className="input-field font-mono tracking-wide uppercase max-w-xs"
                    maxLength={15} placeholder="22AAAAA0000A1Z5"
                    value={gstinDraft}
                    onChange={e => setGstinDraft(e.target.value.toUpperCase().replace(/\s/g, ''))} />
                  {gstinDraft.length === 15 && (
                    <p className={`text-xs mt-1 font-semibold ${isValidGstin(gstinDraft) ? 'text-teal-600' : 'text-red-500'}`}>
                      {isValidGstin(gstinDraft)
                        ? `✓ Valid${GST_STATE_NAMES[gstinDraft.slice(0, 2)] ? ` · registered in ${GST_STATE_NAMES[gstinDraft.slice(0, 2)]}` : ''}`
                        : 'That does not look like a valid GSTIN — please check your certificate.'}
                    </p>
                  )}
                </div>
                <button
                  disabled={gstSaving || (gstinDraft !== '' && !isValidGstin(gstinDraft)) || gstinDraft === (doctor?.gstin ?? '')}
                  onClick={saveGstin}
                  className="btn-teal text-sm py-2 px-5 disabled:opacity-50">
                  {gstSaving ? 'Saving…' : 'Save'}
                </button>
                {gstMsg && <span className="text-sm text-teal-600 self-center">{gstMsg}</span>}
              </div>
            </div>

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
                      <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.staffNameLabel')}</label>
                      <input className="input-field" placeholder="Sunita Devi"
                        value={staffForm.full_name} onChange={e => setStaffForm(f => ({ ...f, full_name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.staffWhatsappLabel')}</label>
                      <input className="input-field" type="tel" maxLength={10} placeholder="9876543210"
                        value={staffForm.whatsapp_number} onChange={e => setStaffForm(f => ({ ...f, whatsapp_number: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.staffRoleLabel')}</label>
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
                        <p className="text-sm text-gray-400">{roleLabel(m.role)} · {m.whatsapp_number}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={m.is_active ? 'badge-active' : 'badge-suspended'}>
                          {m.is_active ? t('dashboardPage.staffActive') : t('dashboardPage.staffInactive')}
                        </span>
                        <button onClick={() => toggleStaffActive(m)}
                          className="text-sm text-gray-400 hover:text-teal-600 underline">
                          {m.is_active ? t('dashboardPage.staffDeactivate') : t('dashboardPage.staffReactivate')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 bg-teal-50 border border-teal-100 rounded-xl p-3">
                <p className="text-sm text-teal-700">💡 {t('dashboardPage.staffNote')}</p>
              </div>
            </div>

            <div className="card shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-navy-700">{t('dashboardPage.campsHeading')}</h3>
                {!showAddCamp && (
                  <button onClick={() => setShowAddCamp(true)} className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> {t('dashboardPage.addCampButton')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-sm text-gray-500">{t('dashboardPage.campQuotaFreeNote')}</p>
                  <p className="text-lg font-bold text-navy-700">{freeCampsThisQuarter}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-sm text-gray-500">{t('dashboardPage.campQuotaOfferNote')}</p>
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
                    <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.campTypeLabel')}</label>
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
                    <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.campTitleLabel')}</label>
                    <input className="input-field" placeholder="Free Skin Checkup Camp"
                      value={campForm.title} onChange={e => setCampForm(f => ({ ...f, title: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.campDescLabel')}</label>
                    <textarea className="input-field" rows={2}
                      value={campForm.description} onChange={e => setCampForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.campServicesLabel')}</label>
                    <input className="input-field" placeholder="Free BP check, sugar test, eye screening"
                      value={campForm.services_offered} onChange={e => setCampForm(f => ({ ...f, services_offered: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.campDateFromLabel')}</label>
                      <input className="input-field" type="date" value={campForm.date_from} onChange={e => setCampForm(f => ({ ...f, date_from: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.campDateToLabel')}</label>
                      <input className="input-field" type="date" value={campForm.date_to} onChange={e => setCampForm(f => ({ ...f, date_to: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600 mb-1 block">{t('dashboardPage.campTimeLabel')}</label>
                    <input className="input-field" placeholder="10am-1pm"
                      value={campForm.time_slot} onChange={e => setCampForm(f => ({ ...f, time_slot: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600 mb-2 block">{t('dashboardPage.campAreasLabel')}</label>
                    <div className="flex flex-wrap gap-2">
                      {(doctor?.pin_codes || []).map(code => {
                        const pin = PIN_CODES.find(p => p.code === code)
                        return (
                          <button key={code} type="button" onClick={() => toggleCampArea(code)}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${campForm.pin_codes.includes(code) ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-300 text-gray-500 hover:border-teal-400'}`}>
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
                        <p className="text-sm text-gray-400">
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
          </div>
        )}
      </div>

      {/* Cancel — a reason is worth capturing: it goes to the patient verbatim
          and is the difference between "cancelled" and an explanation. */}
      {cancelling && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
             onClick={() => setCancelling(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-navy-700 mb-1">Cancel this appointment?</h3>
            <p className="text-sm text-gray-500 mb-4">
              {cancelling.patient_name} · {new Date(cancelling.slot_datetime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Reason (sent to the patient)</label>
            <textarea className="input-field text-sm mb-2" rows={2} autoFocus
              placeholder="e.g. Doctor unavailable that morning"
              value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
            <p className="text-xs text-gray-400 mb-4">
              The patient is told on WhatsApp straight away, and the slot becomes bookable again.
            </p>
            {apptError && <p className="text-red-500 text-sm mb-3">{apptError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCancelling(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Keep it</button>
              <button disabled={apptBusy === cancelling.id}
                onClick={() => runApptAction(cancelling.id, () => cancelAppointment(cancelling.id, cancelReason, 'clinic', doctor?.name))}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">
                {apptBusy === cancelling.id ? 'Cancelling…' : 'Cancel appointment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule — offers only genuinely open slots from this doctor's own
          availability, so a clash is impossible to pick by hand. */}
      {rescheduling && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
             onClick={() => setRescheduling(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-navy-700 mb-1">Move this appointment</h3>
            <p className="text-sm text-gray-500 mb-4">
              {rescheduling.patient_name} · currently {new Date(rescheduling.slot_datetime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <label className="text-xs font-medium text-gray-600 mb-1 block">New date</label>
            <input type="date" className="input-field text-sm mb-4"
              value={reschedDate} min={new Date().toISOString().slice(0, 10)}
              onChange={e => setReschedDate(e.target.value)} />

            {reschedSlots.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                No open slots that day — check your weekly availability under Schedule.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto">
                {reschedSlots.map(sl => (
                  <button key={sl.datetime} disabled={apptBusy === rescheduling.id}
                    onClick={() => runApptAction(rescheduling.id,
                      () => rescheduleAppointment(rescheduling.id, sl.datetime, undefined, 'clinic', doctor?.name))}
                    className="text-xs font-semibold px-2 py-2 rounded-lg border-2 border-gray-200 hover:border-teal-400 hover:bg-teal-50 disabled:opacity-50">
                    {sl.time}
                    {/* Seats left, so a nearly-full window is visible before
                        moving a patient into it. */}
                    {sl.seatsLeft != null && (
                      <span className="block text-[10px] font-normal text-gray-400">
                        {sl.seatsLeft} left
                      </span>
                    )}
                    {sl.locationName && reschedSlots.some(o => o.locationName !== sl.locationName) && (
                      <span className="block text-[10px] font-normal text-teal-600">{sl.locationName}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-4">
              The patient gets the new time on WhatsApp immediately.
            </p>
            {apptError && <p className="text-red-500 text-sm mt-2">{apptError}</p>}
            <div className="flex justify-end mt-4">
              <button onClick={() => setRescheduling(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Close</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
