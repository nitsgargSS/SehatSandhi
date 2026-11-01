import { getSocial } from '@/lib/sehat';
import { Shell } from '@/site/chrome';
import { type Params, ctxFor } from '@/site/route';
import { meta } from '@/site/seo';
import { SocialPage } from '@/site/social';

export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }: { params: Params }) {
  const c = await ctxFor(params);
  return meta(c, '/social/', `${c.lang === 'hi' ? 'सेहत के टिप्स' : 'Health tips'} — ${c.name}`, c.lang === 'hi' ? `${c.name} की नई पोस्ट और वीडियो।` : `Latest posts and short videos from ${c.name}.`);
}

export default async function Page({ params }: { params: Params }) {
  const c = await ctxFor(params);
  const posts = await getSocial(c.key, 12);
  return (
    <Shell c={c} path="/social/" current="social">
      <SocialPage c={c} posts={posts} />
    </Shell>
  );
}
