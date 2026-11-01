import { NextResponse, type NextRequest } from 'next/server';

import { isDevHost, siteKeyFromHost } from './lib/host';

// Every request is rewritten to /site/<key>/<lang>/<path>, where <key> comes
// from the hostname (lib/host.ts) and <lang> from a leading /hi/. Pages under
// app/site/[key]/[lang] render that clinic. sitemap.xml and robots.txt go to
// per-clinic route handlers.

export const config = { matcher: ['/((?!_next/|favicon|.*\\.(?:png|jpg|jpeg|webp|svg|ico|txt|html|js|css|woff2?)$).*)', '/robots.txt'] };

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const host = req.headers.get('host');
  let key = siteKeyFromHost(host);
  let setCookie: string | null = null;
  if (!key && isDevHost(host)) {
    const asked = url.searchParams.get('site');
    if (asked && /^[a-z0-9.-]{2,80}$/.test(asked)) { key = asked; setCookie = asked; }
    else key = req.cookies.get('dev-site')?.value || process.env.DEV_SITE_KEY || null;
  }
  if (!key) return new NextResponse('Not a clinic website.', { status: 404 });

  const path = url.pathname;
  const target = url.clone();
  if (path === '/sitemap.xml' || path === '/robots.txt') {
    target.pathname = `/site/${encodeURIComponent(key)}${path}`;
  } else {
    const hi = path === '/hi' || path.startsWith('/hi/');
    const rest = hi ? path.slice(3) || '/' : path;
    target.pathname = `/site/${encodeURIComponent(key)}/${hi ? 'hi' : 'en'}${rest}`;
  }
  const res = NextResponse.rewrite(target);
  if (setCookie) res.cookies.set('dev-site', setCookie, { path: '/', sameSite: 'lax' });
  return res;
}
