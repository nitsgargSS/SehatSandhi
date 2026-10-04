import { useEffect } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { C } from '../ui/theme'

// Two doors: patients find a doctor (no login, like the WhatsApp bot), and
// businesses sign in with their website login. A saved session skips in.
export default function Start() {
  useEffect(() => {
    // 0196: a saved patient session opens the patient's side; a business one the queue.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return
      const { error } = await supabase.rpc('sehat_me')
      router.replace(error ? '/queue' : '/me')
    })
  }, [])
  return (
    <View style={s.wrap}>
      <Image source={require('../../assets/logo-full.png')} style={s.logo} resizeMode="contain" accessibilityLabel="Sehatsandhi — स्वास्थ्य की नई साझेदारी" />
      <Pressable style={[s.btn, { backgroundColor: '#0b7d57' }]} onPress={() => router.push('/me')}>
        <Text style={s.btnText}>For patients — My Sehatsandhi</Text>
        <Text style={[s.soon, { color: '#d6efe4' }]}>medicines · ambulance · insurance · my requests</Text>
      </Pressable>
      <Pressable style={[s.btn, s.ghost]} onPress={() => router.push('/find')}>
        <Text style={[s.btnText, { color: C.ink }]}>Find a doctor</Text>
        <Text style={s.soon}>no login · book on WhatsApp</Text>
      </Pressable>
      <Pressable style={s.btn} onPress={() => router.push('/login')}>
        <Text style={s.btnText}>Business login</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  logo: { width: 260, height: 208 },
  title: { fontSize: 28, fontWeight: '800', color: C.ink },
  sub: { fontSize: 14, color: C.muted, marginBottom: 24 },
  btn: { width: '100%', backgroundColor: C.green, paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  ghost: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  soon: { fontSize: 11, color: C.muted, marginTop: 2 },
})
