import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { C } from '../ui/theme'

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerTintColor: C.ink, contentStyle: { backgroundColor: C.cream } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Business login' }} />
        <Stack.Screen name="(biz)" options={{ headerShown: false }} />
      </Stack>
    </>
  )
}
