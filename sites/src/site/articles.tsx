import type { Article } from '@/lib/sehat';

import type { Ctx } from './ctx';
import { Calendar } from './icons';
import Markdown from './markdown';
import { BookBand, PageHero } from './parts';

// Articles the clinic publishes from Sehatsandhi's Website tab (site_articles):
// the list, a card, and one article with the doctor's box at the end.

const dateOf = (iso: string | null, c: Ctx) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(c.lang === 'hi' ? 'hi-IN' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

const metaLine = (a: Article, c: Ctx) =>
  [a.author, dateOf(a.published_on, c), a.read_minutes ? `${a.read_minutes} ${c.lang === 'hi' ? 'मिनट' : 'min'}` : ''].filter(Boolean).join(' · ');

function Cover({ a, c }: { a: Article; c: Ctx }) {
  if (a.image_url) return <img className="photo" src={a.image_url} alt="" width={480} height={270} loading="lazy" style={{ aspectRatio: '16 / 9', height: 'auto' }} />;
  return (
    <div aria-hidden style={{ aspectRatio: '16 / 9', borderRadius: 20, background: 'linear-gradient(135deg, var(--brand-tint), var(--surface-2))', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-strong)', fontFamily: 'var(--font-display)', fontSize: 20 }}>
      {c.lang === 'hi' ? 'सेहत' : 'Health'}
    </div>
  );
}

export function ArticleCard({ c, a }: { c: Ctx; a: Article }) {
  return (
    <a href={c.href(`/post/${a.group}/`)} style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', textDecoration: 'none', color: 'var(--ink)' }}>
      <div style={{ flex: '0 0 220px', maxWidth: '100%' }}><Cover a={a} c={c} /></div>
      <div className="stack" style={{ flex: '1 1 220px', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1.35 }}>{a.title}</span>
        {a.summary && <span className="muted" style={{ fontSize: 15 }}>{a.summary}</span>}
        <span className="muted" style={{ fontSize: 14 }}>{metaLine(a, c)}</span>
      </div>
    </a>
  );
}

export function ArticleList({ c, articles }: { c: Ctx; articles: Article[] }) {
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Articles', hi: 'लेख' }} title={c.lang === 'hi' ? 'सेहत पर लेख' : 'Health articles'} />
      <section className="sec">
        <div className="wrap">
          {articles.length === 0 ? (
            <p className="muted">{c.lang === 'hi' ? 'लेख जल्द आएँगे।' : 'Articles are on their way.'}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 500px), 1fr))', gap: 28 }}>
              {articles.map((a) => <ArticleCard key={a.slug} c={c} a={a} />)}
            </div>
          )}
        </div>
      </section>
      <BookBand c={c} />
    </>
  );
}

export function ArticlePage({ c, a }: { c: Ctx; a: Article }) {
  const doc = c.d.site.content.doctor;
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Articles', hi: 'लेख' }} title={a.title}>
        <span className="muted small" style={{ flex: '0 1 280px' }}>{metaLine(a, c)}</span>
      </PageHero>
      <section className="sec" style={{ paddingTop: 44 }}>
        <article className="wrap stack" style={{ maxWidth: 820, gap: 20, fontSize: 17, lineHeight: 1.75 }}>
          {a.image_url && <img className="photo" src={a.image_url} alt="" width={1200} height={675} style={{ aspectRatio: '16 / 9', height: 'auto' }} />}
          <Markdown text={a.body ?? ''} />
          <p className="muted" style={{ fontSize: 15, borderTop: '1px solid var(--line)', paddingTop: 18, marginTop: 12 }}>
            {c.lang === 'hi' ? 'यह लेख सामान्य जानकारी है। अपनी सेहत के लिए डॉक्टर से मिलें।' : 'This article is general information. Please see a doctor about your own health.'}
          </p>
          {doc?.name && (
            <aside className="card row" style={{ padding: 22, gap: 18, alignItems: 'center' }}>
              {(doc.avatar_url || doc.photo_url) && <img src={doc.avatar_url || doc.photo_url} alt="" width={84} height={84} loading="lazy" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--line)', background: '#fff', flex: 'none' }} />}
              <div className="stack" style={{ flex: '1 1 300px', gap: 4 }}>
                <span className="muted small">{c.lang === 'hi' ? 'डॉक्टर' : 'From the doctor'}</span>
                <a href={c.href('/about/')} style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{doc.name}</a>
                {(doc.qualification || doc.role) && <span className="small">{[c.t(doc.qualification), c.t(doc.role)].filter(Boolean).join(' · ')}</span>}
              </div>
              <a className="btn btn-primary" href={c.bookUrl} rel="noopener" style={{ flex: 'none' }}><Calendar />{c.lang === 'hi' ? 'अपॉइंटमेंट बुक करें' : 'Book appointment'}</a>
            </aside>
          )}
        </article>
      </section>
      <BookBand c={c} />
    </>
  );
}
