import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { getMyRole } from '@web/lib/identityApi'
import { getBoard, QueueEntry } from '@web/lib/queueApi'
import { C } from '../ui/theme'

// Step 1's proof: the website's own data layer, running on the phone — who is
// signed in, at which clinic, in what role, and today's queue, by the same
// calls the dashboard makes. Consult, patients and IPD come next.
const ROLE: Record<string, string> = { owner: 'Owner', doctor: 'Doctor', nurse: 'Nurse', receptionist: 'Reception', manager: 'Manager' }

export default function Home() {
  const [me, setMe] = useState<{ name: string; email: string } | null>(null)
  const [clinic, setClinic] = useState<{ id: string; name: string } | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      const { data: p } = await supabase.from('practitioners').select('full_name').eq('auth_uid', user.id).maybeSingle()
      setMe({ name: (p as { full_name?: string } | null)?.full_name ?? '', email: user.email ?? '' })
      const { data: ids, error } = await supabase.rpc('sehat_caller_business_ids')
      if (error) throw new Error(error.message)
      const { data: biz } = await supabase.from('businesses').select('id, name')
        .in('id', (ids as string[]) ?? []).order('created_at').limit(1)
      const b = (biz ?? [])[0] as { id: string; name: string } | undefined
      setClinic(b ?? null)
      if (!b) return
      setRole((await getMyRole(b.id)).role)
      setQueue(await getBoard(b.id))
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const waiting = queue.filter(q => q.status === 'waiting' || q.status === 'called').length
  const seen = queue.filter(q => q.status === 'completed').length

  return (
    <ScrollView contentContainerStyle={s.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={s.card}>
        <Text style={s.who}>{me?.name || me?.email}{role ? ` · ${ROLE[role] ?? role}` : ''}</Text>
        <Text style={s.clinic}>{clinic?.name ?? (loading ? '…' : 'No clinic linked to this login')}</Text>
      </View>
      {!!err && <Text style={{ color: C.danger }}>{err}</Text>}
      {clinic && (
        <View style={s.card}>
          <Text style={s.label}>Today's queue</Text>
          <Text style={s.big}>{waiting} waiting · {seen} seen</Text>
          {queue.length === 0 && <Text style={s.row}>Nobody in the queue yet. Pull down to refresh.</Text>}
          {queue.slice(0, 10).map(q => (
            <Text key={q.id} style={s.row}>#{q.token_number} {q.patient_name} · {q.status.replace('_', ' ')}</Text>
          ))}
        </View>
      )}
      <Pressable style={s.out} onPress={async () => { await supabase.auth.signOut(); router.replace('/') }}>
        <Text style={{ color: C.muted, fontWeight: '700' }}>Log out</Text>
      </Pressable>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 4 },
  who: { fontSize: 14, fontWeight: '700', color: C.muted },
  clinic: { fontSize: 20, fontWeight: '800', color: C.ink },
  label: { fontSize: 12, fontWeight: '800', color: C.muted, textTransform: 'uppercase' },
  big: { fontSize: 18, fontWeight: '800', color: C.ink, marginBottom: 6 },
  row: { fontSize: 14, color: C.ink, paddingVertical: 3 },
  out: { alignItems: 'center', padding: 14 },
})
