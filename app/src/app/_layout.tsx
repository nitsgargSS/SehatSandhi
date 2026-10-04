import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { routeFor } from '../lib/push'
import { C } from '../ui/theme'

export default function RootLayout() {
  // A tapped alert opens where it is about — for staff (queue, order, trip,
  // lead) and for patients (0196: rate what you used). Here at the root so a
  // patient's alert works as well as a clinic's.
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
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerTintColor: C.ink, contentStyle: { backgroundColor: C.cream } }}>
        <Stack.Screen name="index" options={{ headerShown: false, title: 'Home' }} />
        <Stack.Screen name="login" options={{ title: 'Business login' }} />
        <Stack.Screen name="find" options={{ title: 'Find a doctor' }} />
        <Stack.Screen name="me" options={{ headerShown: false }} />
        <Stack.Screen name="(biz)" options={{ headerShown: false }} />
      </Stack>
    </>
  )
}
