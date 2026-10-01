import { useEffect } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { C } from '../ui/theme'

// Two doors: patients find a doctor (no login, like the WhatsApp bot — a later
// step), businesses sign in with their website login. A saved session skips in.
export default function Start() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace('/queue') })
  }, [])
  return (
    <View style={s.wrap}>
      <Image source={require('../../assets/icon.png')} style={s.logo} />
      <Text style={s.title}>Sehatsandhi</Text>
      <Text style={s.sub}>स्वास्थ्य की नई साझेदारी</Text>
      <View style={[s.btn, s.ghost]}>
        <Text style={[s.btnText, { color: C.ink }]}>Find a doctor</Text>
        <Text style={s.soon}>coming next</Text>
      </View>
      <Pressable style={s.btn} onPress={() => router.push('/login')}>
        <Text style={s.btnText}>Business login</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  logo: { width: 96, height: 96, borderRadius: 20 },
  title: { fontSize: 28, fontWeight: '800', color: C.ink },
  sub: { fontSize: 14, color: C.muted, marginBottom: 24 },
  btn: { width: '100%', backgroundColor: C.green, paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  ghost: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  soon: { fontSize: 11, color: C.muted, marginTop: 2 },
})
