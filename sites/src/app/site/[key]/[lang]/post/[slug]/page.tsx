import { notFound } from 'next/navigation';

import { getArticle } from '@/lib/sehat';
import { ArticlePage } from '@/site/articles';
import { Shell } from '@/site/chrome';
import { type Params, ctxFor } from '@/site/route';
import { JsonLd, clinicSchema, meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

type P = Params & { slug: string };

export async function generateMetadata({ params }: { params: P }) {
  const c = await ctxFor(params);
  const a = await getArticle(c.key, params.slug, c.lang);
  if (!a) return {};
  return meta(c, `/post/${a.group}/`, `${a.title} — ${c.name}`, a.summary || a.title, a.image_url);
}

export default async function Page({ params }: { params: P }) {
  const c = await ctxFor(params);
  const a = await getArticle(c.key, params.slug, c.lang);
  if (!a) notFound();
  return (
    <Shell c={c} path={`/post/${a.group}/`} current="articles">
      <JsonLd data={[...clinicSchema(c), { '@context': 'https://schema.org', '@type': 'MedicalWebPage', headline: a.title, name: a.title, ...(a.summary ? { description: a.summary } : {}), ...(a.published_on ? { datePublished: a.published_on.slice(0, 10) } : {}), inLanguage: c.lang === 'hi' ? 'hi-IN' : 'en-IN', url: `${c.base}${c.href(`/post/${a.group}/`)}`, ...(a.image_url ? { image: a.image_url } : {}), publisher: { '@id': `${c.base}/#clinic` } }]} />
      <ArticlePage c={c} a={a} />
    </Shell>
  );
}
