import { notFound } from 'next/navigation';

import { Shell } from '@/site/chrome';
import { PatientsPage } from '@/site/hospital';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

// Hospital layout only; a clinic site has no /patients/ page.

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) return {};
  const hi = c.lang === 'hi';
  return meta(c, '/patients/', `${hi ? 'मरीज़ों के लिए जानकारी' : 'Patient guide'} — ${c.name}`, hi ? `\${c.name} में भर्ती, मिलने का समय, बिलिंग, बीमा और इमरजेंसी।` : `Admission, visiting hours, billing, insurance and emergency at \${c.name}.`);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) notFound();
  return (
    <Shell c={c} path="/patients/" current="patients">
      <JsonLd data={clinicSchema(c)} />
      <PatientsPage c={c} />
    </Shell>
  );
}
