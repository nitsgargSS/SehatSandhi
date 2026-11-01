import { getArticles, getReviews, getSocial } from '@/lib/sehat';
import { Shell } from '@/site/chrome';
import { leadDoctor } from '@/site/ctx';
import Home from '@/site/home';
import { HospitalHome } from '@/site/hospital';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  const s = c.d.site.content;
  const doc = leadDoctor(c.d);
  const place = [...new Set([c.d.business.city, c.d.business.district].filter(Boolean))].join(', ');
  const title = [c.name, c.t(s.tagline) || c.d.business.category, place].filter(Boolean).join(' — ');
  const description = c.t(s.intro) || c.t(s.doctor?.summary) || [c.name, c.hospital ? `${c.d.doctors.length} doctors` : doc?.name, place].filter(Boolean).join(' · ');
  return meta(c, '/', title, description.slice(0, 300));
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  const [posts, reviews, all] = await Promise.all([getSocial(c.key, 3), getReviews(c.key), getArticles(c.key)]);
  const articles = (all ?? []).filter((a) => a.lang === c.lang);
  return (
    <Shell c={c} path="/">
      <JsonLd data={clinicSchema(c)} />
      {c.hospital ? <HospitalHome c={c} posts={posts} reviews={reviews} articles={articles} /> : <Home c={c} posts={posts} reviews={reviews} articles={articles} />}
    </Shell>
  );
}
