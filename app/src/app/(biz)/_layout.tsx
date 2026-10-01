import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { routeFor } from '../../lib/push'
import { SessionProvider } from '../../lib/session'
import { C } from '../../ui/theme'

// Everything behind business login shares one session (who, clinic, role).
export default function BizLayout() {
  // A tapped alert opens where it is about (today's queue).
  useEffect(() => {
    const go = (r: Notifications.NotificationResponse | null) => {
      const to = routeFor(r?.notification.request.content.data as Record<string, unknown> | undefined)
      if (to) router.push(to as never)
    }
    Notifications.getLastNotificationResponseAsync().then(go).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener(go)
    return () => sub.remove()
  }, [])
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerTintColor: C.ink, contentStyle: { backgroundColor: C.cream } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="consult/[token]" options={{ title: 'Consultation' }} />
        <Stack.Screen name="patient/[member]" options={{ title: 'Patient' }} />
        <Stack.Screen name="stay/[admission]" options={{ title: 'In-patient' }} />
        <Stack.Screen name="order/[id]" options={{ title: 'Medicine order' }} />
      </Stack>
    </SessionProvider>
  )
}
