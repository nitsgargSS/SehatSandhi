import { useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { router } from 'expo-router'
import { useSession, ROLE_WORD } from '../../../lib/session'
import { supabase } from '../../../lib/supabase'
import { unregisterPush } from '../../../lib/push'
import { Btn, Card, Chip, Label, Note } from '../../../ui/kit'
import NewPassword from '../../../ui/NewPassword'
import { C } from '../../../ui/theme'

// Who is signed in, which clinic (switch if more than one), log out.
export default function Me() {
  const { s, pick, push } = useSession()
  const [pw, setPw] = useState<'closed' | 'open' | 'saved'>('closed')
  return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Card>
        {/* No name on the account (an owner without a doctor profile) → the
            email is the heading, once, not a heading and a repeat below it. */}
        <Text style={st.name}>{s?.name || s?.email}</Text>
        {!!s?.name && <Text style={st.meta}>{s.email}</Text>}
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
      {!!s?.clinic && !['pharmacy', 'ambulance', 'insurance'].includes(s.clinic.vertical) && !['delivery', 'driver'].includes(s.role.role ?? '') && (
        <Card>
          <Label>Money</Label>
          <Text style={st.meta}>What was taken today by cash, UPI and card, by whom, and who still owes.</Text>
          <Btn small kind="ghost" label="Collections & dues" onPress={() => router.push('/collections')} />
        </Card>
      )}
      <Card>
        <Label>Password</Label>
        {pw === 'open' ? (
          <>
            <NewPassword onDone={() => setPw('saved')} />
            <Btn small kind="ghost" label="Cancel" onPress={() => setPw('closed')} />
          </>
        ) : (
          <>
            <Text style={st.meta}>{pw === 'saved' ? '✓ Password saved. Sign in with it, or with an emailed code.'
              : 'Set one, or change it. You can always sign in with an emailed code instead.'}</Text>
            <Btn small kind="ghost" label="Set or change password" onPress={() => setPw('open')} />
          </>
        )}
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
