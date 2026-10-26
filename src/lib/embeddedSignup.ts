// Meta's WhatsApp Embedded Signup, in the clinic's WhatsApp tab (0261).
//
// The clinic presses Connect; Meta's own window opens over the page (Facebook
// Login for Business with our "Clinic WhatsApp connect" configuration). There
// the clinic picks or creates its WhatsApp account, adds and verifies its
// number, and agrees to share it with Sehatsandhi. When the window closes we
// have two things, arriving separately:
//
//   a one-time code      — from FB.login's callback; the server swaps it for
//                          the account's access key (wa-connect);
//   the account and number ids — from a postMessage Meta sends this page.
//
// Both are handed to wa-connect, which does everything else. Nothing secret
// is here: the app id and configuration id are public by design.

const APP_ID = '2239815556798206'
const CONFIG_ID = '1095665523347647'
const SDK_VERSION = 'v25.0'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
declare global {
  interface Window { FB?: Any; fbAsyncInit?: () => void }
}

let loading: Promise<void> | null = null

/** Load Facebook's SDK once. Called when the card shows, so Connect can open the window straight from the click. */
export function loadFacebookSdk(): Promise<void> {
  if (window.FB) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: SDK_VERSION })
      resolve()
    }
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/en_US/sdk.js'
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous'
    s.onerror = () => { loading = null; reject(new Error('Facebook could not be loaded. Check the connection, or switch off an ad blocker for this page.')) }
    document.body.appendChild(s)
  })
  return loading
}

export interface SignupResult { code: string; wabaId: string; phoneNumberId: string }

/**
 * Open Embedded Signup. `coexistence`: the clinic brings the number it already
 * uses on the WhatsApp Business app, and keeps using the app on its phone.
 * Must be called from a click, or the browser blocks the window.
 */
export function embeddedSignup(coexistence: boolean): Promise<SignupResult> {
  return new Promise((resolve, reject) => {
    if (!window.FB) { reject(new Error('Facebook is still loading. Please press Connect again in a moment.')); return }
    let code = ''
    let ids: { wabaId: string; phoneNumberId: string } | null = null
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      if (!err && !(code && ids)) return
      settled = true
      window.removeEventListener('message', onMessage)
      if (err) reject(err)
      else resolve({ code, ...ids! })
    }
    const onMessage = (ev: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(ev.origin).hostname)) return
      let data: Any
      try { data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data } catch { return }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (String(data.event).startsWith('FINISH')) {
        const d = data.data ?? {}
        if (d.waba_id && d.phone_number_id) { ids = { wabaId: String(d.waba_id), phoneNumberId: String(d.phone_number_id) }; finish() }
        else finish(new Error('Meta finished without a phone number. Please connect again and add the number.'))
      } else if (data.event === 'CANCEL') {
        const where = data.data?.current_step ? ` (at “${data.data.current_step}”)` : ''
        finish(new Error(data.data?.error_message ? `Meta stopped: ${data.data.error_message}` : `The sign-up was closed before it finished${where}.`))
      } else if (data.event === 'ERROR') {
        finish(new Error(`Meta reported a problem: ${data.data?.error_message ?? 'unknown'}`))
      }
    }
    window.addEventListener('message', onMessage)

    window.FB.login((response: Any) => {
      code = response?.authResponse?.code ?? ''
      if (!code) { finish(new Error('The sign-up was closed before it finished.')); return }
      finish()
      // The ids normally arrive first; give them a moment if not.
      setTimeout(() => finish(new Error('Meta did not say which number was connected. Please try again.')), 8000)
    }, {
      config_id: CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        sessionInfoVersion: '3',
        version: 'v4',
        ...(coexistence ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
      },
    })
  })
}
