// The app's stand-in for the website's src/lib/env.ts (which reads Vite's
// import.meta.env). metro.config.js points every `./env` import made by the
// website's shared files (../src/lib/*) here, so they talk to the backend this
// build was configured for. Same exports, same meaning.
//
// EXPO_PUBLIC_* values are inlined at build time (see .env / eas.json).

export interface BackendConfig {
  url: string
  anon: string
}

const CONFIG: BackendConfig = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  anon: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
}

export const IS_STAGING = process.env.EXPO_PUBLIC_IS_STAGING === 'true'
export const RECORDING_ENABLED = false
export const SANDBOX_PURGE_TOKEN = ''
export const activeConfig = (): BackendConfig => CONFIG
