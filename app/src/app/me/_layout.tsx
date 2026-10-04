import { Pressable, Text } from 'react-native'
import { Stack, router } from 'expo-router'
import { C } from '../../ui/theme'

// The patient's side of the app (0196).
export default function MeLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: C.ink, contentStyle: { backgroundColor: C.cream } }}>
      <Stack.Screen name="index" options={{
        title: 'My Sehatsandhi',
        // First screen of this stack: back to the start screen, which stays put.
        headerLeft: () => (
          <Pressable onPress={() => router.replace({ pathname: '/', params: { home: '1' } })} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back to start">
            <Text style={{ color: C.ink, fontSize: 17 }}>‹ Home</Text>
          </Pressable>
        ),
      }} />
      <Stack.Screen name="order" options={{ title: 'Order medicines' }} />
      <Stack.Screen name="ambulance" options={{ title: 'Ambulance' }} />
      <Stack.Screen name="insurance" options={{ title: 'Health insurance' }} />
      <Stack.Screen name="rate" options={{ title: 'Rate' }} />
      <Stack.Screen name="records" options={{ title: 'My health' }} />
      <Stack.Screen name="chat" options={{ title: 'Message' }} />
    </Stack>
  )
}
