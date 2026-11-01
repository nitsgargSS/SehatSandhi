import { getReviews } from '@/lib/sehat';
import { Shell } from '@/site/chrome';
import { leadDoctor } from '@/site/ctx';
import { DoctorPage } from '@/site/pages';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  const doc = leadDoctor(c.d);
  return meta(c, '/about/', [doc?.name, c.t(doc?.qualification), c.name].filter(Boolean).join(' — '), c.t(c.d.site.content.doctor?.summary) || [doc?.name, c.t(doc?.role), c.name].filter(Boolean).join(' · '), c.d.site.content.doctor?.photo_url);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  const reviews = await getReviews(c.key);
  return (
    <Shell c={c} path="/about/" current="doctor">
      <JsonLd data={clinicSchema(c)} />
      <DoctorPage c={c} reviews={reviews} />
    </Shell>
  );
}
