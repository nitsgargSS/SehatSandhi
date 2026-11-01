import { notFound } from 'next/navigation';

import { Shell } from '@/site/chrome';
import { FacilitiesPage } from '@/site/hospital';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

// Hospital layout only; a clinic site has no /facilities/ page.

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) return {};
  const hi = c.lang === 'hi';
  return meta(c, '/facilities/', `${hi ? 'सुविधाएँ' : 'Facilities'} — ${c.name}`, hi ? `\${c.name} की सुविधाएँ और उपकरण।` : `Facilities and equipment at \${c.name}.`);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) notFound();
  return (
    <Shell c={c} path="/facilities/" current="facilities">
      <JsonLd data={clinicSchema(c)} />
      <FacilitiesPage c={c} />
    </Shell>
  );
}
