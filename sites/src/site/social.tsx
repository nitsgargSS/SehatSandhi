import type { SocialPost } from '@/lib/sehat';

import type { B, Ctx } from './ctx';
import { Whatsapp } from './icons';
import { PageHero } from './parts';
import ReelPicture from './reel';

// The clinic's latest posts and reels from Sehatsandhi's social posts. The
// pictures stay in Sehatsandhi's storage; only the newest 12 are shown.

export const POST_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 300px))', gap: 20 } as const;

const dateText = (iso: string, c: Ctx) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(c.lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const headline = (p: SocialPost, c: Ctx) => (c.lang === 'hi' ? p.headline_hi || p.headline_en : p.headline_en || p.headline_hi) || p.topic || '';

export function PostCard({ c, p, compact = false }: { c: Ctx; p: SocialPost; compact?: boolean }) {
  const t = (x: B) => c.t(x);
  const share = `${headline(p, c)}\n\n${(p.caption ?? '').slice(0, 300)}\n\n${c.base}${c.href('/social/')}`;
  return (
    <article className="card stack" style={{ overflow: 'hidden' }}>
      <ReelPicture image={p.image_url} reel={compact ? null : p.reel_url} alt={headline(p, c)} playLabel={t({ en: 'Play video', hi: 'वीडियो चलाएँ' })} closeLabel={t({ en: 'Close', hi: 'बंद करें' })} />
      <div className="stack" style={{ padding: 16, gap: 8, flex: 1 }}>
        <span className="muted small">{dateText(p.post_date, c)}{p.reel_url ? ` · ${t({ en: 'Video', hi: 'वीडियो' })}` : ''}</span>
        {headline(p, c) && <h3 style={{ fontSize: 18, lineHeight: 1.35 }}>{headline(p, c)}</h3>}
        {!compact && p.caption && (
          <details>
            <summary className="small" style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--brand-strong)' }}>{t({ en: 'Read the post', hi: 'पोस्ट पढ़ें' })}</summary>
            <p className="muted small" style={{ whiteSpace: 'pre-line', marginTop: 8 }}>{p.caption}</p>
          </details>
        )}
        {!compact && (
          <a className="btn btn-wa" href={`https://wa.me/?text=${encodeURIComponent(share)}`} rel="noopener" style={{ marginTop: 'auto', alignSelf: 'flex-start', minHeight: 44, padding: '0 16px' }}>
            <Whatsapp size={18} />{t({ en: 'Share', hi: 'शेयर करें' })}
          </a>
        )}
      </div>
    </article>
  );
}

export function SocialPage({ c, posts }: { c: Ctx; posts: SocialPost[] | null }) {
  const soc = c.d.site.content.social ?? {};
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Health tips', hi: 'सेहत टिप्स' }} title={c.lang === 'hi' ? 'सेहत के टिप्स और ख़बरें' : 'Health tips and news'}
        intro={c.lang === 'hi' ? 'हमारी नई पोस्ट और छोटे वीडियो।' : 'Our latest posts and short videos.'}>
        <div className="row" style={{ gap: 10 }}>
          {soc.instagram && <a className="btn btn-ghost" href={soc.instagram} rel="noopener">Instagram</a>}
          {soc.facebook && <a className="btn btn-ghost" href={soc.facebook} rel="noopener">Facebook</a>}
        </div>
      </PageHero>
      <section className="sec">
        <div className="wrap">
          {posts && posts.length > 0
            ? <div style={POST_GRID}>{posts.map((p) => <PostCard key={p.id} c={c} p={p} />)}</div>
            : <p className="muted">{c.lang === 'hi' ? 'नई पोस्ट जल्द आएँगी।' : 'New posts are on their way.'}</p>}
        </div>
      </section>
    </>
  );
}
