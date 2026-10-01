import { ScrollView, StyleSheet, Text } from 'react-native'
import { router } from 'expo-router'
import { useSession, ROLE_WORD } from '../../../lib/session'
import { supabase } from '../../../lib/supabase'
import { unregisterPush } from '../../../lib/push'
import { Btn, Card, Chip, Label, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// Who is signed in, which clinic (switch if more than one), log out.
export default function Me() {
  const { s, pick, push } = useSession()
  return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Card>
        <Text style={st.name}>{s?.name || s?.email}</Text>
        <Text style={st.meta}>{s?.email}</Text>
        <Text style={st.meta}>{s?.role.role ? ROLE_WORD[s.role.role] ?? s.role.role : '—'} at {s?.clinic?.name ?? '—'}</Text>
      </Card>
      {(s?.clinics.length ?? 0) > 1 && (
        <Card>
          <Label>Your clinics</Label>
          {s!.clinics.map(c => <Chip key={c.id} label={c.name} on={c.id === s!.clinic?.id} onPress={() => pick(c.id)} />)}
        </Card>
      )}
      <Card>
        <Label>Alerts on this phone</Label>
        <Text style={st.meta}>{push.state === 'on' ? '✓ On — new patients in your queue and new appointments.'
          : push.state === 'checking' ? 'Checking…'
          : push.state === 'denied' ? 'Off — allow notifications for Sehatsandhi in your phone settings.'
          : `Not available here${push.why ? ` (${push.why})` : ''}.`}</Text>
      </Card>
      <Note>Billing, pharmacy, staff, plan and reports are on the computer at sehatsandhi.com.</Note>
      <Btn kind="ghost" label="Log out" onPress={async () => { await unregisterPush(); await supabase.auth.signOut(); router.replace('/') }} />
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12 },
  name: { fontSize: 20, fontWeight: '800', color: C.ink },
  meta: { fontSize: 14, color: C.muted },
})
