import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { router } from 'expo-router'
import { supabase } from './supabase'
import { getMyRole, isClinicalRole, mayPrescribe, type RoleLookup } from '@web/lib/identityApi'
import { getWards } from '@web/lib/admissionsApi'
import { registerPush, type PushState } from './push'
import { amAdmin } from './admin'

// Who is signed in and where — loaded once after login, used by every screen.
// The same rules as the website's dashboard (src/pages/doctor/Dashboard.tsx):
//   doctorId  — the signed-in person only when they are a doctor/owner here;
//               anything that means "the doctor" uses it (0178/0182 fixes).
//   clinical  — may open the medical record (owner, manager, doctor, nurse).
//   prescriber— may issue a prescription (owner, doctor).

export interface Session {
  userId: string
  email: string
  name: string
  practitionerId: string | null
  doctorId: string | null
  clinic: { id: string; name: string; vertical: string } | null
  clinics: { id: string; name: string; vertical: string }[]
  role: RoleLookup
  clinical: boolean
  prescriber: boolean
  /** The clinic has wards — the Beds tab shows. */
  hasWards: boolean
  /** On the Sehatsandhi admin list — the Admin tab shows. */
  isAdmin: boolean
  /** 0168: a clinic or hospital running its own lab (a lab business is vertical 'lab'). */
  labModule: boolean
}

export interface PushStatus { state: PushState | 'checking'; why?: string }

const Ctx = createContext<{ s: Session | null; loading: boolean; error: string; reload: () => void; pick: (id: string) => void; push: PushStatus }>({
  s: null, loading: true, error: '', reload: () => {}, pick: () => {}, push: { state: 'checking' },
})

export function SessionProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [push, setPush] = useState<PushStatus>({ state: 'checking' })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setS(null); router.replace('/'); return }
      const { data: p } = await supabase.from('practitioners').select('id, full_name').eq('auth_uid', user.id).maybeSingle()
      const me = p as { id: string; full_name: string | null } | null
      const { data: ids, error: e } = await supabase.rpc('sehat_caller_business_ids')
      if (e) throw new Error(e.message)
      const { data: biz } = await supabase.from('businesses').select('id, name, vertical, lab_module')
        .in('id', (ids as string[]) ?? []).order('created_at')
      const clinics = (biz ?? []) as { id: string; name: string; vertical: string; lab_module?: boolean | null }[]
      const clinic = clinics.find(c => c.id === picked) ?? clinics[0] ?? null
      const role: RoleLookup = clinic ? await getMyRole(clinic.id) : { role: null, enforced: true }
      const isDoctor = !role.enforced || role.role === 'doctor' || role.role === 'owner'
      const [wards, isAdmin] = await Promise.all([
        clinic ? getWards(clinic.id).catch(() => []) : Promise.resolve([]),
        amAdmin(user.id).catch(() => false),
      ])
      setS({
        userId: user.id, email: user.email ?? '', name: me?.full_name ?? '',
        practitionerId: me?.id ?? null,
        doctorId: me?.id && isDoctor ? me.id : null,
        clinic, clinics, role,
        clinical: isClinicalRole(role),
        prescriber: mayPrescribe(role) && !!me?.id,
        hasWards: wards.length > 0,
        isAdmin,
        labModule: !!clinic?.lab_module,
      })
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }, [picked])

  useEffect(() => { load() }, [load])
  // Register this phone for alerts once per sign-in.
  useEffect(() => { if (s?.userId) registerPush().then(setPush) }, [s?.userId])
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') router.replace('/') })
    return () => data.subscription.unsubscribe()
  }, [])

  return <Ctx.Provider value={{ s, loading, error, reload: load, pick: setPicked, push }}>{children}</Ctx.Provider>
}

export const useSession = () => useContext(Ctx)

export const ROLE_WORD: Record<string, string> = {
  owner: 'Owner', doctor: 'Doctor', nurse: 'Nurse', receptionist: 'Reception', manager: 'Manager',
  pharmacist: 'Pharmacist', delivery: 'Delivery', driver: 'Driver',
}
