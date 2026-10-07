import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'

// The emergency screen (0201 plan §5B). Opens the moment a message looks like
// an emergency — from the server's answer, or from the phone's own word list
// when there is no network — and needs no network itself: two phone calls
// and the way to the ambulance request.
export default function Emergency() {
  return (
    <View style={s.wrap}>
      <Text style={s.icon}>🚨</Text>
      <Text style={s.h}>यह इमरजेंसी लगती है</Text>
      <Text style={s.sub}>This looks like an emergency. Call now — both numbers are free.</Text>
      <Pressable style={s.big} onPress={() => Linking.openURL('tel:108')} accessibilityRole="button">
        <Text style={s.bigT}>📞 108 पर कॉल करें</Text>
        <Text style={s.bigS}>Ambulance</Text>
      </Pressable>
      <Pressable style={[s.big, s.second]} onPress={() => Linking.openURL('tel:112')} accessibilityRole="button">
        <Text style={s.bigT}>📞 112</Text>
        <Text style={s.bigS}>Emergency helpline</Text>
      </Pressable>
      <Pressable style={s.ghost} onPress={() => router.replace('/me/ambulance')} accessibilityRole="button">
        <Text style={s.ghostT}>🚑 एम्बुलेंस बुक करें</Text>
        <Text style={s.ghostS}>Alert ambulances near you</Text>
      </Pressable>
      <Pressable onPress={() => router.back()}><Text style={s.back}>It is not an emergency — go back</Text></Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#b3141b', padding: 24, justifyContent: 'center', gap: 14 },
  icon: { fontSize: 54, textAlign: 'center' },
  h: { fontSize: 28, fontWeight: '900', color: '#fff', textAlign: 'center' },
  sub: { fontSize: 15, color: '#ffe3e3', textAlign: 'center', marginBottom: 8 },
  big: { backgroundColor: '#fff', borderRadius: 18, paddingVertical: 20, alignItems: 'center' },
  second: { backgroundColor: '#ffe9e9' },
  bigT: { fontSize: 24, fontWeight: '900', color: '#b3141b' },
  bigS: { fontSize: 13, color: '#7a1015', marginTop: 2 },
  ghost: { borderWidth: 2, borderColor: '#fff', borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  ghostT: { fontSize: 18, fontWeight: '800', color: '#fff' },
  ghostS: { fontSize: 12.5, color: '#ffe3e3', marginTop: 2 },
  back: { color: '#ffd0d0', textAlign: 'center', textDecorationLine: 'underline', marginTop: 10 },
})
