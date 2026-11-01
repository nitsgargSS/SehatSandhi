import { getArticles, getSite } from '@/lib/sehat';
import { langPath } from '@/site/ctx';

// The clinic's sitemap: every page in English and Hindi, plus its articles.

export const revalidate = 3600;

export async function GET(_req: Request, { params }: { params: { key: string } }) {
  const key = decodeURIComponent(params.key);
  const d = await getSite(key);
  if (!d || d.site.tier !== 'full') return new Response('Not found', { status: 404 });
  const base = d.site.custom_domain ? `https://www.${d.site.custom_domain.replace(/^www\./, '')}` : `https://${d.site.slug}.sehatsandhi.com`;
  const c = d.site.content;
  const pages = d.site.template === 'hospital'
    ? ['/', '/departments/', '/doctors/', ...(c.facilities?.length || c.technology?.items?.length ? ['/facilities/'] : []), ...(c.packages?.length ? ['/packages/'] : []), '/patients/', '/posts/', '/social/', '/contact/']
    : ['/', '/services/', '/about/', '/posts/', '/social/', '/contact/'];
  const urls: { loc: string; en: string; hi: string; lastmod?: string }[] = pages.map((p) => ({ loc: '', en: `${base}${langPath('en', p)}`, hi: `${base}${langPath('hi', p)}` }));
  const arts = (await getArticles(key)) ?? [];
  const groups = new Map<string, { langs: Set<string>; date: string | null }>();
  for (const a of arts) {
    const g = groups.get(a.group) ?? { langs: new Set(), date: a.published_on };
    g.langs.add(a.lang); groups.set(a.group, g);
  }
  const rows: string[] = [];
  for (const u of urls) for (const loc of [u.en, u.hi]) rows.push(entry(loc, u.en, u.hi));
  for (const [g, v] of groups) {
    const en = `${base}/post/${g}/`; const hi = `${base}/hi/post/${g}/`;
    const both = v.langs.has('en') && v.langs.has('hi');
    for (const lang of v.langs) rows.push(entry(lang === 'hi' ? hi : en, both ? en : null, both ? hi : null, v.date?.slice(0, 10)));
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

function entry(loc: string, en: string | null, hi: string | null, lastmod?: string) {
  const alt = en && hi ? `<xhtml:link rel="alternate" hreflang="en-IN" href="${en}"/><xhtml:link rel="alternate" hreflang="hi-IN" href="${hi}"/>` : '';
  return `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${alt}</url>`;
}
