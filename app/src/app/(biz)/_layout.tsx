import { Stack } from 'expo-router'
import { SessionProvider } from '../../lib/session'
import { C } from '../../ui/theme'

// Everything behind business login shares one session (who, clinic, role).
export default function BizLayout() {
  // Tapped alerts are handled in the root layout (0196), for staff and patients alike.
  return (
    <SessionProvider>
      {/* headerBackTitle: iOS otherwise labels the back button with the route group, "(tabs)". */}
      <Stack screenOptions={{ headerTintColor: C.ink, headerBackTitle: 'Back', contentStyle: { backgroundColor: C.cream } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="consult/[token]" options={{ title: 'Consultation' }} />
        <Stack.Screen name="patient/[member]" options={{ title: 'Patient' }} />
        <Stack.Screen name="stay/[admission]" options={{ title: 'In-patient' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Medicine order' }} />
        <Stack.Screen name="trip/[id]" options={{ title: 'Ambulance trip' }} />
        <Stack.Screen name="lead/[id]" options={{ title: 'Insurance lead' }} />
      </Stack>
    </SessionProvider>
  )
}
