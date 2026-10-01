// The app's Supabase client — stands in for the website's src/lib/supabase.ts
// (metro.config.js redirects the shared files' `./supabase` imports here).
// Sessions persist on the phone through expo-sqlite's localStorage, and token
// refresh follows the app being in the foreground.
import 'expo-sqlite/localStorage/install'
import { AppState } from 'react-native'
import { createClient } from '@supabase/supabase-js'
import { activeConfig } from './env'

const { url, anon } = activeConfig()
const projectRef = (() => { try { return new URL(url).hostname.split('.')[0] } catch { return 'unconfigured' } })()

export const supabase = createClient(url || 'https://unconfigured.invalid', anon || 'unconfigured', {
  auth: {
    storage: localStorage,
    storageKey: `sb-sehat-${projectRef}-auth`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

AppState.addEventListener('change', state => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
