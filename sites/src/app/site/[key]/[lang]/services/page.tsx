import { redirect } from 'next/navigation';

import { Shell } from '@/site/chrome';
import { TreatmentsPage } from '@/site/pages';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  const s = c.d.site.content;
  const names = (s.treatments ?? []).slice(0, 6).map((x) => c.t(x.title)).join(', ');
  return meta(c, '/services/', `${c.t(s.treatments_title) || (c.lang === 'hi' ? 'इलाज' : 'Treatments')} — ${c.name}`, c.t(s.treatments_intro) || names || c.name);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  // A hospital's equivalent page.
  if (c.hospital) redirect(c.href('/departments/'));
  return (
    <Shell c={c} path="/services/" current="services">
      <JsonLd data={clinicSchema(c)} />
      <TreatmentsPage c={c} />
    </Shell>
  );
}
