import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSession, ROLE_WORD } from '../../../lib/session'
import { C } from '../../../ui/theme'

export default function TabsLayout() {
  const { s } = useSession()
  // 0189: a pharmacy works orders — no queue, no patient records.
  const pharmacy = s?.clinic?.vertical === 'pharmacy'
  // 0191: an ambulance service works trips.
  const ambulance = s?.clinic?.vertical === 'ambulance'
  // 0192: an insurance advisor works leads.
  const insurance = s?.clinic?.vertical === 'insurance'
  const noClinic = pharmacy || ambulance || insurance
  // An admin who is not on any clinic's staff: the Admin tab and Me only.
  const adminOnly = !!s?.isAdmin && !s.clinic
  // The Me card already shows the email; the header only names a person who has a name.
  const sub = s?.name ? `${s.name}${s.role.role ? ` · ${ROLE_WORD[s.role.role] ?? s.role.role}` : ''}` : ''
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: C.green, headerTintColor: C.ink,
      headerTitleStyle: { fontWeight: '800' },
      sceneStyle: { backgroundColor: C.cream },
    }}>
      <Tabs.Screen name="leads" options={{
        title: s?.clinic?.name ?? 'Leads', tabBarLabel: 'Leads', headerTitleAlign: 'left',
        href: insurance ? undefined : null,
        tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark" color={color} size={size} />,
      }} />
      <Tabs.Screen name="trips" options={{
        title: s?.clinic?.name ?? 'Trips', tabBarLabel: 'Trips', headerTitleAlign: 'left',
        href: ambulance ? undefined : null,
        tabBarIcon: ({ color, size }) => <Ionicons name="medkit" color={color} size={size} />,
      }} />
      <Tabs.Screen name="orders" options={{
        title: s?.clinic?.name ?? 'Orders', tabBarLabel: s?.role.role === 'delivery' ? 'Deliveries' : 'Orders', headerTitleAlign: 'left',
        href: pharmacy ? undefined : null,
        tabBarIcon: ({ color, size }) => <Ionicons name="bag-handle" color={color} size={size} />,
      }} />
      <Tabs.Screen name="queue" options={{
        title: s?.clinic?.name ?? 'Queue', tabBarLabel: 'Queue', headerTitleAlign: 'left', href: noClinic || adminOnly ? null : undefined,
        tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
      }} />
      <Tabs.Screen name="bookings" options={{
        title: 'Bookings', href: noClinic || adminOnly ? null : undefined,
        tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} />,
      }} />
      <Tabs.Screen name="beds" options={{
        title: 'Beds', href: s?.hasWards ? undefined : null,
        tabBarIcon: ({ color, size }) => <Ionicons name="bed" color={color} size={size} />,
      }} />
      <Tabs.Screen name="patients" options={{
        title: 'Patients', href: noClinic || adminOnly ? null : undefined,
        tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} />,
      }} />
      <Tabs.Screen name="messages" options={{
        title: 'Messages', href: adminOnly || s?.role.role === 'delivery' || s?.role.role === 'driver' ? null : undefined,
        tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color} size={size} />,
      }} />
      <Tabs.Screen name="admin" options={{
        title: 'Sehatsandhi admin', tabBarLabel: 'Admin', headerTitleAlign: 'left', href: s?.isAdmin ? undefined : null,
        tabBarIcon: ({ color, size }) => <Ionicons name="shield" color={color} size={size} />,
      }} />
      <Tabs.Screen name="me" options={{
        title: sub || 'Me', tabBarLabel: 'Me',
        tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color} size={size} />,
      }} />
    </Tabs>
  )
}
