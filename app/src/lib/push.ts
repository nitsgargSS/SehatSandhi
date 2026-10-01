import { Platform } from 'react-native'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { supabase } from './supabase'

// Push notifications (0185). After sign-in the phone registers its Expo push
// token against the login; the database queues a message when a token is given
// or an appointment booked, and push-send delivers it. Sign-out removes the
// token so a shared phone stops getting the last person's alerts.
//
// Push needs an installed build of the app (not Expo Go) and the EAS project id
// in app.json (extra.eas.projectId, written by `eas init`). Without either this
// does nothing and says why — it never breaks sign-in.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
})

let current: string | null = null

export type PushState = 'on' | 'denied' | 'unavailable'

export async function registerPush(): Promise<{ state: PushState; why?: string }> {
  try {
    if (!Device.isDevice) return { state: 'unavailable', why: 'Simulator — push needs a real phone.' }
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId
    if (!projectId) return { state: 'unavailable', why: 'App not linked to its Expo project yet (eas init).' }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Clinic alerts', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250],
      })
    }
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') return { state: 'denied', why: 'Notifications are turned off for Sehatsandhi in phone settings.' }
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
    const { error } = await supabase.rpc('sehat_register_push_device', { p_token: token, p_platform: Platform.OS })
    if (error) return { state: 'unavailable', why: error.message }
    current = token
    return { state: 'on' }
  } catch (e) {
    // Expo Go cannot receive push; an installed build can.
    return { state: 'unavailable', why: String((e as Error).message ?? e).slice(0, 160) }
  }
}

/** Before signing out: this phone stops receiving this login's alerts. */
export async function unregisterPush() {
  if (!current) return
  await supabase.rpc('sehat_unregister_push_device', { p_token: current }).then(() => undefined, () => undefined)
  current = null
}

/** Where a tapped notification should take the user. */
export function routeFor(data: Record<string, unknown> | undefined): string | null {
  const kind = data?.kind
  if (kind === 'medicine_order' && typeof data?.order_id === 'string') return `/order/${data.order_id}`
  return kind === 'queue' || kind === 'appointment' ? '/queue' : null
}
