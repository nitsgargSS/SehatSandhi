import { useEffect, useState, Fragment } from 'react'
import { CheckCircle2, XCircle, LogOut, Users, Clock, TrendingUp, Building2, Plus, Trash2, ChevronLeft, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Doctor, SPECIALITIES, PIN_CODES } from '../../types'
import { StatTile, ColumnChart, BarList, RangePicker } from '../../components/Charts'
import { describeHeadcount } from '../../../supabase/functions/_shared/headcount'
import ScrollableTable from '../../components/ScrollableTable'
import { useLanguage } from '../../i18n/LanguageContext'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import EnvSwitcher from '../../components/EnvSwitcher'
import SandboxPanel from './SandboxPanel'
import { isSandbox, SANDBOX_AVAILABLE } from '../../lib/env'
import { adminPricing } from '../../lib/businessApi'

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

// supabase vertical_billing — how each vertical pays. The edge functions read
// this same table when pricing, so it is the authority, not a display copy.
//
// monthly_enabled and commission_enabled are independent: a vertical can pay a
// monthly fee, a commission, both, or neither. (billing_model is the legacy
// either/or column, kept for reference only.)
interface VerticalBillingRow {
  vertical: string
  db_speciality: string
  billing_model: 'pincode_monthly' | 'commission'
  monthly_enabled: boolean | null
  commission_enabled: boolean | null
  commission_percent: number | null
  commission_basis: string | null
  is_active: boolean
}

// supabase pricing_plans / pricing_plan_status
interface PlanRow {
  code: string
  label: string
  description: string | null
  sequence: number
  mode: 'flat_all_pincodes' | 'flat_per_pincode' | 'pincode_tiers'
  monthly_price: number | null
  doctor_billing?: string
  included_doctors?: number
  extra_doctor_price?: number
  default_months: number
  min_months: number
  max_months: number
  max_signups: number | null
  suspend_commission: boolean
  is_enabled: boolean
  /** Every listing ever locked onto the plan — this is what a seat cap counts. */
  signups_used?: number
  /** Live listings still inside their paid term — zero means nobody is affected today. */
  active_enrolled?: number
  expired_enrolled?: number
  last_signup_at?: string | null
  seats_left?: number | null
  can_delete?: boolean
  is_currently_active?: boolean
}

interface TierRow {
  tier_number: number
  tier_name: string
  monthly_price: number
}

interface TaxSettingsRow {
  legal_name: string | null
  trade_name: string | null
  gstin: string | null
  state_code: string | null
  registered_address: string | null
  city: string | null
  pin_code: string | null
  sac_code: string | null
  gst_rate: number | null
  gst_enabled: boolean | null
  invoice_prefix: string | null
}

interface InvoiceRow {
  id: string
  invoice_number: string
  invoice_date: string
  recipient_name: string | null
  recipient_gstin: string | null
  place_of_supply: string | null
  taxable_value: number
  gst_rate: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  tax_total: number
  total_amount: number
  status: string
  public_token: string
  sent_whatsapp_at: string | null
  sent_email_at: string | null
}

interface InvoiceMonth {
  month: string
  invoices: number
  taxable_value: number
  tax_collected: number
  total_collected: number
}

interface PlanEvent {
  id: string
  plan_code: string | null
  action: string
  actor: string | null
  created_at: string
}

export default function AdminDashboard() {
  const { t } = useLanguage()
  const [doctors, setDoctors] = useState<DoctorWithOrg[]>([])
  const [camps, setCamps] = useState<CampOfferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'all' | 'camps' | 'orgs' | 'coupons' | 'billing' | 'reports' | 'account' | 'sandbox'>('pending')

  // ── Platform reporting ──
  interface PlatformRow {
    day: string; visitors: number; page_views: number; searches: number
    profile_views: number; whatsapp_clicks: number; business_leads: number
    new_listings: number; bookings: number
  }
  interface DemandRow {
    pin_code: string; area_name: string; speciality: string | null
    searches: number; searchers: number; active_listings: number
  }
  const [repDays, setRepDays] = useState(30)
  const [platform, setPlatform] = useState<PlatformRow[]>([])
  const [demand, setDemand] = useState<DemandRow[]>([])
  const [repLoading, setRepLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'reports') return
    let cancelled = false
    setRepLoading(true)
    Promise.all([
      supabase.rpc('sehat_platform_report', { p_days: repDays }),
      supabase.rpc('sehat_demand_report', { p_days: repDays }),
    ]).then(([p, d]) => {
      if (cancelled) return
      setPlatform((p.data as PlatformRow[]) || [])
      setDemand((d.data as DemandRow[]) || [])
      setRepLoading(false)
    })
    return () => { cancelled = true }
  }, [tab, repDays])

  const pTotal = (k: keyof PlatformRow) => platform.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  const dLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const specName = (id: string | null) => SPECIALITIES.find(s => s.id === id)?.en ?? id ?? 'Any'

  // ── Changing a listing's speciality ──
  // Needed because every doctor registered before today was stored as GEN
  // regardless of what they practise, and patients match on this exact value.
  // admins_update_doctors (migration 0012) already permits the write.
  const [specBusy, setSpecBusy] = useState<string | null>(null)
  const [specMsg, setSpecMsg] = useState('')

  // Specialities that ARE a business vertical. Moving a listing onto one of
  // these changes how it is billed — a doctor set to PHARMACY stops paying
  // monthly and starts owing commission — so it is confirmed, not silent.
  const VERTICAL_SPECIALITIES: Record<string, string> = {
    GEN: 'doctors', HOSPITAL: 'hospital', LAB: 'lab',
    PHARMACY: 'pharmacy', INSURANCE: 'insurance', AMBULANCE: 'ambulance',
  }
  const verticalOf = (spec: string) => VERTICAL_SPECIALITIES[spec] ?? 'doctors'

  const changeSpeciality = async (doc: Doctor, next: string) => {
    if (!next || next === doc.speciality) return
    const from = verticalOf(doc.speciality), to = verticalOf(next)
    if (from !== to && !window.confirm(
      `${doc.name} is billed as "${from}". Changing the speciality to ${specName(next)} `
      + `moves them to "${to}", which changes how they are charged.\n\nContinue?`
    )) return

    setSpecBusy(doc.id); setSpecMsg('')
    const { error } = await supabase.from('doctors')
      .update({ speciality: next }).eq('id', doc.id)
    setSpecBusy(null)
    if (error) { setSpecMsg(`Could not change: ${error.message}`); return }
    setSpecMsg(`${doc.name} is now listed under ${specName(next)}.`)
    setTimeout(() => setSpecMsg(''), 5000)
    await load()
  }
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

  // ── Pricing: per-vertical billing (anon-readable) + plan management ──
  // Reads of vertical_billing and the active plan use the normal anon key, since
  // the site quotes them publicly anyway. WRITES go through the admin-pricing
  // edge function, which holds a server-only key — VITE_ADMIN_PASS is compiled
  // into this bundle, so an anon write policy on pricing would let anyone
  // re-price the platform.
  const [billingPlans, setBillingPlans] = useState<VerticalBillingRow[]>([])
  const [activePlan, setActivePlan] = useState<PlanRow | null>(null)
  const [pricingKey, setPricingKey] = useState(() => sessionStorage.getItem('pricing_key') || '')
  // Authorised to change pricing — by the admin session, or by a typed key.
  const [pricingReady, setPricingReady] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [planRows, setPlanRows] = useState<PlanRow[]>([])
  const [tierRows, setTierRows] = useState<TierRow[]>([])
  const [planEvents, setPlanEvents] = useState<PlanEvent[]>([])
  const [pricingBusy, setPricingBusy] = useState(false)
  const [pricingMsg, setPricingMsg] = useState('')
  const [pricingErr, setPricingErr] = useState('')
  const [planDraft, setPlanDraft] = useState<Record<string, Record<string, string>>>({})
  const [tierDraft, setTierDraft] = useState<Record<number, string>>({})
  const [vbDraft, setVbDraft] = useState<Record<string, string>>({})
  const [showNewPlan, setShowNewPlan] = useState(false)
  const [newPlan, setNewPlan] = useState({
    code: '', label: '', description: '', mode: 'flat_all_pincodes',
    monthly_price: '', default_months: '1', min_months: '1', max_months: '12',
    max_signups: '', suspend_commission: false, sequence: '900',
  })
  const [taxSettings, setTaxSettings] = useState<TaxSettingsRow | null>(null)
  const [taxDraft, setTaxDraft] = useState<Record<string, string>>({})
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [invoiceMonths, setInvoiceMonths] = useState<InvoiceMonth[]>([])

  // Pull the full plan list (seat counts, disabled plans) — needs the key.
  // key is optional: an admin session authorises on its own. It is only passed
  // when someone types one into the break-glass box.
  const loadPricing = async (key: string) => {
    setPricingBusy(true); setPricingErr('')
    try {
      const res = await adminPricing<{
        plans: PlanRow[]; tiers: TierRow[]; verticals: VerticalBillingRow[]; events: PlanEvent[]
      }>(key, 'list')
      setPlanRows(res.plans || [])
      setTierRows(res.tiers || [])
      setBillingPlans(res.verticals || [])
      setPlanEvents(res.events || [])
      const ts = await adminPricing<{ taxSettings: TaxSettingsRow }>(key, 'taxSettings')
      setTaxSettings(ts.taxSettings ?? null)
      const inv = await adminPricing<{ invoices: InvoiceRow[]; summary: InvoiceMonth[] }>(key, 'invoices')
      setInvoices(inv.invoices || [])
      setInvoiceMonths(inv.summary || [])
      if (key) sessionStorage.setItem('pricing_key', key)
      setPricingKey(key)
      setPricingReady(true)
    } catch (e) {
      // A 401 with no key typed means the session itself was refused — either
      // this account is not in admin_users, or the session has expired.
      setPricingErr((e as Error).message.includes('401')
        ? (key
            ? 'That pricing key was not accepted.'
            : 'This account is not authorised for pricing changes. Sign in again, or use a pricing key below.')
        : (e as Error).message)
      sessionStorage.removeItem('pricing_key')
      setPricingKey('')
      setPricingReady(false)
    } finally {
      setPricingBusy(false)
    }
  }

  const runPricingAction = async (action: string, args: Record<string, unknown>, okMsg: string) => {
    if (!pricingReady) return
    setPricingBusy(true); setPricingErr(''); setPricingMsg('')
    try {
      await adminPricing(pricingKey, action, args)
      setPricingMsg(okMsg)
      await loadPricing(pricingKey)
      const { data } = await supabase.from('active_pricing_plan').select('*').maybeSingle()
      setActivePlan((data as PlanRow) || null)
    } catch (e) {
      setPricingErr((e as Error).message)
    } finally {
      setPricingBusy(false)
    }
  }

  // ── Coupons state ──
  const [coupons, setCoupons] = useState<any[]>([])
  const [showAddCoupon, setShowAddCoupon] = useState(false)
  const [couponForm, setCouponForm] = useState({
    code: '', discount_type: 'percentage', discount_value: '',
    applies_to: 'first_payment', duration_months: '',
    max_uses: '', valid_from: new Date().toISOString().split('T')[0], valid_until: '',
    show_on_banner: false, banner_text_en: '', banner_text_hi: '', notes: '',
  })

  const load = async () => {
    setLoading(true)
    // Every query below falls back to [] on error, which renders an empty tab
    // that looks identical to "no data yet". That is exactly how a database
    // missing a table (a half-applied migration, an incomplete sandbox clone)
    // passes for healthy. Log it so the difference is visible in the console.
    const warn = (table: string, err: { message: string } | null) => {
      if (err) console.warn(`[admin] ${table} query failed — tab will render empty:`, err.message)
    }

    const { data, error: docErr } = await supabase.from('doctors').select('*').order('created_at', { ascending: false })
    warn('doctors', docErr)
    setDoctors((data as DoctorWithOrg[]) || [])
    const { data: campData, error: campErr } = await supabase
      .from('camps_offers')
      .select('*, doctors(name, clinic_name)')
      .order('created_at', { ascending: false })
    warn('camps_offers', campErr)
    setCamps((campData as any) || [])
    const { data: orgData, error: orgErr } = await supabase.from('organizations').select('*').order('created_at', { ascending: false })
    warn('organizations', orgErr)
    setOrganizations(orgData || [])
    const { data: couponData, error: coupErr } = await supabase.from('discount_codes').select('*').order('created_at', { ascending: false })
    warn('discount_codes', coupErr)
    setCoupons(couponData || [])
    // Per-vertical billing plans. Read-only here: rates are the authority the
    // edge functions price against, so they change in the SQL editor, not
    // behind an admin password.
    const { data: billingData, error: billErr } = await supabase.from('vertical_billing').select('*')
    warn('vertical_billing', billErr)
    setBillingPlans((billingData as VerticalBillingRow[]) || [])
    const { data: planData } = await supabase.from('active_pricing_plan').select('*').maybeSingle()
    setActivePlan((planData as PlanRow) || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // If the pricing key is already in this session, pull the full plan list.
  // Being signed in as an admin is enough — the edge function reads the session
  // token. The key box only appears if this fails, as a break-glass path.
  useEffect(() => { loadPricing(pricingKey) }, [])

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

  // ── Coupon actions ──
  const createCoupon = async () => {
    if (!couponForm.code || !couponForm.discount_value) return
    await supabase.from('discount_codes').insert({
      code: couponForm.code.trim().toUpperCase(),
      discount_type: couponForm.discount_type,
      discount_value: parseInt(couponForm.discount_value),
      applies_to: couponForm.applies_to,
      duration_months: couponForm.duration_months ? parseInt(couponForm.duration_months) : null,
      max_uses: couponForm.max_uses ? parseInt(couponForm.max_uses) : null,
      valid_from: couponForm.valid_from || null,
      valid_until: couponForm.valid_until || null,
      show_on_banner: couponForm.show_on_banner,
      banner_text_en: couponForm.banner_text_en || null,
      banner_text_hi: couponForm.banner_text_hi || null,
      notes: couponForm.notes || null,
      created_by: 'admin',
      is_active: true,
    })
    setCouponForm({
      code: '', discount_type: 'percentage', discount_value: '',
      applies_to: 'first_payment', duration_months: '',
      max_uses: '', valid_from: new Date().toISOString().split('T')[0], valid_until: '',
      show_on_banner: false, banner_text_en: '', banner_text_hi: '', notes: '',
    })
    setShowAddCoupon(false)
    load()
  }

  const toggleCouponActive = async (id: string, current: boolean) => {
    await supabase.from('discount_codes').update({ is_active: !current }).eq('id', id)
    load()
  }

  const deleteCoupon = async (id: string, code: string) => {
    if (!window.confirm(`${t('adminDashboardPage.deleteCouponConfirm')} ${code}?`)) return
    await supabase.from('discount_codes').delete().eq('id', id)
    load()
  }

  const couponStatusLabel = (c: any) => {
    const today = new Date().toISOString().split('T')[0]
    if (!c.is_active) return { label: t('adminDashboardPage.couponInactive'), cls: 'badge-suspended' }
    if (c.valid_until && c.valid_until < today) return { label: t('adminDashboardPage.couponExpired'), cls: 'badge-suspended' }
    if (c.valid_from && c.valid_from > today) return { label: t('adminDashboardPage.couponScheduled'), cls: 'badge-pending' }
    if (c.max_uses !== null && (c.current_uses || 0) >= c.max_uses) return { label: t('adminDashboardPage.couponExhausted2'), cls: 'badge-suspended' }
    return { label: t('adminDashboardPage.couponLive'), cls: 'badge-active' }
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

  // ── Account: change password ──
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [adminEmail, setAdminEmail] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAdminEmail(data.user?.email ?? ''))
  }, [])

  const changePassword = async () => {
    setPwErr(''); setPwMsg('')

    if (pw.next !== pw.confirm) { setPwErr('The two new passwords do not match.'); return }
    // Supabase's own floor is 6, which is not a password. Length is the only
    // rule that reliably helps, so ask for length rather than punctuation.
    if (pw.next.length < 12) { setPwErr('Use at least 12 characters — length matters more than symbols.'); return }
    if (pw.next === pw.current) { setPwErr('That is the password you already have.'); return }
    // Without the email the re-auth below fails, and its error message would
    // blame the current password for something that is not its fault.
    if (!adminEmail) { setPwErr('Still loading your account — try again in a moment.'); return }

    setPwBusy(true)
    try {
      // Re-authenticate first. updateUser() would accept the change on the
      // strength of the session alone, so anyone who got hold of an open tab
      // could set a new password and lock the real owner out. Proving the
      // current password is what makes that impossible.
      const { error: reauth } = await supabase.auth.signInWithPassword({
        email: adminEmail, password: pw.current,
      })
      if (reauth) { setPwErr('That current password is not right.'); return }

      const { error } = await supabase.auth.updateUser({ password: pw.next })
      if (error) { setPwErr(error.message); return }

      setPw({ current: '', next: '', confirm: '' })
      setPwMsg('Password changed. Other devices stay signed in until their sessions expire — use "Sign out everywhere" if one is lost.')
    } finally {
      setPwBusy(false)
    }
  }

  // For a lost or stolen device: revokes every refresh token for this account,
  // including this tab's, so everything has to sign in again.
  const signOutEverywhere = async () => {
    setPwBusy(true)
    try {
      await supabase.auth.signOut({ scope: 'global' })
      window.location.href = '/ng-ctrl-2026'
    } finally {
      setPwBusy(false)
    }
  }

  // Ends the Supabase session server-side, so the token cannot be replayed from
  // this browser afterwards. The pricing key is dropped too — it is held only
  // for the session that typed it.
  const logout = async () => {
    sessionStorage.removeItem('pricing_key')
    await supabase.auth.signOut()
    window.location.href = '/ng-ctrl-2026'
  }

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

  // Rendered by both the desktop table and the mobile cards. Defined once: the
  // approve/reject buttons are the whole point of this screen, and two copies
  // would drift the first time one of them changed.
  const SpecialitySelect = ({ d }: { d: Doctor }) => (
    <select
      value={d.speciality ?? ''}
      disabled={specBusy === d.id}
      onChange={e => changeSpeciality(d, e.target.value)}
      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 w-full md:max-w-[170px] disabled:opacity-50"
      title="Change what patients search for to find this listing">
      {!SPECIALITIES.some(sp => sp.id === d.speciality) && d.speciality && (
        <option value={d.speciality}>{d.speciality} (unrecognised)</option>
      )}
      {SPECIALITIES.map(sp => <option key={sp.id} value={sp.id}>{sp.en}</option>)}
    </select>
  )

  const DoctorActions = ({ d }: { d: Doctor }) => (
    <div className="flex gap-1 flex-wrap md:justify-center">
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
  )

  const CampActions = ({ c }: { c: any }) => (
    <div className="flex gap-1 flex-wrap md:justify-center">
      <button onClick={() => approveCamp(c.id, c.title)}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition text-xs font-medium">
        <CheckCircle2 className="w-3.5 h-3.5" /> {t('adminDashboardPage.titleApprove')}
      </button>
      <button onClick={() => openRejectModal('camp', c.id, c.title)}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition text-xs font-medium">
        <XCircle className="w-3.5 h-3.5" /> {t('adminDashboardPage.titleReject')}
      </button>
    </div>
  )

  const OrgActions = ({ o }: { o: any }) => (
    <div className="flex gap-2 flex-wrap items-center md:justify-center">
      <button onClick={() => openOrgDetail(o.id)}
        className="text-xs text-teal-600 hover:underline font-medium">{t('adminDashboardPage.viewDetailsButton')}</button>
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
  )

  const StatusBadge = ({ status }: { status: string }) => (
    <span className={status === 'active' ? 'badge-active' : status === 'suspended' ? 'badge-suspended' : 'badge-pending'}>
      {status}
    </span>
  )

  // One definition, rendered twice — as the desktop rail and as the mobile strip.
  const NAV_ITEMS = [

              { id: 'pending', label: t('adminDashboardPage.navPendingPrefix'), count: pending.length, badge: pending.length > 0 },
              { id: 'all', label: t('adminDashboardPage.navAllDoctors'), count: 0, badge: false },
              { id: 'camps', label: t('adminDashboardPage.navCamps'), count: pendingCamps.length, badge: pendingCamps.length > 0 },
              { id: 'orgs', label: t('adminDashboardPage.navOrgs'), count: 0, badge: false },
              { id: 'coupons', label: t('adminDashboardPage.navCoupons'), count: 0, badge: false },
              { id: 'billing', label: t('adminDashboardPage.navBilling'), count: 0, badge: false },
              { id: 'reports', label: 'Reports', count: 0, badge: false },
              { id: 'account', label: 'Account', count: 0, badge: false },
              // Only reachable while pointed at the sandbox backend — the purge
              // it exposes must never be one click away from production data.
              ...(isSandbox() ? [{ id: 'sandbox', label: '🧪 Sandbox', count: 0, badge: false }] : []),
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        {/* Sidebar */}
        {/* Fixed 224px rail on desktop. Hidden below md, where it used to sit on
            top of the content while ml-56 pushed that content off-screen — on a
            360px phone it left about 70px of usable width, so every panel here
            was unreadable, not only the charts. */}
        <aside className="hidden md:flex w-56 bg-navy-700 min-h-screen fixed left-0 top-0 flex-col pt-6">
          <div className="px-5 mb-4">
            <img src="/logo.png" alt="Sehatsandhi" className="h-10 brightness-0 invert" />
            <p className="text-white/40 text-xs mt-2">{t('adminDashboardPage.sidebarLabel')}</p>
          </div>
          <div className="px-5 mb-4">
            <LanguageSwitcher dark />
          </div>
          {SANDBOX_AVAILABLE && (
            <div className="px-5 mb-4">
              <EnvSwitcher compact />
            </div>
          )}
          <nav className="flex-1 px-3 space-y-1">
            {NAV_ITEMS.map(n => (
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
        <main className="md:ml-56 flex-1 p-4 md:p-8 min-w-0">
          {/* Mobile nav: the rail's items as one scrollable row. */}
          <div className="md:hidden -mx-4 px-4 mb-5 overflow-x-auto">
            <div className="flex gap-2 w-max pb-1">
              {NAV_ITEMS.map(n => (
                <button key={n.id} onClick={() => { setTab(n.id as any); setSelectedOrgId(null) }}
                  className={`shrink-0 px-3.5 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5 ${
                    tab === n.id ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
                  {n.label}
                  {n.badge && <span className="bg-amber-500 text-white text-[10px] px-1.5 rounded-full">{n.count}</span>}
                </button>
              ))}
              <button onClick={logout}
                className="shrink-0 px-3.5 py-2 rounded-xl text-sm font-medium bg-white text-gray-400 border border-gray-200">
                Log out
              </button>
            </div>
          </div>
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

            {specMsg && (
              <div className={`rounded-xl p-3 text-sm mb-4 ${specMsg.startsWith('Could not') ? 'bg-red-50 text-red-600' : 'bg-teal-50 text-teal-700'}`}>
                {specMsg}
              </div>
            )}

            {loading ? <p className="text-gray-400 text-sm py-8 text-center">{t('adminDashboardPage.loadingText')}</p> :
              filtered.length === 0 ? <p className="text-gray-400 text-sm py-12 text-center">{t('adminDashboardPage.noDoctorsFound')}</p> : (
              <>
              {/* Cards below md. The table is 541px wide inside a 278px column on
                  a phone, so Reg no., Areas, Added, Status and every action
                  button sat off the right edge behind a sideways scroll nobody
                  could see — Approve, the one thing this screen is for, included. */}
              <div className="md:hidden space-y-3">
                {filtered.map(d => (
                  <div key={d.id} className="border border-gray-100 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 leading-snug">
                          {d.name}
                          {d.is_hospital_doctor && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded ml-1">🏨</span>}
                        </p>
                        <p className="text-xs text-gray-400">{d.qualification} · {d.phone}</p>
                      </div>
                      <StatusBadge status={d.status} />
                    </div>

                    <div className="mb-2"><SpecialitySelect d={d} /></div>

                    <div className="text-xs text-gray-500 space-y-0.5 mb-3">
                      {d.reg_number && (
                        <div>Reg <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{d.reg_number}</span></div>
                      )}
                      {d.pin_codes?.length ? <div>Areas: {d.pin_codes.join(', ')}</div> : null}
                      <div>Added {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                    </div>

                    <DoctorActions d={d} />

                    {/* The verification panel opens inside the card it belongs
                        to, rather than as a row of a table that is not rendered. */}
                    {expandedDoctorId === d.id && (
                      <div className="bg-navy-50 rounded-lg px-3 py-3 mt-3">
                        <p className="font-bold text-navy-700 text-sm mb-2">{t('adminDashboardPage.verificationChecklistTitle')}</p>
                        {NMC_QUALIFICATIONS.includes(d.qualification) ? (
                          <a href="https://www.nmc.org.in/information-desk/indian-medical-register/" target="_blank" rel="noreferrer"
                            className="text-teal-600 hover:underline text-sm font-medium inline-block mb-2">
                            {t('adminDashboardPage.checkNmcLink')}
                          </a>
                        ) : (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2">
                            {t('adminDashboardPage.nonNmcWarning')}
                          </p>
                        )}
                        <textarea className="input-field text-sm w-full" rows={3}
                          placeholder={t('adminDashboardPage.notesPlaceholder')}
                          value={notesDraft} onChange={e => setNotesDraft(e.target.value)} />
                        <div className="flex items-center gap-3 mt-2">
                          <button onClick={() => saveVerificationNotes(d.id)}
                            className="btn-teal text-xs py-1.5 px-4">{t('adminDashboardPage.saveNotesButton')}</button>
                          {notesSavedId === d.id && <span className="text-xs text-teal-600 font-medium">{t('adminDashboardPage.notesSaved')}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="hidden md:block overflow-x-auto">
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
                      {/* Editable: patients find a listing by this exact value,
                          so a wrong one makes the listing invisible rather than
                          merely mislabelled. */}
                      <td className="py-3 px-2">
                        <SpecialitySelect d={d} />
                      </td>
                      <td className="py-3 px-2">
                        <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{d.reg_number}</span>
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-xs text-gray-600">{d.pin_codes?.join(', ')}</span>
                      </td>
                      <td className="py-3 px-2 text-xs text-gray-500">
                        {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="py-3 px-2"><StatusBadge status={d.status} /></td>
                      <td className="py-3 px-2"><DoctorActions d={d} /></td>
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
              </>
            )}
          </div>
          )}

          {/* Camps & Offers approval table */}
          {tab === 'camps' && (
          <div className="card shadow-sm">
            <h2 className="font-bold text-navy-700 text-lg mb-5">{t('adminDashboardPage.campsApprovalHeading')}</h2>
            {loading ? <p className="text-gray-400 text-sm py-8 text-center">{t('adminDashboardPage.loadingText')}</p> :
              pendingCamps.length === 0 ? <p className="text-gray-400 text-sm py-12 text-center">{t('adminDashboardPage.campsNoPending')}</p> : (
              <>
              {/* Cards below md: approving a camp is the action this screen
                  exists for, and in the table it is the last column — off the
                  right edge of a phone. */}
              <div className="md:hidden space-y-3">
                {pendingCamps.map(c => (
                  <div key={c.id} className="border border-gray-100 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-medium text-gray-800 leading-snug min-w-0">{c.title}</p>
                      <span className="text-xs shrink-0 text-gray-500">
                        {c.camp_type === 'free_camp' ? '🆓 Free Camp' : '💰 Offer'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{c.doctors?.name}</p>
                    <p className="text-xs text-gray-400 mb-2">{c.doctors?.clinic_name}</p>
                    <div className="text-xs text-gray-500 space-y-0.5 mb-3">
                      <div>
                        {new Date(c.date_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(c.date_to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </div>
                      {c.pin_codes?.length ? <div>Areas: {c.pin_codes.join(', ')}</div> : null}
                    </div>
                    <CampActions c={c} />
                  </div>
                ))}
              </div>

              <ScrollableTable className="hidden md:block">
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
                      <td className="py-3 px-2"><CampActions c={c} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </ScrollableTable>
              </>
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
                <>
                <div className="md:hidden space-y-3">
                  {organizations.map(o => (
                    <div key={o.id} className="border border-gray-100 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="font-medium text-gray-800 flex items-center gap-1.5 min-w-0">
                          <Building2 className="w-3.5 h-3.5 text-navy-600 shrink-0" />
                          <span className="truncate">{o.name}</span>
                        </p>
                        <StatusBadge status={o.status} />
                      </div>
                      <p className="text-xs text-gray-500 capitalize mb-2">
                        {o.type.replace('_', ' ')}
                        {o.phone ? ` · ${o.phone}` : ''}
                        {' · '}
                        {doctors.filter(d => d.organization_id === o.id).length} doctors
                      </p>
                      <OrgActions o={o} />
                    </div>
                  ))}
                </div>

                <ScrollableTable className="hidden md:block">
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
                        <td className="py-3 px-2"><OrgActions o={o} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </ScrollableTable>
                </>
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

          {/* ── COUPONS ── */}
          {tab === 'coupons' && (
            <div className="card shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-bold text-navy-700 text-lg">{t('adminDashboardPage.couponsHeading')}</h2>
                {!showAddCoupon && (
                  <button onClick={() => setShowAddCoupon(true)} className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> {t('adminDashboardPage.addCouponButton')}
                  </button>
                )}
              </div>

              {showAddCoupon && (
                <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponCodeLabel')}</label>
                      <input className="input-field uppercase" placeholder="DIWALI30"
                        value={couponForm.code} onChange={e => setCouponForm(f => ({ ...f, code: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponTypeLabel')}</label>
                      <select className="input-field" value={couponForm.discount_type}
                        onChange={e => setCouponForm(f => ({ ...f, discount_type: e.target.value }))}>
                        <option value="percentage">{t('adminDashboardPage.couponTypePercentage')}</option>
                        <option value="fixed_amount">{t('adminDashboardPage.couponTypeFixed')}</option>
                        <option value="free_months">{t('adminDashboardPage.couponTypeFreeMonths')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">
                        {couponForm.discount_type === 'percentage' ? t('adminDashboardPage.couponValuePercent')
                          : couponForm.discount_type === 'fixed_amount' ? t('adminDashboardPage.couponValueAmount')
                          : t('adminDashboardPage.couponValueMonths')}
                      </label>
                      <input className="input-field" type="number" placeholder={couponForm.discount_type === 'percentage' ? '30' : '1000'}
                        value={couponForm.discount_value} onChange={e => setCouponForm(f => ({ ...f, discount_value: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponDurationLabel')}</label>
                      <input className="input-field" type="number" placeholder="3"
                        value={couponForm.duration_months} onChange={e => setCouponForm(f => ({ ...f, duration_months: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponMaxUsesLabel')}</label>
                      <input className="input-field" type="number" placeholder={t('adminDashboardPage.couponUnlimitedPlaceholder')}
                        value={couponForm.max_uses} onChange={e => setCouponForm(f => ({ ...f, max_uses: e.target.value }))} />
                    </div>
                    <div />
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponValidFromLabel')}</label>
                      <input className="input-field" type="date"
                        value={couponForm.valid_from} onChange={e => setCouponForm(f => ({ ...f, valid_from: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponValidUntilLabel')}</label>
                      <input className="input-field" type="date"
                        value={couponForm.valid_until} onChange={e => setCouponForm(f => ({ ...f, valid_until: e.target.value }))} />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-700 pt-1">
                    <input type="checkbox" checked={couponForm.show_on_banner}
                      onChange={e => setCouponForm(f => ({ ...f, show_on_banner: e.target.checked }))}
                      className="w-4 h-4 accent-amber-500" />
                    {t('adminDashboardPage.couponShowBannerLabel')}
                  </label>

                  {couponForm.show_on_banner && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-amber-50 border border-amber-100 rounded-lg p-3">
                      <div>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponBannerEnLabel')}</label>
                        <input className="input-field" placeholder="Diwali Offer — 30% off for 3 months. Use code DIWALI30"
                          value={couponForm.banner_text_en} onChange={e => setCouponForm(f => ({ ...f, banner_text_en: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponBannerHiLabel')}</label>
                        <input className="input-field" placeholder="दिवाली ऑफर — 3 महीने 30% छूट। कोड DIWALI30"
                          value={couponForm.banner_text_hi} onChange={e => setCouponForm(f => ({ ...f, banner_text_hi: e.target.value }))} />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminDashboardPage.couponNotesLabel')}</label>
                    <input className="input-field" placeholder={t('adminDashboardPage.couponNotesPlaceholder')}
                      value={couponForm.notes} onChange={e => setCouponForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={createCoupon} disabled={!couponForm.code || !couponForm.discount_value}
                      className="btn-teal text-sm disabled:opacity-50">{t('adminDashboardPage.couponCreateButton')}</button>
                    <button onClick={() => setShowAddCoupon(false)} className="btn-outline text-sm">✕</button>
                  </div>
                </div>
              )}

              {coupons.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-12">{t('adminDashboardPage.couponNoneYet')}</p>
              ) : (
                <ScrollableTable>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100 text-gray-400 text-xs">
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.couponCodeLabel')}</th>
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.couponColDiscount')}</th>
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.couponColValidity')}</th>
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.couponColUsage')}</th>
                      <th className="text-left py-3 px-2">🏷️</th>
                      <th className="text-left py-3 px-2">{t('adminDashboardPage.colStatus')}</th>
                      <th className="py-3 px-2">{t('adminDashboardPage.colActions')}</th>
                    </tr></thead>
                    <tbody>{coupons.map(c => {
                      const status = couponStatusLabel(c)
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                          <td className="py-3 px-2 font-mono font-bold text-navy-700">{c.code}</td>
                          <td className="py-3 px-2 text-gray-600">
                            {c.discount_type === 'percentage' && `${c.discount_value}%`}
                            {c.discount_type === 'fixed_amount' && `₹${c.discount_value}`}
                            {c.discount_type === 'free_months' && `${t('adminDashboardPage.couponFreeMonthsShort')}`}
                            {c.duration_months && <span className="text-xs text-gray-400"> · {c.duration_months}mo</span>}
                          </td>
                          <td className="py-3 px-2 text-xs text-gray-500">
                            {c.valid_from ? new Date(c.valid_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                            {' → '}
                            {c.valid_until ? new Date(c.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : t('adminDashboardPage.couponNoExpiry')}
                          </td>
                          <td className="py-3 px-2 text-gray-600">{c.current_uses || 0}{c.max_uses !== null ? ` / ${c.max_uses}` : ''}</td>
                          <td className="py-3 px-2">{c.show_on_banner && <span title="Shown on homepage banner">🏷️</span>}</td>
                          <td className="py-3 px-2"><span className={status.cls}>{status.label}</span></td>
                          <td className="py-3 px-2">
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => toggleCouponActive(c.id, c.is_active)}
                                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition text-xs font-medium">
                                {c.is_active ? t('adminDashboardPage.couponPause') : t('adminDashboardPage.couponResume')}
                              </button>
                              <button onClick={() => deleteCoupon(c.id, c.code)}
                                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition text-xs font-medium">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}</tbody>
                  </table>
                </ScrollableTable>
              )}
            </div>
          )}

          {tab === 'billing' && (
            <div className="space-y-6">
              {/* Which plan new registrations are being quoted right now */}
              <div className="card shadow-sm">
                <h2 className="font-bold text-navy-700 text-lg mb-1">{t('adminDashboardPage.billingHeading')}</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Changing a plan affects <strong>new registrations only</strong>. Businesses already signed up keep
                  the price and term they paid for — their locked price is on their listing.
                </p>
                {activePlan ? (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex flex-wrap gap-4 items-center justify-between">
                    <div>
                      <div className="text-xs text-teal-700 font-semibold uppercase tracking-wide">Live plan</div>
                      <div className="font-bold text-navy-700 text-lg">{activePlan.label}</div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">{activePlan.code} · {activePlan.mode}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-teal-600">
                        {activePlan.mode === 'pincode_tiers'
                          ? 'By pincode tier'
                          : `₹${Number(activePlan.monthly_price ?? 0).toLocaleString('en-IN')}/mo`}
                      </div>
                      <div className="text-xs text-gray-500">
                        business picks {activePlan.min_months}–{activePlan.max_months} months
                        {activePlan.default_months > activePlan.min_months && ` · ${activePlan.default_months} shown as best value`}
                        {activePlan.suspend_commission && ' · commission suspended'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 py-4">
                    No active plan found — run <code className="font-mono">npm run migrate</code>.
                  </p>
                )}
              </div>

              {/* Writes need the server-only key */}
              {!pricingReady ? (
                <div className="card shadow-sm">
                  <h3 className="font-bold text-navy-700 mb-1">
                    {pricingBusy ? 'Checking your access…' : 'Pricing is locked'}
                  </h3>
                  <p className="text-sm text-gray-500 mb-3">
                    Being signed in as an admin normally unlocks this by itself. If you are seeing this, the session
                    was refused — the account may not be in <code className="font-mono">admin_users</code>, or the
                    session has expired and signing in again will fix it. The pricing key below is the way back in
                    when it does not.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <input className="input-field max-w-xs" type="password" placeholder="Pricing key"
                      value={keyInput} onChange={e => setKeyInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') loadPricing(keyInput) }} />
                    <button onClick={() => loadPricing(keyInput)} disabled={!keyInput || pricingBusy}
                      className="btn-teal text-sm py-2 px-4 disabled:opacity-50">
                      {pricingBusy ? 'Checking…' : 'Unlock'}
                    </button>
                  </div>
                  {pricingErr && <p className="text-red-500 text-sm mt-2">{pricingErr}</p>}
                </div>
              ) : (
                <>
                  {(pricingMsg || pricingErr) && (
                    <div className={`rounded-xl p-3 text-sm ${pricingErr ? 'bg-red-50 text-red-600' : 'bg-teal-50 text-teal-700'}`}>
                      {pricingErr || pricingMsg}
                    </div>
                  )}

                  {/* What the live plan currently charges — read only. The price
                      is edited in one place, the Plan queue below, so there is
                      no second write path that can disagree with it. This card
                      still earns its place: it names which plan is live, and it
                      is where the seat-cap warning belongs. */}
                  {activePlan && activePlan.mode !== 'pincode_tiers' && (
                    <div className="card shadow-sm">
                      <h3 className="font-bold text-navy-700 mb-1">Price on the live plan</h3>
                      <p className="text-sm text-gray-500 mb-3">
                        What a business pays per month on <strong>{activePlan.label}</strong>. Change it in the
                        Plan queue below; /business, the vertical pages and the signup wizard follow
                        immediately — no deploy. Businesses already paid keep their locked rate until their
                        term ends.
                      </p>
                      {/* A seat cap makes the queue advance on its own, which
                          moves the price with nobody deciding it. Say so beside
                          the live price, where it is read. */}
                      {(() => {
                        const capped = planRows.find(p => p.code === activePlan.code && p.max_signups != null)
                        const next = planRows
                          .filter(p => p.is_enabled && p.sequence > activePlan.sequence)
                          .sort((a, b) => a.sequence - b.sequence)[0]
                        return capped ? (
                          <div className="bg-amber-50 text-amber-800 text-xs rounded-lg p-3 mb-3">
                            <strong>This price will change by itself.</strong> After {capped.seats_left ?? 0} more
                            signup{(capped.seats_left ?? 0) === 1 ? '' : 's'} this plan stops being offered
                            {next && <> and new businesses are quoted <strong>{next.mode === 'pincode_tiers'
                              ? 'the per-pincode tiers' : `₹${Number(next.monthly_price ?? 0).toLocaleString('en-IN')}/mo`}</strong> on {next.label}</>}.
                            {' '}Clear the seat cap in the table below to stop that.
                          </div>
                        ) : (
                          <div className="bg-gray-50 text-gray-600 text-xs rounded-lg p-3 mb-3">
                            No seat cap is set, so <strong>nothing changes this price but you</strong>. Change it in
                            the Plan queue as often as you like — it only ever affects businesses who sign up
                            afterwards.
                          </div>
                        )
                      })()}
                      <div className="flex gap-2 flex-wrap items-baseline">
                        <span className="text-2xl font-bold text-gray-400">₹</span>
                        <span className="text-3xl font-bold text-navy-700 tabular-nums">
                          {Number(activePlan.monthly_price ?? 0).toLocaleString('en-IN')}
                        </span>
                        <span className="text-sm text-gray-500">per month</span>
                      </div>
                      {/* How a hospital's headcount multiplies that price. Sits
                          beside the price because the two together are the bill,
                          and separating them is how "₹1,000 for 3 doctors"
                          happened. */}
                      <div className="mt-4 pt-4 border-t">
                        <label className="text-xs font-medium text-gray-600 mb-1 block">
                          Hospitals with several doctors
                        </label>
                        <select className="input-field text-sm max-w-md"
                          value={activePlan.doctor_billing ?? 'none'}
                          onChange={e => runPricingAction('updatePlan',
                            { planCode: activePlan.code, patch: { doctor_billing: e.target.value } },
                            'Hospital billing updated.')}>
                          <option value="per_doctor">Charge the full price per doctor</option>
                          <option value="base_plus_extra">Include some doctors, charge for the rest</option>
                          <option value="none">Ignore how many doctors — one price per hospital</option>
                        </select>
                        {/* Worked for a 3-doctor hospital, from the same helper
                            the wizard and the clinic dashboard use — so this
                            preview cannot describe a model the site is not
                            actually applying. */}
                        <p className="text-xs text-gray-500 mt-2">
                          {describeHeadcount(activePlan, 3)
                            ?? 'Every hospital pays the same regardless of how many doctors it lists.'}
                          {' '}Solo listings are unaffected.
                        </p>
                      </div>

                      {/* The business's-eye view of the live price, so GST is
                          never a surprise at the payment screen. */}
                      <p className="text-xs text-gray-500 mt-3">
                        A business sees <strong>₹{Number(activePlan.monthly_price ?? 0).toLocaleString('en-IN')}/month</strong>
                        {taxSettings?.gst_enabled && taxSettings?.gstin
                          ? <> and pays <strong>₹{Math.round(Number(activePlan.monthly_price ?? 0) * (1 + Number(taxSettings.gst_rate ?? 18) / 100)).toLocaleString('en-IN')}</strong> for one month, including {Number(taxSettings.gst_rate ?? 18)}% GST.</>
                          : <> — GST is currently switched off, so that is the whole amount charged.</>}
                      </p>
                    </div>
                  )}

                  {/* Plan queue */}
                  <div className="card shadow-sm">
                    <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                      <h3 className="font-bold text-navy-700">Plan queue</h3>
                      <div className="flex gap-2">
                        <button onClick={() => runPricingAction('activate', { planCode: null }, 'Override cleared — following the queue again.')}
                          disabled={pricingBusy}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50">
                          Clear override (auto)
                        </button>
                        <button onClick={() => setShowNewPlan(v => !v)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1">
                          <Plus className="w-3.5 h-3.5" /> New plan
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 mb-4">
                      Without an override, the first enabled plan with seats left is used — so the queue advances by
                      itself when a launch offer fills up. "Use this" pins one plan until you clear it.
                    </p>

                    {showNewPlan && (
                      <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">Code (permanent)</label>
                            <input className="input-field text-sm" placeholder="festive_1500"
                              value={newPlan.code}
                              onChange={e => setNewPlan(p => ({ ...p, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">Name (shown on /business)</label>
                            <input className="input-field text-sm" placeholder="Festive offer"
                              value={newPlan.label} onChange={e => setNewPlan(p => ({ ...p, label: e.target.value }))} />
                            <p className="text-[11px] text-gray-400 mt-1">
                              A name, not a price. The ₹ figure is rendered from the field below, so a price typed
                              here would contradict it the next time you change the rate — it is rejected.
                            </p>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
                            <input className="input-field text-sm" placeholder="One line of sales copy for the pricing card"
                              value={newPlan.description} onChange={e => setNewPlan(p => ({ ...p, description: e.target.value }))} />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">Pricing mode</label>
                            <select className="input-field text-sm" value={newPlan.mode}
                              onChange={e => setNewPlan(p => ({ ...p, mode: e.target.value }))}>
                              <option value="flat_all_pincodes">Flat — all pincodes included</option>
                              <option value="flat_per_pincode">Flat — per pincode</option>
                              <option value="pincode_tiers">By pincode population tier</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">
                              ₹ per month {newPlan.mode === 'pincode_tiers' && <span className="text-gray-400">(tier prices apply)</span>}
                            </label>
                            <input className="input-field text-sm" type="number" min={0}
                              disabled={newPlan.mode === 'pincode_tiers'}
                              value={newPlan.monthly_price}
                              onChange={e => setNewPlan(p => ({ ...p, monthly_price: e.target.value }))} />
                          </div>
                          {/* default_months only badges one option as best value.
                              Checkout always opens at the minimum, so nobody is
                              pre-committed to a term they did not choose. */}
                          {([['default_months', 'Highlight term as "best value" (= min for none)'],
                             ['min_months', 'Shortest term a business may buy'],
                             ['max_months', 'Longest term a business may buy'],
                             ['max_signups', 'Seat cap (blank = unlimited)'],
                             ['sequence', 'Queue position']] as const).map(([f, label]) => (
                            <div key={f}>
                              <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
                              <input className="input-field text-sm" type="number" min={0}
                                value={newPlan[f]} onChange={e => setNewPlan(p => ({ ...p, [f]: e.target.value }))} />
                            </div>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input type="checkbox" className="w-4 h-4 accent-teal-600"
                            checked={newPlan.suspend_commission}
                            onChange={e => setNewPlan(p => ({ ...p, suspend_commission: e.target.checked }))} />
                          Applies to every category, suspending commission while it runs
                        </label>
                        <p className="text-xs text-gray-400">
                          Created disabled and at the back of the queue, so it cannot go live by accident. Enable it,
                          then press "Use this" when you want it live.
                        </p>
                        <div className="flex gap-2">
                          <button disabled={pricingBusy || !newPlan.code || !newPlan.label}
                            onClick={() => {
                              const p = newPlan
                              setShowNewPlan(false)
                              setNewPlan({ code: '', label: '', description: '', mode: 'flat_all_pincodes',
                                monthly_price: '', default_months: '1', min_months: '1', max_months: '12',
                                max_signups: '', suspend_commission: false, sequence: '900' })
                              runPricingAction('createPlan', {
                                code: p.code, label: p.label, description: p.description, mode: p.mode,
                                monthly_price: p.monthly_price === '' ? null : Number(p.monthly_price),
                                default_months: Number(p.default_months), min_months: Number(p.min_months),
                                max_months: Number(p.max_months),
                                max_signups: p.max_signups === '' ? null : Number(p.max_signups),
                                suspend_commission: p.suspend_commission, sequence: Number(p.sequence),
                              }, `Plan ${p.code} created (disabled).`)
                            }}
                            className="btn-teal text-sm py-2 px-4 disabled:opacity-50">Create plan</button>
                          <button onClick={() => setShowNewPlan(false)}
                            className="text-sm text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100">Cancel</button>
                        </div>
                      </div>
                    )}
                    <ScrollableTable>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 border-b">
                            <th className="pb-2 px-2">#</th>
                            <th className="pb-2 px-2">Plan</th>
                            <th className="pb-2 px-2">Mode</th>
                            <th className="pb-2 px-2">₹/month</th>
                            <th className="pb-2 px-2" title="highlighted / shortest / longest — checkout opens at the shortest">
                              Months (best-value/min/max)
                            </th>
                            <th className="pb-2 px-2">Seats</th>
                            <th className="pb-2 px-2">Enrolled</th>
                            <th className="pb-2 px-2 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {planRows.map(p => {
                            const d = planDraft[p.code] || {}
                            const val = (k: keyof PlanRow) => d[k] ?? String(p[k] ?? '')
                            const setD = (k: string, v: string) =>
                              setPlanDraft(s => ({ ...s, [p.code]: { ...(s[p.code] || {}), [k]: v } }))
                            const dirty = Object.keys(d).length > 0
                            return (
                              <tr key={p.code} className={`border-b last:border-0 ${p.is_currently_active ? 'bg-teal-50/50' : ''}`}>
                                <td className="py-3 px-2 text-gray-400">{p.sequence}</td>
                                <td className="py-3 px-2">
                                  <div className="font-semibold text-navy-700">{p.label}</div>
                                  <div className="text-xs text-gray-400 font-mono">{p.code}</div>
                                  {p.is_currently_active && <span className="text-[10px] font-bold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded">LIVE</span>}
                                  {!p.is_enabled && <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded ml-1">DISABLED</span>}
                                  {p.suspend_commission && <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded ml-1">no commission</span>}
                                </td>
                                <td className="py-3 px-2 text-xs text-gray-500">{p.mode.replace(/_/g, ' ')}</td>
                                <td className="py-3 px-2">
                                  {p.mode === 'pincode_tiers' ? (
                                    <span className="text-xs text-gray-400">by tier</span>
                                  ) : (
                                    <input className="input-field w-24 text-sm" type="number" min={0}
                                      value={val('monthly_price')} onChange={e => setD('monthly_price', e.target.value)} />
                                  )}
                                </td>
                                <td className="py-3 px-2">
                                  <div className="flex gap-1">
                                    {(['default_months', 'min_months', 'max_months'] as const).map(f => (
                                      <input key={f} className="input-field w-14 text-sm" type="number" min={1} title={f}
                                        value={val(f)} onChange={e => setD(f, e.target.value)} />
                                    ))}
                                  </div>
                                </td>
                                <td className="py-3 px-2">
                                  <input className="input-field w-20 text-sm" type="number" min={0} placeholder="∞"
                                    value={d.max_signups ?? (p.max_signups == null ? '' : String(p.max_signups))}
                                    onChange={e => setD('max_signups', e.target.value)} />
                                  <div className="text-[11px] text-gray-400 mt-1">
                                    {p.signups_used ?? 0} used{p.seats_left != null && ` · ${p.seats_left} left`}
                                  </div>
                                </td>
                                {/* "Enrolled" is the number that decides whether a plan can be
                                    retired: businesses still inside a term they paid for. */}
                                <td className="py-3 px-2">
                                  <div className={`font-bold ${(p.active_enrolled ?? 0) > 0 ? 'text-navy-700' : 'text-gray-300'}`}>
                                    {p.active_enrolled ?? 0}
                                  </div>
                                  <div className="text-[11px] text-gray-400">
                                    {(p.expired_enrolled ?? 0) > 0 && `${p.expired_enrolled} expired`}
                                    {(p.active_enrolled ?? 0) === 0 && (p.expired_enrolled ?? 0) === 0
                                      && (p.signups_used ?? 0) === 0 && 'never used'}
                                  </div>
                                </td>
                                <td className="py-3 px-2">
                                  <div className="flex gap-1 justify-center flex-wrap">
                                    <button onClick={() => runPricingAction('activate', { planCode: p.code }, `${p.label} is now live.`)}
                                      disabled={pricingBusy}
                                      className="text-xs font-medium px-2 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 disabled:opacity-50">
                                      Use this
                                    </button>
                                    <button onClick={() => runPricingAction('updatePlan',
                                      { planCode: p.code, patch: { is_enabled: !p.is_enabled } },
                                      `${p.label} ${p.is_enabled ? 'disabled' : 'enabled'}.`)}
                                      disabled={pricingBusy}
                                      className="text-xs font-medium px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50">
                                      {p.is_enabled ? 'Disable' : 'Enable'}
                                    </button>
                                    {/* Deleting is offered only when nobody has ever been on
                                        the plan; otherwise its history has to stay readable. */}
                                    {p.can_delete && !p.is_currently_active && (
                                      <button onClick={() => runPricingAction('deletePlan', { planCode: p.code },
                                        `Plan ${p.code} deleted.`)}
                                        disabled={pricingBusy}
                                        className="text-xs font-medium px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 disabled:opacity-50">
                                        Delete
                                      </button>
                                    )}
                                    {dirty && (
                                      <button onClick={() => {
                                        const patch: Record<string, unknown> = {}
                                        if (d.monthly_price !== undefined) patch.monthly_price = Number(d.monthly_price)
                                        if (d.default_months !== undefined) patch.default_months = Number(d.default_months)
                                        if (d.min_months !== undefined) patch.min_months = Number(d.min_months)
                                        if (d.max_months !== undefined) patch.max_months = Number(d.max_months)
                                        if (d.max_signups !== undefined)
                                          patch.max_signups = d.max_signups === '' ? null : Number(d.max_signups)
                                        setPlanDraft(s => { const n = { ...s }; delete n[p.code]; return n })
                                        runPricingAction('updatePlan', { planCode: p.code, patch }, `${p.label} updated.`)
                                      }} disabled={pricingBusy}
                                        className="text-xs font-bold px-2 py-1.5 rounded-lg bg-navy-700 hover:bg-navy-600 text-white disabled:opacity-50">
                                        Save
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </ScrollableTable>
                  </div>

                  {/* Pincode tier prices — used when a pincode_tiers plan is live */}
                  <div className="card shadow-sm">
                    <h3 className="font-bold text-navy-700 mb-1">Pincode tier prices</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Only used while a "pincode tiers" plan is live. Changing these updates the public pricing page
                      immediately — no deploy.
                    </p>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {tierRows.map(tr => (
                        <div key={tr.tier_number} className="border border-gray-200 rounded-xl p-3">
                          <div className="text-xs text-gray-500">Tier {tr.tier_number} · {tr.tier_name}</div>
                          <div className="flex gap-2 mt-2">
                            <input className="input-field text-sm" type="number" min={0}
                              value={tierDraft[tr.tier_number] ?? String(tr.monthly_price)}
                              onChange={e => setTierDraft(s => ({ ...s, [tr.tier_number]: e.target.value }))} />
                            {tierDraft[tr.tier_number] !== undefined
                              && tierDraft[tr.tier_number] !== String(tr.monthly_price) && (
                              <button onClick={() => {
                                const v = Number(tierDraft[tr.tier_number])
                                setTierDraft(s => { const n = { ...s }; delete n[tr.tier_number]; return n })
                                runPricingAction('updateTier', { tierNumber: tr.tier_number, monthlyPrice: v },
                                  `${tr.tier_name} set to ₹${v.toLocaleString('en-IN')}/mo.`)
                              }} disabled={pricingBusy}
                                className="text-xs font-bold px-2 rounded-lg bg-navy-700 text-white disabled:opacity-50">Save</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Per-vertical: monthly and commission are independent switches */}
                  <div className="card shadow-sm">
                    <h3 className="font-bold text-navy-700 mb-1">Billing by category</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Monthly fee and commission are separate — a category can have both. Turn on a commission for
                      doctors or hospitals (say, on surgeries) without changing what they pay monthly.
                      {activePlan?.suspend_commission && (
                        <strong className="text-amber-700"> The live plan currently suspends all commission.</strong>
                      )}
                    </p>
                    <ScrollableTable>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 border-b">
                            <th className="pb-2 px-2">Category</th>
                            <th className="pb-2 px-2 text-center">Monthly fee</th>
                            <th className="pb-2 px-2 text-center">Commission</th>
                            <th className="pb-2 px-2">%</th>
                            <th className="pb-2 px-2">Applies to</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billingPlans.map(v => (
                            <tr key={v.vertical} className="border-b last:border-0">
                              <td className="py-3 px-2">
                                <div className="font-semibold text-navy-700 capitalize">{v.vertical}</div>
                                <div className="text-[11px] text-gray-400 font-mono">{v.db_speciality}</div>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <input type="checkbox" className="w-4 h-4 accent-teal-600" checked={v.monthly_enabled !== false}
                                  onChange={e => runPricingAction('updateVerticalBilling',
                                    { vertical: v.vertical, patch: { monthly_enabled: e.target.checked } },
                                    `${v.vertical}: monthly fee ${e.target.checked ? 'on' : 'off'}.`)} />
                              </td>
                              <td className="py-3 px-2 text-center">
                                <input type="checkbox" className="w-4 h-4 accent-teal-600" checked={Boolean(v.commission_enabled)}
                                  onChange={e => runPricingAction('updateVerticalBilling',
                                    { vertical: v.vertical, patch: { commission_enabled: e.target.checked } },
                                    `${v.vertical}: commission ${e.target.checked ? 'on' : 'off'}.`)} />
                              </td>
                              <td className="py-3 px-2">
                                <div className="flex gap-1">
                                  <input className="input-field w-16 text-sm" type="number" min={0} max={100} step={0.5}
                                    value={vbDraft[v.vertical] ?? String(Number(v.commission_percent ?? 0))}
                                    onChange={e => setVbDraft(s => ({ ...s, [v.vertical]: e.target.value }))} />
                                  {vbDraft[v.vertical] !== undefined
                                    && vbDraft[v.vertical] !== String(Number(v.commission_percent ?? 0)) && (
                                    <button onClick={() => {
                                      const pct = Number(vbDraft[v.vertical])
                                      setVbDraft(s => { const n = { ...s }; delete n[v.vertical]; return n })
                                      runPricingAction('updateVerticalBilling',
                                        { vertical: v.vertical, patch: { commission_percent: pct } },
                                        `${v.vertical}: commission set to ${pct}%.`)
                                    }} disabled={pricingBusy}
                                      className="text-xs font-bold px-2 rounded-lg bg-navy-700 text-white disabled:opacity-50">Save</button>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-2 text-xs text-gray-500 max-w-xs">{v.commission_basis || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollableTable>
                  </div>


                  {/* GST identity — what appears on every invoice we issue */}
                  <div className="card shadow-sm">
                    <h3 className="font-bold text-navy-700 mb-1">GST &amp; invoicing</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      These details go on every tax invoice. GST cannot be switched on until the GSTIN and legal name
                      are filled in — an invoice without a supplier GSTIN is not a valid tax invoice.
                    </p>
                    {taxSettings ? (
                      <>
                        <div className={`rounded-xl p-3 mb-4 text-sm ${taxSettings.gst_enabled ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'}`}>
                          {taxSettings.gst_enabled
                            ? `GST is ON — ${Number(taxSettings.gst_rate ?? 18)}% is added to every new listing charge.`
                            : 'GST is OFF — prices are charged with no tax and invoices carry no GST lines.'}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {([
                            ['legal_name', 'Registered legal name'],
                            ['gstin', 'GSTIN (15 characters)'],
                            ['registered_address', 'Registered address'],
                            ['city', 'City'],
                            ['pin_code', 'PIN code'],
                            ['sac_code', 'SAC code'],
                            ['gst_rate', 'GST rate %'],
                            ['invoice_prefix', 'Invoice number prefix'],
                          ] as const).map(([field, label]) => (
                            <div key={field}>
                              <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
                              <input className="input-field text-sm"
                                value={taxDraft[field] ?? String((taxSettings as unknown as Record<string, unknown>)[field] ?? '')}
                                onChange={e => setTaxDraft(d => ({ ...d, [field]: e.target.value }))} />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-4 flex-wrap items-center">
                          <button disabled={pricingBusy || Object.keys(taxDraft).length === 0}
                            onClick={() => {
                              const patch: Record<string, unknown> = { ...taxDraft }
                              if (patch.gst_rate !== undefined) patch.gst_rate = Number(patch.gst_rate)
                              setTaxDraft({})
                              runPricingAction('updateTaxSettings', { patch }, 'GST details saved.')
                            }}
                            className="btn-teal text-sm py-2 px-4 disabled:opacity-50">Save GST details</button>
                          <button disabled={pricingBusy}
                            onClick={() => runPricingAction('updateTaxSettings',
                              { patch: { gst_enabled: !taxSettings.gst_enabled } },
                              taxSettings.gst_enabled ? 'GST switched off.' : 'GST switched on.')}
                            className={`text-sm font-semibold py-2 px-4 rounded-lg disabled:opacity-50 ${taxSettings.gst_enabled ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>
                            {taxSettings.gst_enabled ? 'Switch GST off' : 'Switch GST on'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 py-4">
                        No tax settings row — run migration 0007.
                      </p>
                    )}
                  </div>

                  {/* Invoice register */}
                  <div className="card shadow-sm">
                    <h3 className="font-bold text-navy-700 mb-1">Invoices</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Every invoice issued, newest first. Numbers are consecutive per financial year, as GST requires.
                    </p>

                    {invoiceMonths.length > 0 && (
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                        {invoiceMonths.slice(0, 4).map(m => (
                          <div key={m.month} className="border border-gray-200 rounded-xl p-3">
                            <div className="text-xs text-gray-500">{m.month}</div>
                            <div className="font-bold text-navy-700">₹{Number(m.total_collected ?? 0).toLocaleString('en-IN')}</div>
                            <div className="text-[11px] text-gray-400">
                              {m.invoices} invoices · ₹{Number(m.tax_collected ?? 0).toLocaleString('en-IN')} tax
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {invoices.length === 0 ? (
                      <p className="text-sm text-gray-400 py-6 text-center">
                        No invoices yet. One is issued automatically when a payment succeeds.
                      </p>
                    ) : (
                      <ScrollableTable>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-500 border-b">
                              <th className="pb-2 px-2">Invoice</th>
                              <th className="pb-2 px-2">Date</th>
                              <th className="pb-2 px-2">Business</th>
                              <th className="pb-2 px-2">GSTIN</th>
                              <th className="pb-2 px-2 text-right">Taxable</th>
                              <th className="pb-2 px-2 text-right">Tax</th>
                              <th className="pb-2 px-2 text-right">Total</th>
                              <th className="pb-2 px-2">Sent</th>
                              <th className="pb-2 px-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map(iv => (
                              <tr key={iv.id} className="border-b last:border-0">
                                <td className="py-2.5 px-2 font-mono text-xs text-navy-700">{iv.invoice_number}</td>
                                <td className="py-2.5 px-2 text-xs text-gray-500">{iv.invoice_date}</td>
                                <td className="py-2.5 px-2">{iv.recipient_name || '—'}</td>
                                <td className="py-2.5 px-2 font-mono text-[11px] text-gray-500">
                                  {iv.recipient_gstin || <span className="text-gray-300">B2C</span>}
                                </td>
                                <td className="py-2.5 px-2 text-right">₹{Number(iv.taxable_value).toLocaleString('en-IN')}</td>
                                <td className="py-2.5 px-2 text-right text-gray-500">
                                  {Number(iv.tax_total) > 0
                                    ? `₹${Number(iv.tax_total).toLocaleString('en-IN')}`
                                    : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="py-2.5 px-2 text-right font-semibold">₹{Number(iv.total_amount).toLocaleString('en-IN')}</td>
                                <td className="py-2.5 px-2 text-[11px] text-gray-400">
                                  {iv.sent_whatsapp_at ? 'WA' : ''}{iv.sent_whatsapp_at && iv.sent_email_at ? ' + ' : ''}{iv.sent_email_at ? 'email' : ''}
                                  {!iv.sent_whatsapp_at && !iv.sent_email_at ? 'not sent' : ''}
                                </td>
                                <td className="py-2.5 px-2">
                                  <a href={`/invoice/${iv.public_token}`} target="_blank" rel="noreferrer"
                                     className="text-xs font-semibold text-teal-600 hover:text-teal-700">Open</a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ScrollableTable>
                    )}
                  </div>

                  {/* Audit — the admin password is public, so changes are logged */}
                  {planEvents.length > 0 && (
                    <div className="card shadow-sm">
                      <h3 className="font-bold text-navy-700 mb-1">Recent pricing changes</h3>
                      <p className="text-sm text-gray-500 mb-3">Every change is logged. Check here if a price looks wrong.</p>
                      <div className="space-y-1.5">
                        {planEvents.map(ev => (
                          <div key={ev.id} className="flex gap-3 text-xs text-gray-600 border-b border-gray-100 pb-1.5 last:border-0">
                            <span className="text-gray-400 whitespace-nowrap">{new Date(ev.created_at).toLocaleString('en-IN')}</span>
                            <span className="font-semibold">{ev.action}</span>
                            {ev.plan_code && <span className="font-mono text-gray-400">{ev.plan_code}</span>}
                            <span className="text-gray-400">by {ev.actor || 'admin'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'reports' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-navy-700">Reports</h2>
                  <p className="text-sm text-gray-500">
                    What is happening across the platform, and where to go next.
                  </p>
                </div>
                <RangePicker value={repDays} onChange={setRepDays} />
              </div>

              {repLoading ? (
                <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <StatTile label="Visitors" value={pTotal('visitors')} sub="distinct sessions" />
                    <StatTile label="Searches" value={pTotal('searches')} />
                    <StatTile label="Profiles opened" value={pTotal('profile_views')} />
                    <StatTile label="WhatsApp taps" value={pTotal('whatsapp_clicks')} />
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <StatTile label="Business signups started" value={pTotal('business_leads')} />
                    <StatTile label="Listings created" value={pTotal('new_listings')} />
                    <StatTile label="Appointments booked" value={pTotal('bookings')} />
                    <StatTile label="Doctors live now" value={doctors.filter(d => d.status === 'active').length} />
                  </div>

                  <div className="card shadow-sm">
                    <ColumnChart title="Visitors per day" height={150}
                      data={platform.map(r => ({ label: dLabel(r.day), value: r.visitors }))} />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="card shadow-sm">
                      <ColumnChart title="Searches per day" height={120}
                        data={platform.map(r => ({ label: dLabel(r.day), value: r.searches }))} />
                    </div>
                    <div className="card shadow-sm">
                      <ColumnChart title="Business signups started per day" height={120}
                        data={platform.map(r => ({ label: dLabel(r.day), value: r.business_leads }))} />
                    </div>
                  </div>

                  {/* The expansion argument: what people looked for against what
                      we could actually offer them. Amber rows have no listing at
                      all, and say so in words as well as colour. */}
                  <div className="card shadow-sm">
                    <BarList
                      title="What patients searched for — and whether we had anyone"
                      data={demand.slice(0, 15).map(d => ({
                        label: `${specName(d.speciality)} · ${d.area_name}`,
                        value: d.searches,
                        hint: d.active_listings === 0
                          ? 'no listings'
                          : `${d.active_listings} listed`,
                      }))}
                      alertWhen={d => d.hint === 'no listings'} />
                    <p className="text-xs text-gray-500 mt-4">
                      Rows in amber are searches we could not answer. A high count there is the case for
                      recruiting in that area, or for entering that town at all.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'account' && (
            <div className="space-y-6 max-w-xl">
              <div>
                <h2 className="text-2xl font-bold text-navy-700">Account</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Signed in as <strong>{adminEmail || '…'}</strong>
                </p>
              </div>

              <div className="card shadow-sm">
                <h3 className="font-bold text-navy-700 mb-1">Change password</h3>
                <p className="text-sm text-gray-500 mb-4">
                  This is the password for the admin dashboard. It is stored hashed by Supabase — nobody, including
                  me, can read it back, so pick something you will not lose.
                </p>

                {(pwMsg || pwErr) && (
                  <div className={`rounded-xl p-3 text-sm mb-4 ${pwErr ? 'bg-red-50 text-red-600' : 'bg-teal-50 text-teal-700'}`}>
                    {pwErr || pwMsg}
                  </div>
                )}

                <div className="space-y-3">
                  {([
                    ['current', 'Current password', 'current-password'],
                    ['next', 'New password', 'new-password'],
                    ['confirm', 'New password again', 'new-password'],
                  ] as const).map(([field, label, ac]) => (
                    <div key={field}>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
                      <input className="input-field" type="password" autoComplete={ac}
                        value={pw[field]}
                        onChange={e => setPw(p => ({ ...p, [field]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') changePassword() }} />
                    </div>
                  ))}
                  {/* Say the rule before it is broken, not after. */}
                  <p className={`text-xs ${pw.next && pw.next.length < 12 ? 'text-amber-600' : 'text-gray-400'}`}>
                    At least 12 characters. A short phrase you will remember beats a short jumble you will not.
                  </p>
                </div>

                <button onClick={changePassword}
                  disabled={pwBusy || !pw.current || !pw.next || !pw.confirm}
                  className="btn-teal text-sm py-2 px-5 mt-4 disabled:opacity-50">
                  {pwBusy ? 'Saving…' : 'Change password'}
                </button>
              </div>

              <div className="card shadow-sm">
                <h3 className="font-bold text-navy-700 mb-1">Sign out everywhere</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Ends every signed-in session for this account on every device, including this one. Use it if a
                  phone or laptop that was signed in is lost — changing the password alone does not close sessions
                  that are already open.
                </p>
                <button onClick={signOutEverywhere} disabled={pwBusy}
                  className="text-sm font-semibold py-2 px-5 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50">
                  Sign out everywhere
                </button>
              </div>
            </div>
          )}

          {tab === 'sandbox' && isSandbox() && <SandboxPanel onPurged={load} />}
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
