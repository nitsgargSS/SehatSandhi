import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSession, ROLE_WORD } from '../../../lib/session'
import { C } from '../../../ui/theme'

export default function TabsLayout() {
  const { s } = useSession()
  // 0189: a pharmacy works orders — no queue, no patient records.
  const pharmacy = s?.clinic?.vertical === 'pharmacy'
  const sub = s ? `${s.name || s.email}${s.role.role ? ` · ${ROLE_WORD[s.role.role] ?? s.role.role}` : ''}` : ''
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: C.green, headerTintColor: C.ink,
      headerTitleStyle: { fontWeight: '800' },
      sceneStyle: { backgroundColor: C.cream },
    }}>
      <Tabs.Screen name="orders" options={{
        title: s?.clinic?.name ?? 'Orders', tabBarLabel: s?.role.role === 'delivery' ? 'Deliveries' : 'Orders', headerTitleAlign: 'left',
        href: pharmacy ? undefined : null,
        tabBarIcon: ({ color, size }) => <Ionicons name="bag-handle" color={color} size={size} />,
      }} />
      <Tabs.Screen name="queue" options={{
        title: s?.clinic?.name ?? 'Queue', tabBarLabel: 'Queue', headerTitleAlign: 'left', href: pharmacy ? null : undefined,
        tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
      }} />
      <Tabs.Screen name="beds" options={{
        title: 'Beds', href: s?.hasWards ? undefined : null,
        tabBarIcon: ({ color, size }) => <Ionicons name="bed" color={color} size={size} />,
      }} />
      <Tabs.Screen name="patients" options={{
        title: 'Patients', href: pharmacy ? null : undefined,
        tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} />,
      }} />
      <Tabs.Screen name="me" options={{
        title: sub || 'Me', tabBarLabel: 'Me',
        tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color} size={size} />,
      }} />
    </Tabs>
  )
}
