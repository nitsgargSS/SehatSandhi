// Connect a Facebook Page and its Instagram for social posts (0295).
//
// Facebook Login for Business with our "Clinic social connect" configuration:
// the owner picks their Page (and the Instagram account linked to it) in
// Meta's window, which closes with a one-time code. social-connect swaps the
// code for the Page's key; nothing secret is here.

import { loadFacebookSdk } from './embeddedSignup'

export { loadFacebookSdk }

/** "Clinic social connect" in the Sehatsandhi Bot app. Empty until it is made in Meta. */
export const SOCIAL_CONFIG_ID = ''

/** Opens Meta's window; must be called from a click. Resolves with the code. */
export function facebookLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.FB) { reject(new Error('Facebook is still loading. Please press Connect again in a moment.')); return }
    window.FB.login((response: { authResponse?: { code?: string } }) => {
      const code = response?.authResponse?.code
      if (code) resolve(code)
      else reject(new Error('Facebook was closed before it finished.'))
    }, { config_id: SOCIAL_CONFIG_ID, response_type: 'code', override_default_response_type: true })
  })
}
