import { getSite } from '@/lib/sehat';

export const revalidate = 3600;

export async function GET(_req: Request, { params }: { params: { key: string } }) {
  const d = await getSite(decodeURIComponent(params.key));
  if (!d || d.site.tier !== 'full') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  const base = d.site.custom_domain ? `https://www.${d.site.custom_domain.replace(/^www\./, '')}` : `https://${d.site.slug}.sehatsandhi.com`;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
}
