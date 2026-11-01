import { getArticles } from '@/lib/sehat';
import { ArticleList } from '@/site/articles';
import { Shell } from '@/site/chrome';
import { type Params, ctxFor } from '@/site/route';
import { meta } from '@/site/seo';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  return meta(c, '/posts/', `${c.lang === 'hi' ? 'सेहत पर लेख' : 'Health articles'} — ${c.name}`, c.lang === 'hi' ? `${c.name} के डॉक्टर के लेख।` : `Articles from the doctors at ${c.name}.`);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  const all = await getArticles(c.key);
  return (
    <Shell c={c} path="/posts/" current="articles">
      <ArticleList c={c} articles={(all ?? []).filter((a) => a.lang === c.lang)} />
    </Shell>
  );
}
