import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native'
import { C } from './theme'

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[k.card, style]}>{children}</View>
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={k.label}>{children}</Text>
}

export function Btn({ label, onPress, kind = 'primary', busy, disabled, small }: {
  label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean; small?: boolean
}) {
  const bg = kind === 'primary' ? C.green : kind === 'danger' ? '#fdecea' : C.card
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? C.danger : C.ink
  return (
    <Pressable onPress={onPress} disabled={busy || disabled}
      style={({ pressed }) => [k.btn, small && k.small, { backgroundColor: bg, opacity: busy || disabled ? 0.5 : pressed ? 0.8 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: C.border }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[k.btnText, small && { fontSize: 13 }, { color: fg }]}>{label}</Text>}
    </Pressable>
  )
}

export function Field({ label, ...p }: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 4, flexGrow: 1 }}>
      {!!label && <Text style={k.fieldLabel}>{label}</Text>}
      <TextInput placeholderTextColor="#9aa59f" {...p} style={[k.input, p.multiline && { minHeight: 70, textAlignVertical: 'top' }, p.style]} />
    </View>
  )
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[k.chip, on && { backgroundColor: C.green, borderColor: C.green }]}>
      <Text style={{ color: on ? '#fff' : C.ink, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}

export const Err = ({ msg }: { msg?: string }) => msg ? <Text style={{ color: C.danger }}>{msg}</Text> : null
export const Note = ({ children }: { children: ReactNode }) => <Text style={{ color: C.muted, fontSize: 13 }}>{children}</Text>

/** dd/mm/yyyy ⇄ yyyy-mm-dd, for follow-up dates typed on a phone. */
export const toIso = (dmy: string): string | null => {
  const m = dmy.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}
export const toDmy = (iso: string | null | undefined): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''

const k = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border, gap: 8 },
  label: { fontSize: 12, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  btn: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  small: { paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { fontWeight: '800', fontSize: 15 },
  fieldLabel: { fontSize: 12.5, color: C.muted, fontWeight: '600' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff' },
})
