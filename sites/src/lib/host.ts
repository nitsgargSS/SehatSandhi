// Which clinic a hostname belongs to: <slug>.sehatsandhi.com, or a clinic's
// own domain (business_sites.custom_domain, with or without www). The key is
// passed to Sehatsandhi, which resolves either form (sehat_site_business).
// Localhost and Vercel previews use DEV_SITE_KEY, or ?site=<slug> once
// (remembered in a cookie) to switch clinics while testing.

export function siteKeyFromHost(host: string | null): string | null {
  const h = (host ?? '').toLowerCase().split(':')[0];
  if (!h || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app')) return null;
  const sub = h.match(/^([a-z0-9-]+)\.sehatsandhi\.com$/)?.[1];
  if (sub) return ['www', 'staging', 'app', 'api', 'admin', 'sites'].includes(sub) ? null : sub;
  if (h.endsWith('sehatsandhi.com')) return null;
  return h.replace(/^www\./, '');
}

export const isDevHost = (host: string | null) => {
  const h = (host ?? '').toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app');
};
