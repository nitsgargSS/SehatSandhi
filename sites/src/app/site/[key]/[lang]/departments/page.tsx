import { notFound } from 'next/navigation';

import { Shell } from '@/site/chrome';
import { DepartmentsPage } from '@/site/hospital';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

// Hospital layout only; a clinic site has no /departments/ page.

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) return {};
  const hi = c.lang === 'hi';
  return meta(c, '/departments/', `${hi ? 'विभाग' : 'Departments'} — ${c.name}`, hi ? `\${c.name} के विभाग और उनके डॉक्टर।` : `Departments and specialities at \${c.name}, with their doctors.`);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) notFound();
  return (
    <Shell c={c} path="/departments/" current="departments">
      <JsonLd data={clinicSchema(c)} />
      <DepartmentsPage c={c} />
    </Shell>
  );
}
