'use client';

import { useEffect } from 'react';

import { SEHAT_KEY, SEHAT_URL } from '@/lib/sehat';

// Visit counter (Sehatsandhi sehat_site_track, 0303): page views and Call /
// WhatsApp / Book taps, shown to the clinic in Reports → Your website. No
// cookies and nothing personal: a random id per browser tab, the page, the
// device size and the site the visitor came from.

type Event = 'page_view' | 'call_click' | 'whatsapp_click' | 'book_start';

function session() {
  try {
    let id = sessionStorage.getItem('ss-visit');
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('ss-visit', id); }
    return id;
  } catch {
    return null;
  }
}

function send(siteKey: string, event: Event) {
  if (location.hostname === 'localhost' && !process.env.NEXT_PUBLIC_SEHAT_URL) return;
  const ref = document.referrer ? new URL(document.referrer).hostname : '';
  const w = window.innerWidth;
  fetch(`${SEHAT_URL}/rest/v1/rpc/sehat_site_track`, {
    method: 'POST', keepalive: true,
    headers: { apikey: SEHAT_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_key: siteKey, p_event: event, p_path: location.pathname, p_session: session(),
      p_device: w < 700 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop',
      p_referrer: ref === location.hostname ? '' : ref,
      p_lang: location.pathname.startsWith('/hi/') || location.pathname === '/hi' ? 'hi' : 'en',
    }),
  }).catch(() => {});
}

export default function Tracker({ siteKey }: { siteKey: string }) {
  useEffect(() => {
    send(siteKey, 'page_view');
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const h = a.getAttribute('href') ?? '';
      if (h.startsWith('tel:')) send(siteKey, 'call_click');
      else if (h.includes('wa.me/917015399355')) send(siteKey, 'book_start');
      else if (h.includes('wa.me/') || h.includes('api.whatsapp.com')) send(siteKey, 'whatsapp_click');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [siteKey]);
  return null;
}
