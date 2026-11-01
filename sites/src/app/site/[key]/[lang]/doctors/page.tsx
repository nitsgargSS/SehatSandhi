import { notFound } from 'next/navigation';

import { Shell } from '@/site/chrome';
import { DoctorsPage } from '@/site/hospital';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

// Hospital layout only; a clinic site has no /doctors/ page.

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) return {};
  const hi = c.lang === 'hi';
  return meta(c, '/doctors/', `${hi ? 'हमारे डॉक्टर' : 'Our doctors'} — ${c.name}`, hi ? `\${c.name} के \${c.d.doctors.length} डॉक्टर: योग्यता, विभाग और ऑनलाइन बुकिंग।` : `\${c.d.doctors.length} doctors at \${c.name}: qualifications, departments and online booking.`);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) notFound();
  return (
    <Shell c={c} path="/doctors/" current="doctors">
      <JsonLd data={clinicSchema(c)} />
      <DoctorsPage c={c} />
    </Shell>
  );
}
