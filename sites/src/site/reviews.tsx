import type { Reviews as ReviewsData } from '@/lib/sehat';

import type { Ctx } from './ctx';
import { Check, Star } from './icons';

// Patient reviews: Sehatsandhi ratings from patients after a visit (live),
// beside the clinic's Google rating and the testimonials it entered in the
// Website tab. Sehatsandhi shares no names, so its reviews read "Verified
// visit". No rating markup: Google ignores self-published stars.

const dateText = (iso: string, c: Ctx) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(c.lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric' });

function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return <span style={{ display: 'inline-flex', gap: 1 }} aria-hidden>{[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ color: i <= Math.round(n) ? 'var(--accent)' : 'var(--line)', display: 'flex' }}><Star size={size} /></span>)}</span>;
}

function Score({ value, label, sub, href }: { value: number; label: string; sub: string; href?: string }) {
  const body = (
    <>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 40, lineHeight: 1, color: 'var(--ink)' }}>{value.toFixed(1)}</span>
      <span className="stack" style={{ gap: 4 }}><Stars n={value} size={18} /><b style={{ fontWeight: 700, color: 'var(--ink)' }}>{label}</b><span className="muted small">{sub}</span></span>
    </>
  );
  const style = { display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', flex: '1 1 260px', textDecoration: 'none' } as const;
  return href ? <a className="card" href={href} rel="noopener" style={style}>{body}</a> : <div className="card" style={style}>{body}</div>;
}

export default function Reviews({ c, sehat }: { c: Ctx; sehat: ReviewsData | null }) {
  const s = c.d.site.content;
  const hi = c.lang === 'hi';
  const has = !!sehat && sehat.count > 0 && sehat.average != null;
  const google = s.google?.rating ? s.google : null;
  const written = has ? sehat!.reviews.slice(0, 6) : [];
  const quotes = s.testimonials ?? [];
  const fill = written.length % 3 ? 3 - (written.length % 3) : 3;
  if (!has && !google && quotes.length === 0) return null;
  return (
    <section className="sec">
      <div className="wrap stack" style={{ gap: 28 }}>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">{hi ? 'मरीज़ों की राय' : "In patients' words"}</span>
          <h2 className="h2">{hi ? 'मरीज़ क्या कहते हैं' : 'What patients say'}</h2>
        </div>
        {(has || google) && (
          <div className="row" style={{ gap: 16 }}>
            {has && <Score value={sehat!.average!} label={hi ? 'सेहतसंधि' : 'Sehatsandhi'} sub={hi ? `विज़िट के बाद ${sehat!.count} रेटिंग` : `${sehat!.count} ratings after a visit`} />}
            {google && <Score value={google.rating!} label="Google" sub={hi ? 'सभी समीक्षाएँ पढ़ें →' : 'Read all reviews →'} href={google.url || s.social?.google} />}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
          {written.map((r, i) => (
            <figure key={`s${i}`} className="card stack" style={{ margin: 0, padding: 24, gap: 12 }}>
              <Stars n={r.rating} />
              <blockquote style={{ margin: 0, fontSize: 17, lineHeight: 1.65 }}>{r.text}</blockquote>
              <figcaption className="row muted small" style={{ alignItems: 'center', gap: 6, marginTop: 'auto' }}><Check size={16} color="var(--ok)" />{hi ? 'सत्यापित विज़िट' : 'Verified visit'} · Sehatsandhi · {dateText(r.on, c)}</figcaption>
            </figure>
          ))}
          {quotes.slice(0, fill).map((q) => (
            <figure key={q.name + q.text.slice(0, 20)} className="card stack" style={{ margin: 0, padding: 24, gap: 12 }}>
              <blockquote style={{ margin: 0, fontSize: 17, lineHeight: 1.65 }}>{q.text}</blockquote>
              <figcaption className="muted small" style={{ marginTop: 'auto' }}><b style={{ fontWeight: 700, color: 'var(--ink)' }}>{q.name}</b>{q.source ? ` · ${q.source}` : ''}{q.when ? ` · ${q.when}` : ''}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
