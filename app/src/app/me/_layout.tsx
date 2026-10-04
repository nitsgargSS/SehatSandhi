import { Stack } from 'expo-router'
import { C } from '../../ui/theme'

// The patient's side of the app (0196).
export default function MeLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: C.ink, contentStyle: { backgroundColor: C.cream } }}>
      <Stack.Screen name="index" options={{ title: 'My Sehatsandhi' }} />
      <Stack.Screen name="order" options={{ title: 'Order medicines' }} />
      <Stack.Screen name="ambulance" options={{ title: 'Ambulance' }} />
      <Stack.Screen name="insurance" options={{ title: 'Health insurance' }} />
      <Stack.Screen name="rate" options={{ title: 'Rate' }} />
      <Stack.Screen name="records" options={{ title: 'My health' }} />
      <Stack.Screen name="chat" options={{ title: 'Message' }} />
    </Stack>
  )
}
