import { Stack } from 'expo-router'
import { SessionProvider } from '../../lib/session'
import { C } from '../../ui/theme'

// Everything behind business login shares one session (who, clinic, role).
export default function BizLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerTintColor: C.ink, contentStyle: { backgroundColor: C.cream } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="consult/[token]" options={{ title: 'Consultation' }} />
        <Stack.Screen name="patient/[member]" options={{ title: 'Patient' }} />
      </Stack>
    </SessionProvider>
  )
}
