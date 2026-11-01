import { notFound } from 'next/navigation';

import { Shell } from '@/site/chrome';
import { PackagesPage } from '@/site/hospital';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

// Hospital layout only; a clinic site has no /packages/ page.

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) return {};
  const hi = c.lang === 'hi';
  return meta(c, '/packages/', `${hi ? 'हेल्थ चेक-अप पैकेज' : 'Health check-up packages'} — ${c.name}`, hi ? `\${c.name} के हेल्थ चेक-अप पैकेज।` : `Health check-up packages at \${c.name}.`);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  if (!c.hospital) notFound();
  return (
    <Shell c={c} path="/packages/" current="packages">
      <JsonLd data={clinicSchema(c)} />
      <PackagesPage c={c} />
    </Shell>
  );
}
