// Connect a Facebook Page and its Instagram for social posts (0295).
//
// Facebook Login for Business with our "Clinic social connect" configuration:
// the owner picks their Page (and the Instagram account linked to it) in
// Meta's window, which closes with the owner's short-lived key.
// social-connect swaps it for the Page's key, kept only on the server.

import { loadFacebookSdk } from './embeddedSignup'

export { loadFacebookSdk }

/** "Clinic social connect" in the Sehatsandhi Bot app (User access token; Pages + Instagram permissions). */
export const SOCIAL_CONFIG_ID = '4380016108917267'

/**
 * Opens Meta's window; must be called from a click. Resolves with the
 * owner's short-lived key, which social-connect checks was made for our app
 * and swaps for the Page's key. (A code from this window cannot be swapped:
 * Meta wants the same redirect_uri as the window, which a popup has none of.)
 */
export function facebookLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.FB) { reject(new Error('Facebook is still loading. Please press Connect again in a moment.')); return }
    window.FB.login((response: { authResponse?: { accessToken?: string } }) => {
      const token = response?.authResponse?.accessToken
      if (token) resolve(token)
      else reject(new Error('Facebook was closed before it finished.'))
    }, { config_id: SOCIAL_CONFIG_ID })
  })
}
