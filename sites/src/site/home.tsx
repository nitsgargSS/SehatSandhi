import type { Article, Reviews as ReviewsData, SocialPost } from '@/lib/sehat';

import type { Ctx } from './ctx';
import { hoursLine, leadDoctor } from './ctx';
import { Calendar, Clock, Phone, Pin, Star, Whatsapp } from './icons';
import { BookBand } from './parts';
import { ArticleCard } from './articles';
import { PostCard, POST_GRID } from './social';
import Reviews from './reviews';

// The home page of a clinic site. Every section comes from the clinic's
// Website tab or live Sehatsandhi data, and a section with nothing to show is
// left out — a clinic with only a doctor, treatments and hours still gets a
// complete page.

export default function Home({ c, posts, reviews, articles }: { c: Ctx; posts: SocialPost[] | null; reviews: ReviewsData | null; articles: Article[] }) {
  const s = c.d.site.content;
  const doc = leadDoctor(c.d);
  const photo = s.doctor?.photo_url || c.d.site.hero_image_url;
  const treatments = [...(s.treatments ?? [])].sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  const hi = c.lang === 'hi';
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.name, c.d.business.address || c.t(s.visit?.address), c.d.business.city].filter(Boolean).join(', '))}`;

  return (
    <>
      {/* Hero: the doctor (or the clinic) with what makes them trustworthy */}
      <section style={{ paddingBlock: '48px 56px' }}>
        <div className="wrap hero-grid">
          {photo && (
            <figure className="stack hero-photo" style={{ flex: '1 1 380px', gap: 12, margin: 0 }}>
              <div className="portrait-panel">
                <img src={photo} alt={doc?.name || c.name} width={960} height={1200} fetchPriority="high" style={{ objectFit: 'cover' }} />
              </div>
            </figure>
          )}
          <div className="stack" style={{ flex: '1 1 480px', gap: 16 }}>
            <span className="eyebrow">{doc ? (hi ? 'अपने डॉक्टर को जानें' : 'Know your doctor') : c.t(s.kicker) || c.d.business.category || ''}</span>
            <h1>{doc?.name || c.name}</h1>
            {doc?.qualification && <p style={{ fontWeight: 700, color: 'var(--brand-strong)' }}>{c.t(doc.qualification)}</p>}
            {doc?.role && <p className="muted">{c.t(doc.role)}{doc ? ` · ${c.name}` : ''}</p>}
            {(s.doctor?.summary || s.intro) && <p className="lead">{c.t(s.doctor?.summary || s.intro)}</p>}
            <div className="row" style={{ gap: 12, paddingTop: 6 }}>
              <a className="btn btn-primary" href={c.bookUrl} rel="noopener"><Calendar />{hi ? 'अपॉइंटमेंट बुक करें' : 'Book appointment'}</a>
              {c.phone && <a className="btn btn-wa" href={c.phone.wa}><Whatsapp />WhatsApp</a>}
            </div>
          </div>
        </div>
      </section>

      {/* The clinic in brief */}
      {(s.tagline || s.intro || treatments.length > 0) && doc && (
        <section className="band" style={{ background: 'var(--brand-tint)', borderColor: 'transparent' }}>
          <div className="wrap row" style={{ paddingBlock: 40, gap: 28, alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="stack" style={{ flex: '1 1 520px', gap: 10 }}>
              {s.kicker && <span className="eyebrow">{c.t(s.kicker)}</span>}
              <h2 className="h2">{c.t(s.tagline) || c.name}</h2>
              {s.intro && <p className="muted" style={{ maxWidth: '40em' }}>{c.t(s.intro)}</p>}
            </div>
            {treatments.length > 0 && (
              <ul className="row" style={{ flex: '1 1 340px', gap: 8 }}>
                {treatments.slice(0, 10).map((x) => <li key={x.slug}><a className="chip chip-neutral" style={{ textDecoration: 'none', background: 'var(--surface)' }} href={c.href(`/services/#${x.slug}`)}>{c.t(x.title)}</a></li>)}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Key figures */}
      {(s.highlights?.length || reviews?.count) ? (
        <section className="band">
          <div className="wrap trust">
            {(s.highlights ?? []).slice(0, 4).map((h) => (
              <div key={h.value + c.t(h.label)}>
                <span className="trust-big">{h.value}</span>
                <span className="muted small">{c.t(h.label)}</span>
              </div>
            ))}
            {reviews?.count && reviews.average != null ? (
              <div>
                <span className="trust-big">{reviews.average.toFixed(1)} <Star size={20} /></span>
                <span className="muted small">{hi ? `${reviews.count} मरीज़ों की रेटिंग` : `${reviews.count} patient ratings`}</span>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Treatments */}
      {treatments.length > 0 && (
        <section className="sec">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}>
                <span className="eyebrow">{hi ? 'हम क्या इलाज करते हैं' : 'What we treat'}</span>
                <h2 className="h2">{c.t(s.treatments_title) || (hi ? 'हमारे इलाज' : 'Our treatments')}</h2>
              </div>
              <a href={c.href('/services/')} style={{ fontWeight: 700 }}>{hi ? 'सभी इलाज →' : 'All treatments →'}</a>
            </div>
            <div className="grid-cards grid-4">
              {treatments.slice(0, 8).map((x) => (
                <a key={x.slug} className="card stack" href={c.href(`/services/#${x.slug}`)} style={{ padding: 22, gap: 8, textDecoration: 'none', color: 'var(--ink)' }}>
                  <span className="card-title">{c.t(x.title)}</span>
                  {x.teaser && <span className="muted" style={{ fontSize: 16 }}>{c.t(x.teaser)}</span>}
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Doctor's training and the team */}
      {s.doctor && (s.doctor.training?.length || s.doctor.team?.photo_url) ? (
        <section className="sec band">
          <div className="wrap row" style={{ gap: 48, alignItems: 'flex-start' }}>
            {s.doctor.training?.length ? (
              <div className="stack" style={{ flex: '1 1 440px', gap: 18 }}>
                <span className="eyebrow">{hi ? 'प्रशिक्षण व अनुभव' : 'Training & experience'}</span>
                <h2 className="h2">{s.doctor.name}</h2>
                <ol className="timeline">
                  {s.doctor.training.map((t) => <li key={t.title + t.place}><b style={{ fontWeight: 700 }}>{t.title}</b><br /><span className="muted small">{t.place}</span></li>)}
                </ol>
                <a className="btn btn-ghost" href={c.href('/about/')} style={{ alignSelf: 'flex-start' }}>{hi ? 'पूरी प्रोफ़ाइल' : 'Full profile'}</a>
              </div>
            ) : null}
            {s.doctor.team?.photo_url && (
              <figure className="stack" style={{ flex: '1 1 420px', maxWidth: 560, gap: 10, margin: 0 }}>
                <img className="photo" src={s.doctor.team.photo_url} alt={c.t(s.doctor.team.text) || c.name} loading="lazy" style={{ aspectRatio: '3 / 2', borderRadius: 24 }} />
                {s.doctor.team.text && <figcaption className="muted small">{c.t(s.doctor.team.text)}</figcaption>}
              </figure>
            )}
          </div>
        </section>
      ) : null}

      {/* Latest posts (Sehatsandhi social posts) */}
      {posts && posts.length > 0 && (
        <section className="sec">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}><span className="eyebrow">{hi ? 'इस हफ़्ते' : 'This week'}</span><h2 className="h2">{hi ? 'सेहत के नए टिप्स' : 'Latest health tips'}</h2></div>
              <a href={c.href('/social/')} style={{ fontWeight: 700 }}>{hi ? 'सभी पोस्ट →' : 'All posts →'}</a>
            </div>
            <div style={POST_GRID}>
              {posts.slice(0, 3).map((p) => <a key={p.id} href={c.href('/social/')} style={{ textDecoration: 'none', color: 'var(--ink)' }}><PostCard c={c} p={p} compact /></a>)}
            </div>
          </div>
        </section>
      )}

      {/* Equipment */}
      {s.technology?.items?.length ? (
        <section className="sec band">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="stack" style={{ gap: 10 }}>
              <span className="eyebrow">{hi ? 'हमारे उपकरण' : 'Our equipment'}</span>
              <h2 className="h2">{c.t(s.technology.title) || (hi ? 'जाँच और इलाज के उपकरण' : 'Equipment for tests and treatment')}</h2>
              {s.technology.intro && <p className="muted" style={{ maxWidth: '44em' }}>{c.t(s.technology.intro)}</p>}
            </div>
            <div className="grid-cards grid-4">
              {s.technology.items.map((x) => (
                <figure key={c.t(x.name)} className="card stack" style={{ margin: 0, overflow: 'hidden' }}>
                  {x.image_url && <img src={x.image_url} alt={c.t(x.name)} loading="lazy" style={{ width: '100%', height: 'auto', aspectRatio: '4 / 3', objectFit: 'cover', background: '#fff' }} />}
                  <figcaption className="card-title" style={{ padding: 16, fontSize: 18 }}>{c.t(x.name)}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <Reviews c={c} sehat={reviews} />

      {/* Insurance */}
      {s.insurance && (s.insurance.panel?.length || s.insurance.intro) ? (
        <section className="sec band" id="insurance">
          <div className="wrap row" style={{ gap: 40, alignItems: 'flex-start' }}>
            <div className="stack" style={{ flex: '1 1 380px', gap: 12 }}>
              <span className="eyebrow">{hi ? 'बीमा' : 'Insurance'}</span>
              <h2 className="h2">{c.t(s.insurance.title) || (hi ? 'कैशलेस इलाज' : 'Cashless treatment')}</h2>
              {s.insurance.intro && <p className="muted">{c.t(s.insurance.intro)}</p>}
              {s.insurance.points?.length ? <ul className="stack prose-list" style={{ gap: 6 }}>{s.insurance.points.map((p) => <li key={c.t(p)}>{c.t(p)}</li>)}</ul> : null}
            </div>
            {s.insurance.panel?.length ? (
              <ul className="row" style={{ flex: '1 1 420px', gap: 8 }}>
                {s.insurance.panel.map((n) => <li key={n} className="chip chip-neutral" style={{ background: 'var(--surface)' }}>{n}</li>)}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Articles */}
      {articles.length > 0 && (
        <section className="sec">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}><span className="eyebrow">{hi ? 'पढ़ें' : 'Read'}</span><h2 className="h2">{hi ? 'डॉक्टर के लेख' : "From the doctor's desk"}</h2></div>
              <a href={c.href('/posts/')} style={{ fontWeight: 700 }}>{hi ? 'सभी लेख →' : 'All articles →'}</a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 500px), 1fr))', gap: 28 }}>
              {articles.slice(0, 4).map((a) => <ArticleCard key={a.slug} c={c} a={a} />)}
            </div>
          </div>
        </section>
      )}

      {/* Visit */}
      <section className="sec band" id="visit">
        <div className="wrap row" style={{ gap: 40, alignItems: 'flex-start' }}>
          <div className="stack" style={{ flex: '1 1 380px', gap: 14 }}>
            <span className="eyebrow">{hi ? 'हम तक पहुँचें' : 'Visit us'}</span>
            <h2 className="h2">{c.name}</h2>
            {(c.t(s.visit?.address) || c.d.business.address) && <p className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Pin />{c.t(s.visit?.address) || c.d.business.address}</p>}
            {hoursLine(c) && <p className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Clock />{hoursLine(c)}</p>}
            {c.phone && <p className="row" style={{ gap: 10 }}><Phone /><a href={c.phone.tel}>{c.phone.display}</a></p>}
            <div className="row" style={{ gap: 10 }}>
              <a className="btn btn-primary" href={maps} rel="noopener"><Pin />{hi ? 'रास्ता देखें' : 'Get directions'}</a>
              <a className="btn btn-ghost" href={c.href('/contact/')}>{hi ? 'संदेश भेजें' : 'Send a message'}</a>
            </div>
          </div>
          {(s.visit?.photo_url || c.d.business.photo_url) && (
            <img className="photo" src={s.visit?.photo_url || c.d.business.photo_url || ''} alt={c.name} loading="lazy" style={{ flex: '1 1 420px', maxWidth: 560, aspectRatio: '3 / 2', borderRadius: 24 }} />
          )}
        </div>
      </section>

      <BookBand c={c} />
    </>
  );
}
