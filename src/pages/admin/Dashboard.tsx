import { useEffect, useState, Fragment } from 'react'
import { CheckCircle2, XCircle, LogOut, Users, Clock, TrendingUp, Building2, Plus, Trash2, ChevronLeft, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Doctor, SPECIALITIES, PIN_CODES } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import LanguageSwitcher from '../../components/LanguageSwitcher'

// Local type extension — organization_id / is_hospital_doctor were
// added to the doctors table via ALTER TABLE, but the shared Doctor
// type in types/index.ts hasn't necessarily been updated everywhere.
// Same safe pattern already used in SpecialityLanding.tsx / Profile.tsx.
interface DoctorWithOrg extends Doctor {
  organization_id?: string | null
  is_hospital_doctor?: boolean
  verification_notes?: string | null
}

// Qualifications actually covered by NMC's Indian Medical
// Register — dental/homeopathy/ayurveda have their own
// separate councils, so the NMC link isn't relevant for them
const NMC_QUALIFICATIONS = ['MBBS', 'MD', 'MS', 'DNB', 'DM', 'MCh']

interface CampOfferRow {
  id: string
  doctor_id: string
  camp_type: 'free_camp' | 'special_offer'
  title: string
  date_from: string
  date_to: string
  pin_codes: string[]
  status: string
  doctors: { name: string; clinic_name: string } | null
}

interface Organization {
  id: string
  name: string
  type: string
  registration_number: string | null
  address: string | null
  phone: string | null
  email: string | null
  status: string
  created_at: string
}

interface OrgSpeciality {
  id: string
  organization_id: string
  speciality: string
  is_active: boolean
}

interface OrgSubscription {
  id: string
  organization_id: string
  speciality: string
  pin_code: string
  monthly_price: number | null
  status: string
}

export default function AdminDashboard() {
  const { t } = useLanguage()
  const [doctors, setDoctors] = useState<DoctorWithOrg[]>([])
  const [camps, setCamps] = useState<CampOfferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'all' | 'camps' | 'orgs'>('pending')
  const [search, setSearch] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [expandedDoctorId, setExpandedDoctorId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesSavedId, setNotesSavedId] = useState<string | null>(null)
  const [rejectModal, setRejectModal] = useState<{ type: 'doctor' | 'camp'; id: string; name: string } | null>(null)
  const [rejectReasonInput, setRejectReasonInput] = useState('')

  // ── Organizations state ──
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [orgSpecialities, setOrgSpecialities] = useState<OrgSpeciality[]>([])
  const [orgSubscriptions, setOrgSubscriptions] = useState<OrgSubscription[]>([])
  const [showAddOrg, setShowAddOrg] = useState(false)
  const [orgForm, setOrgForm] = useState({ name: '', type: 'hospital', registration_number: '', address: '', phone: '', email: '' })
  const [subForm, setSubForm] = useState({ speciality: '', pin_code: '', monthly_price: '' })
  const [doctorSearch, setDoctorSearch] = useState('')

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('doctors').select('*').order('created_at', { ascending: false })
    setDoctors((data as DoctorWithOrg[]) || [])
    const { data: campData } = await supabase
      .from('camps_offers')
      .select('*, doctors(name, clinic_name)')
      .order('created_at', { ascending: false })
    setCamps((campData as any) || [])
    const { data: orgData } = await supabase.from('organizations').select('*').order('created_at', { ascending: false })
    setOrganizations(orgData || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const loadOrgDetail = async (orgId: string) => {
    const { data: specs } = await supabase.from('org_specialities').select('*').eq('organization_id', orgId).eq('is_active', true)
    setOrgSpecialities(specs || [])
    const { data: subs } = await supabase.from('org_subscriptions').select('*').eq('organization_id', orgId)
    setOrgSubscriptions(subs || [])
  }

  const openOrgDetail = (orgId: string) => {
    setSelectedOrgId(orgId)
    loadOrgDetail(orgId)
  }

  const approve = async (id: string, name: string) => {
    const { error } = await supabase.from('doctors').update({ status: 'active' }).eq('id', id)
    if (!error) { setActionMsg(`✓ ${name} ${t('adminDashboardPage.approvedMsgSuffix')}`); load(); setTimeout(() => setActionMsg(''), 3000) }
  }

  const openRejectModal = (type: 'doctor' | 'camp', id: string, name: string) => {
    setRejectModal({ type, id, name })
    setRejectReasonInput('')
  }

  const confirmReject = async () => {
    if (!rejectModal || !rejectReasonInput.trim()) return
    if (rejectModal.type === 'doctor') {
      await supabase.from('doctors').update({ status: 'suspended' }).eq('id', rejectModal.id)
      setActionMsg(`✗ ${rejectModal.name} ${t('adminDashboardPage.rejectedMsgSuffix')}`)
    } else {
      await supabase.from('camps_offers').update({
        status: 'rejected', admin_notes: rejectReasonInput, reviewed_by: 'admin', reviewed_at: new Date().toISOString(),
      }).eq('id', rejectModal.id)
      setActionMsg(`✗ "${rejectModal.name}" ${t('adminDashboardPage.campRejectedMsg')}`)
    }
    setRejectModal(null)
    load()
    setTimeout(() => setActionMsg(''), 3000)
  }

  const toggleVerify = (doctor: DoctorWithOrg) => {
    if (expandedDoctorId === doctor.id) {
      setExpandedDoctorId(null)
    } else {
      setExpandedDoctorId(doctor.id)
      setNotesDraft(doctor.verification_notes || '')
    }
  }

  const saveVerificationNotes = async (id: string) => {
    await supabase.from('doctors').update({ verification_notes: notesDraft }).eq('id', id)
    setNotesSavedId(id)
    load()
    setTimeout(() => setNotesSavedId(null), 2000)
  }

  const approveCamp = async (id: string, title: string) => {
    await supabase.from('camps_offers').update({
      status: 'approved', reviewed_by: 'admin', reviewed_at: new Date().toISOString(),
    }).eq('id', id)
    setActionMsg(`✓ "${title}" ${t('adminDashboardPage.campApprovedMsg')}`); load(); setTimeout(() => setActionMsg(''), 3000)
  }

  // ── Organization actions ──
  const createOrg = async () => {
    if (!orgForm.name) return
    await supabase.from('organizations').insert({ ...orgForm, status: 'pending' })
    setOrgForm({ name: '', type: 'hospital', registration_number: '', address: '', phone: '', email: '' })
    setShowAddOrg(false)
    load()
  }

  const approveOrg = async (id: string) => {
    await supabase.from('organizations').update({ status: 'active' }).eq('id', id)
    load()
  }

  const suspendOrg = async (id: string) => {
    await supabase.from('organizations').update({ status: 'suspended' }).eq('id', id)
    load()
  }

  const toggleOrgSpeciality = async (specId: string) => {
    if (!selectedOrgId) return
    const existing = orgSpecialities.find(s => s.speciality === specId)
    if (existing) {
      await supabase.from('org_specialities').delete().eq('id', existing.id)
    } else {
      await supabase.from('org_specialities').insert({ organization_id: selectedOrgId, speciality: specId, is_active: true })
    }
    loadOrgDetail(selectedOrgId)
  }

  const addSubscription = async () => {
    if (!selectedOrgId || !subForm.speciality || !subForm.pin_code) return
    await supabase.from('org_subscriptions').insert({
      organization_id: selectedOrgId,
      speciality: subForm.speciality,
      pin_code: subForm.pin_code,
      monthly_price: parseInt(subForm.monthly_price) || null,
      status: 'active',
    })
    setSubForm({ speciality: '', pin_code: '', monthly_price: '' })
    loadOrgDetail(selectedOrgId)
  }

  const removeSubscription = async (id: string) => {
    await supabase.from('org_subscriptions').delete().eq('id', id)
    if (selectedOrgId) loadOrgDetail(selectedOrgId)
  }

  const linkDoctor = async (doctorId: string) => {
    if (!selectedOrgId) return
    await supabase.from('doctors').update({ organization_id: selectedOrgId, is_hospital_doctor: true }).eq('id', doctorId)
    load()
  }

  const unlinkDoctor = async (doctorId: string) => {
    await supabase.from('doctors').update({ organization_id: null, is_hospital_doctor: false }).eq('id', doctorId)
    load()
  }

  const logout = () => { sessionStorage.removeItem('admin_auth'); window.location.href = '/ng-ctrl-2026' }

  const pending = doctors.filter(d => d.status === 'pending')
  const active  = doctors.filter(d => d.status === 'active')
  const pendingCamps = camps.filter(c => c.status === 'pending_approval')
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const newThisWeek = doctors.filter(d => new Date(d.created_at) >= oneWeekAgo).length
  const filtered = doctors.filter(d => {
    const matchTab = tab === 'pending' ? d.status === 'pending' : true
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.phone.includes(search)
    return matchTab && matchSearch
  })

  const selectedOrg = organizations.find(o => o.id === selectedOrgId)
  const orgLinkedDoctors = doctors.filter(d => d.organization_id === selectedOrgId)
  const unlinkedMatches = doctorSearch.length >= 2
    ? doctors.filter(d => !d.organization_id && d.name.toLowerCase().includes(doctorSearch.toLowerCase()))
    : []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-56 bg-navy-700 min-h-screen fixed left-0 top-0 flex flex-col pt-6">
          <div className="px-5 mb-4">
            <img src="/logo.png" alt="Sehatsandhi" className="h-10 brightness-0 invert" />
            <p className="text-white/40 text-xs mt-2">{t('adminDashboardPage.sidebarLabel')}</p>
          </div>
          <div className="px-5 mb-4">
            <LanguageSwitcher dark />
          </div>
          <nav className="flex-1 px-3 space-y-1">
            {[
              { id: 'pending', label: t('adminDashboardPage.navPendingPrefix'), count: pending.length, badge: pending.length > 0 },
              { id: 'all', label: t('adminDashboardPage.navAllDoctors'), count: 0, badge: false },
              { id: 'camps', label: t('adminDashboardPage.navCamps'), count: pendingCamps.length, badge: pendingCamps.length > 0 },
              { id: 'orgs', label: t('adminDashboardPage.navOrgs'), count: 0, badge: false },
            ].map(n => (
              <button key={n.id} onClick={() => { setTab(n.id as any); setSelectedOrgId(null) }}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition flex items-center justify-between ${tab === n.id ? 'bg-teal-600 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>
                {n.label}
                {n.badge && <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">{n.count}</span>}
              </button>
            ))}
          </nav>
          <button onClick={logout} className="flex items-center gap-2 px-5 py-4 text-white/40 hover:text-white text-sm transition border-t border-white/10 mt-auto">
            <LogOut className="w-4 h-4" /> {t('adminDashboardPage.logout')}
          </button>
        </aside>

        {/* Main content */}
        <main className="ml-56 flex-1 p-8">
          {/* Stats — no fake revenue calculation */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: t('adminDashboardPage.statTotalDoctors'), value: doctors.length, icon: <Users className="w-5 h-5 text-navy-600" /> },
              { label: t('adminDashboardPage.statPendingApproval'), value: pending.length, icon: <Clock className="w-5 h-5 text-amber-500" />, warn: pending.length > 0 },
              { label: t('adminDashboardPage.statActiveListed'), value: active.length, icon: <CheckCircle2 className="w-5 h-5 text-teal-500" /> },
              { label: t('adminDashboardPage.statNewThisWeek'), value: newThisWeek, icon: <TrendingUp className="w-5 h-5 text-teal-500" /> },
            ].map(s => (
              <div key={s.label} className={`card shadow-sm ${s.warn ? 'border-2 border-amber-300' : ''}`}>
                <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-gray-500">{s.label}</span></div>
                <p className="text-2xl font-bold text-navy-700">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Action message */}
          {actionMsg && <div className="mb-4 bg-teal-50 border border-teal-200 text-teal-700 px-4 py-3 rounded-xl text-sm">{actionMsg}</div>}

          {/* Doctors table */}
          {(tab === 'pending' || tab === 'all') && (
          <div className="card shadow-sm">
            <div className="flex items-center gap-4 mb-5">
              <h2 className="font-bold text-navy-700 text-lg flex-1">
                {tab === 'pending' ? t('adminDashboardPage.headingPending') : t('adminDashboardPage.headingAll')}
              </h2>
              <input className="input-field w-56" placeholder={t('adminDashboardPage.searchPlaceholder')}
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {loading ? <p className="text-gray-400 text-sm py-8 text-center">{t('adminDashboardPage.loadingText')}</p> :
              filtered.length === 0 ? <p className="text-gray-400 text-sm py-12 text-center">{t('adminDashboardPage.noDoctorsFound')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 text-gray-400 text-xs">
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colDoctor')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colSpeciality')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colRegNo')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colAreas')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colRegistered')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colStatus')}</th>
                    <th className="py-3 px-2">{t('adminDashboardPage.colActions')}</th>
                  </tr></thead>
                  <tbody>{filtered.map(d => (
                    <Fragment key={d.id}>
                    <tr className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="py-3 px-2">
                        <p className="font-medium text-gray-800">{d.name} {d.is_hospital_doctor && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded ml-1">🏨</span>}</p>
                        <p className="text-xs text-gray-400">{d.qualification} · {d.phone}</p>
                      </td>
                      <td className="py-3 px-2 text-gray-600">{d.speciality}</td>
                      <td className="py-3 px-2">
                        <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{d.reg_number}</span>
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-xs text-gray-600">{d.pin_codes?.join(', ')}</span>
                      </td>
                      <td className="py-3 px-2 text-xs text-gray-500">
                        {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="py-3 px-2">
                        <span className={d.status === 'active' ? 'badge-active' : d.status === 'suspended' ? 'badge-suspended' : 'badge-pending'}>
                          {d.status}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex gap-1 justify-center flex-wrap">
                          <button onClick={() => toggleVerify(d)}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition ${expandedDoctorId === d.id ? 'bg-navy-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'}`}>
                            <Search className="w-3.5 h-3.5" /> {t('adminDashboardPage.verifyButton')}
                          </button>
                          {d.status === 'pending' && <>
                            <button onClick={() => approve(d.id, d.name)}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition text-xs font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {t('adminDashboardPage.titleApprove')}
                            </button>
                            <button onClick={() => openRejectModal('doctor', d.id, d.name)}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition text-xs font-medium">
                              <XCircle className="w-3.5 h-3.5" /> {t('adminDashboardPage.titleReject')}
                            </button>
                          </>}
                          {d.status === 'active' && (
                            <button onClick={() => openRejectModal('doctor', d.id, d.name)}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition text-xs font-medium">
                              <XCircle className="w-3.5 h-3.5" /> {t('adminDashboardPage.titleSuspend')}
                            </button>
                          )}
                          {d.status === 'suspended' && (
                            <button onClick={() => approve(d.id, d.name)}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition text-xs font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {t('adminDashboardPage.titleReactivate')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedDoctorId === d.id && (
                      <tr>
                        <td colSpan={7} className="bg-navy-50 border-b border-gray-100 px-4 py-4">
                          <div className="max-w-xl">
                            <p className="font-bold text-navy-700 text-sm mb-2">{t('adminDashboardPage.verificationChecklistTitle')}</p>
                            {NMC_QUALIFICATIONS.includes(d.qualification) ? (
                              <a href="https://www.nmc.org.in/information-desk/indian-medical-register/" target="_blank" rel="noreferrer"
                                className="text-teal-600 hover:underline text-sm font-medium inline-block mb-3">
                                {t('adminDashboardPage.checkNmcLink')}
                              </a>
                            ) : (
                              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                                ⚠️ {t('adminDashboardPage.nonNmcNote')}
                              </p>
                            )}
                            <ul className="text-xs text-gray-600 space-y-1 mb-3 list-disc list-inside">
                              <li>{t('adminDashboardPage.checklistItem1')}</li>
                              <li>{t('adminDashboardPage.checklistItem2')}</li>
                              <li>{t('adminDashboardPage.checklistItem3')}</li>
                              <li>{t('adminDashboardPage.checklistItem4')}</li>
                            </ul>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.verificationNotesLabel')}</label>
                            <textarea className="input-field text-sm mb-2" rows={2}
                              placeholder={t('adminDashboardPage.verificationNotesPlaceholder')}
                              value={notesDraft} onChange={e => setNotesDraft(e.target.value)} />
                            <div className="flex items-center gap-3">
                              <button onClick={() => saveVerificationNotes(d.id)} className="btn-teal text-xs py-1.5 px-3">
                                {t('adminDashboardPage.saveNotesButton')}
                              </button>
                              {notesSavedId === d.id && <span className="text-xs text-teal-600 font-medium">{t('adminDashboardPage.notesSaved')}</span>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {/* Camps & Offers approval table */}
          {tab === 'camps' && (
          <div className="card shadow-sm">
            <h2 className="font-bold text-navy-700 text-lg mb-5">{t('adminDashboardPage.campsApprovalHeading')}</h2>
            {loading ? <p className="text-gray-400 text-sm py-8 text-center">{t('adminDashboardPage.loadingText')}</p> :
              pendingCamps.length === 0 ? <p className="text-gray-400 text-sm py-12 text-center">{t('adminDashboardPage.campsNoPending')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 text-gray-400 text-xs">
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colDoctorCamp')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colType')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colTitle')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colDates')}</th>
                    <th className="text-left py-3 px-2">{t('adminDashboardPage.colAreasCamp')}</th>
                    <th className="py-3 px-2">{t('adminDashboardPage.colActions')}</th>
                  </tr></thead>
                  <tbody>{pendingCamps.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="py-3 px-2">
                        <p className="font-medium text-gray-800">{c.doctors?.name}</p>
                        <p className="text-xs text-gray-400">{c.doctors?.clinic_name}</p>
                      </td>
                      <td className="py-3 px-2 text-gray-600">{c.camp_type === 'free_camp' ? '🆓 Free Camp' : '💰 Offer'}</td>
                      <td className="py-3 px-2 text-gray-600">{c.title}</td>
                      <td className="py-3 px-2 text-xs text-gray-500">
                        {new Date(c.date_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(c.date_to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-xs text-gray-600">{c.pin_codes?.join(', ')}</span>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => approveCamp(c.id, c.title)}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition text-xs font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" /> {t('adminDashboardPage.titleApprove')}
                          </button>
                          <button onClick={() => openRejectModal('camp', c.id, c.title)}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition text-xs font-medium">
                            <XCircle className="w-3.5 h-3.5" /> {t('adminDashboardPage.titleReject')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {/* ── ORGANIZATIONS ── */}
          {tab === 'orgs' && !selectedOrgId && (
            <div className="card shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-bold text-navy-700 text-lg">{t('adminDashboardPage.orgsHeading')}</h2>
                {!showAddOrg && (
                  <button onClick={() => setShowAddOrg(true)} className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> {t('adminDashboardPage.addOrgButton')}
                  </button>
                )}
              </div>

              {showAddOrg && (
                <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.orgNameLabel')}</label>
                      <input className="input-field" placeholder="Apollo Multi-speciality Hospital"
                        value={orgForm.name} onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.orgTypeLabel')}</label>
                      <select className="input-field" value={orgForm.type} onChange={e => setOrgForm(f => ({ ...f, type: e.target.value }))}>
                        <option value="hospital">{t('adminDashboardPage.orgTypeHospital')}</option>
                        <option value="clinic_group">{t('adminDashboardPage.orgTypeClinicGroup')}</option>
                        <option value="chain">{t('adminDashboardPage.orgTypeChain')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.orgRegNumberLabel')}</label>
                      <input className="input-field" value={orgForm.registration_number} onChange={e => setOrgForm(f => ({ ...f, registration_number: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.orgPhoneLabel')}</label>
                      <input className="input-field" value={orgForm.phone} onChange={e => setOrgForm(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.orgEmailLabel')}</label>
                      <input className="input-field" value={orgForm.email} onChange={e => setOrgForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.orgAddressLabel')}</label>
                      <input className="input-field" value={orgForm.address} onChange={e => setOrgForm(f => ({ ...f, address: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createOrg} disabled={!orgForm.name} className="btn-teal text-sm disabled:opacity-50">{t('adminDashboardPage.orgCreateButton')}</button>
                    <button onClick={() => setShowAddOrg(false)} className="btn-outline text-sm">✕</button>
                  </div>
                </div>
              )}

              {organizations.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-12">{t('adminDashboardPage.orgNoneYet')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 text-gray-400 text-xs">
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.colOrgName')}</th>
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.colOrgType')}</th>
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.colStatus')}</th>
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.colDoctorsCount')}</th>
                      <th className="py-3 px-2">{t('adminDashboardPage.colActions')}</th>
                    </tr></thead>
                    <tbody>{organizations.map(o => (
                      <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                        <td className="py-3 px-2">
                          <p className="font-medium text-gray-800 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-navy-600" /> {o.name}</p>
                          <p className="text-xs text-gray-400">{o.phone}</p>
                        </td>
                        <td className="py-3 px-2 text-gray-600 capitalize">{o.type.replace('_', ' ')}</td>
                        <td className="py-3 px-2">
                          <span className={o.status === 'active' ? 'badge-active' : o.status === 'suspended' ? 'badge-suspended' : 'badge-pending'}>{o.status}</span>
                        </td>
                        <td className="py-3 px-2 text-gray-600">{doctors.filter(d => d.organization_id === o.id).length}</td>
                        <td className="py-3 px-2">
                          <div className="flex gap-1 justify-center items-center">
                            <button onClick={() => openOrgDetail(o.id)} className="text-xs text-teal-600 hover:underline font-medium mr-2">{t('adminDashboardPage.viewDetailsButton')}</button>
                            {o.status !== 'active' ? (
                              <button onClick={() => approveOrg(o.id)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition text-xs font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" /> {t('adminDashboardPage.orgApprove')}
                              </button>
                            ) : (
                              <button onClick={() => suspendOrg(o.id)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition text-xs font-medium">
                                <XCircle className="w-3.5 h-3.5" /> {t('adminDashboardPage.orgSuspend')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Organization detail / management view */}
          {tab === 'orgs' && selectedOrgId && selectedOrg && (
            <div className="space-y-4">
              <button onClick={() => setSelectedOrgId(null)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600">
                <ChevronLeft className="w-4 h-4" /> {t('adminDashboardPage.backToOrgsList')}
              </button>

              <div className="card shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-navy-700 text-lg flex items-center gap-2"><Building2 className="w-5 h-5" /> {selectedOrg.name}</h2>
                    <p className="text-gray-400 text-xs">{selectedOrg.address}</p>
                  </div>
                  <span className={selectedOrg.status === 'active' ? 'badge-active' : selectedOrg.status === 'suspended' ? 'badge-suspended' : 'badge-pending'}>{selectedOrg.status}</span>
                </div>
              </div>

              {/* Specialities */}
              <div className="card shadow-sm">
                <h3 className="font-bold text-navy-700 mb-3">{t('adminDashboardPage.manageSpecialitiesTitle')}</h3>
                <div className="flex flex-wrap gap-2">
                  {SPECIALITIES.map(s => {
                    const active = orgSpecialities.some(os => os.speciality === s.id)
                    return (
                      <button key={s.id} onClick={() => toggleOrgSpeciality(s.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${active ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-300 text-gray-500 hover:border-teal-400'}`}>
                        {s.en}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Pricing subscriptions */}
              <div className="card shadow-sm">
                <h3 className="font-bold text-navy-700 mb-3">{t('adminDashboardPage.manageSubscriptionsTitle')}</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  <select className="input-field w-auto" value={subForm.speciality} onChange={e => setSubForm(f => ({ ...f, speciality: e.target.value }))}>
                    <option value="">{t('adminDashboardPage.selectSpecialityPlaceholder')}</option>
                    {orgSpecialities.map(os => {
                      const s = SPECIALITIES.find(sp => sp.id === os.speciality)
                      return <option key={os.id} value={os.speciality}>{s?.en || os.speciality}</option>
                    })}
                  </select>
                  <select className="input-field w-auto" value={subForm.pin_code} onChange={e => setSubForm(f => ({ ...f, pin_code: e.target.value }))}>
                    <option value="">{t('adminDashboardPage.selectPinPlaceholder')}</option>
                    {PIN_CODES.map(p => <option key={p.code} value={p.code}>{p.code} — {p.area}</option>)}
                  </select>
                  <input className="input-field w-40" type="number" placeholder={t('adminDashboardPage.priceLabel')}
                    value={subForm.monthly_price} onChange={e => setSubForm(f => ({ ...f, monthly_price: e.target.value }))} />
                  <button onClick={addSubscription} disabled={!subForm.speciality || !subForm.pin_code} className="btn-teal text-sm px-4 disabled:opacity-50 flex items-center gap-1">
                    <Plus className="w-4 h-4" /> {t('adminDashboardPage.addSubscriptionButton')}
                  </button>
                </div>
                {orgSubscriptions.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-6">{t('adminDashboardPage.noSubscriptionsYet')}</p>
                ) : (
                  <div className="space-y-2">
                    {orgSubscriptions.map(s => {
                      const spec = SPECIALITIES.find(sp => sp.id === s.speciality)
                      const pin = PIN_CODES.find(p => p.code === s.pin_code)
                      return (
                        <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                          <p className="text-sm text-gray-700">{spec?.en || s.speciality} — {pin?.area || s.pin_code}</p>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-teal-600">{s.monthly_price ? `₹${s.monthly_price.toLocaleString('en-IN')}/mo` : '—'}</span>
                            <button onClick={() => removeSubscription(s.id)}><Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" /></button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Linked doctors */}
              <div className="card shadow-sm">
                <h3 className="font-bold text-navy-700 mb-3">{t('adminDashboardPage.manageDoctorsTitle')}</h3>
                <input className="input-field mb-3" placeholder={t('adminDashboardPage.searchUnlinkedDoctors')}
                  value={doctorSearch} onChange={e => setDoctorSearch(e.target.value)} />
                {unlinkedMatches.length > 0 && (
                  <div className="space-y-1 mb-4 border border-gray-100 rounded-lg p-2 max-h-40 overflow-y-auto">
                    {unlinkedMatches.map(d => (
                      <div key={d.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">{d.name} · {d.speciality}</span>
                        <button onClick={() => linkDoctor(d.id)} className="text-xs text-teal-600 hover:underline font-medium">{t('adminDashboardPage.linkDoctorButton')}</button>
                      </div>
                    ))}
                  </div>
                )}
                {orgLinkedDoctors.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-6">{t('adminDashboardPage.noDoctorsLinkedYet')}</p>
                ) : (
                  <div className="space-y-2">
                    {orgLinkedDoctors.map(d => (
                      <div key={d.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{d.name}</p>
                          <p className="text-xs text-gray-400">{d.speciality} · {d.pin_codes?.join(', ')}</p>
                        </div>
                        <button onClick={() => unlinkDoctor(d.id)} className="text-xs text-gray-400 hover:text-red-500 underline">{t('adminDashboardPage.unlinkDoctorButton')}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Styled modal replacing window.prompt() — used for both
          doctor suspend/reject and camp/offer rejection */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setRejectModal(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-navy-700 mb-1">{t('adminDashboardPage.rejectModalTitle')}</h3>
            <p className="text-sm text-gray-500 mb-4">{rejectModal.name}</p>
            <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.rejectReasonLabel')}</label>
            <textarea className="input-field text-sm mb-4" rows={3} autoFocus
              placeholder={t('adminDashboardPage.rejectReasonPlaceholder')}
              value={rejectReasonInput} onChange={e => setRejectReasonInput(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRejectModal(null)} className="btn-outline text-sm px-4">
                {t('adminDashboardPage.modalCancel')}
              </button>
              <button onClick={confirmReject} disabled={!rejectReasonInput.trim()}
                className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-full disabled:opacity-50 transition">
                {t('adminDashboardPage.modalConfirmReject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
