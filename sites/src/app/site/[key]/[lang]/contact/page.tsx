import { Shell } from '@/site/chrome';
import { ContactPage } from '@/site/pages';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  const address = c.t(c.d.site.content.visit?.address) || c.d.business.address || '';
  return meta(c, '/contact/', `${c.lang === 'hi' ? 'संपर्क' : 'Contact'} — ${c.name}`, [c.name, address, c.phone?.display].filter(Boolean).join(' · '));
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  return (
    <Shell c={c} path="/contact/" current="contact">
      <JsonLd data={clinicSchema(c)} />
      <ContactPage c={c} />
    </Shell>
  );
}
