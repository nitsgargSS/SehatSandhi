import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { checkPassword, passwordProblem, passwordSaveError } from '@web/lib/credentials'
import { markPasswordChanged } from '@web/lib/passwordState'
import { Btn, Field } from './kit'
import { C } from './theme'

// Choose a password for the signed-in account — the website's rules, ticked off
// while typing (src/lib/credentials.ts mirrors Supabase's policy, so a full set
// of ticks is a password Supabase accepts). Used after an emailed code on the
// login screen, on the Me tab, and when a password has expired: many staff have
// only a phone, so nothing about a password may need the computer.
export default function NewPassword({ onDone, label = 'Save password' }: { onDone: () => void; label?: string }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const rules = checkPassword(pw).rules

  const save = async () => {
    const problem = passwordProblem(pw, confirm)
    if (problem) { setErr(problem); return }
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) { setErr(passwordSaveError(error)); return }
      // Restarts the expiry clock (0080); missed, they are asked again next time.
      await markPasswordChanged().catch(() => {})
      setPw(''); setConfirm('')
      onDone()
    } finally { setBusy(false) }
  }

  return (
    <View style={{ gap: 10 }}>
      <Field label="New password" secureTextEntry autoComplete="new-password" textContentType="newPassword"
        value={pw} onChangeText={setPw} />
      <Field label="New password again" secureTextEntry autoComplete="new-password" textContentType="newPassword"
        value={confirm} onChangeText={setConfirm} />
      <View style={{ gap: 2 }}>
        {rules.map(r => <Text key={r.label} style={[st.rule, r.met && st.met]}>{r.met ? '✓ ' : '• '}{r.label}</Text>)}
        <Text style={[st.rule, !!confirm && confirm === pw && st.met]}>{confirm && confirm === pw ? '✓ ' : '• '}Both passwords match</Text>
      </View>
      {!!err && <Text style={{ color: C.danger }}>{err}</Text>}
      <Btn label={label} busy={busy} onPress={save} />
    </View>
  )
}

const st = StyleSheet.create({
  rule: { fontSize: 13, color: C.muted },
  met: { color: C.green, fontWeight: '600' },
})
