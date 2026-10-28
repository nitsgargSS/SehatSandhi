import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, Route, Routes, useParams } from 'react-router-dom'
import { Phone, MapPin, Clock, Star, ArrowRight, MessageCircle, CalendarCheck, ShieldCheck, Facebook, Instagram, Youtube, Menu, X } from 'lucide-react'
import { getArticle, getSite, tr, type Article, type Lang, type PublicSite } from './siteData'
import Markdown from './Markdown'
import { clinicWaLink } from '../lib/qr'
import { WA_NUMBER, SPECIALITIES } from '../types'

// A business's website (0282), drawn from Sehatsandhi: what the business wrote
// for its site (business_sites.content, site_articles) and what the system
// already knows (doctors, fees, ratings, camps, the booking code), live.
//
// One template for now, laid out after SN Eye Hospital's own site — the pilot.
// Served at /s/<slug> on sehatsandhi.com; on <slug>.sehatsandhi.com or the
// clinic's own domain it is the whole page (main.tsx, base '').

const UI = {
  home: { en: 'Home', hi: 'होम' }, services: { en: 'Services', hi: 'सेवाएँ' }, doctor: { en: 'The doctor', hi: 'डॉक्टर' },
  insights: { en: 'Insights', hi: 'लेख' }, visit: { en: 'Visit us', hi: 'हमसे मिलें' }, call: { en: 'Call now', hi: 'कॉल करें' },
  book: { en: 'Book an appointment', hi: 'अपॉइंटमेंट बुक करें' }, bookWa: { en: 'Book on WhatsApp', hi: 'WhatsApp पर बुक करें' },
  meet: { en: 'Meet', hi: 'मिलें' }, onGoogle: { en: 'on Google', hi: 'Google पर' }, reviewsLink: { en: 'Read the reviews', hi: 'समीक्षाएँ पढ़ें' },
  background: { en: 'Read the full background', hi: 'पूरा परिचय पढ़ें' }, whatWeTreat: { en: 'What we treat', hi: 'हम क्या इलाज करते हैं' },
  allServices: { en: 'See all services', hi: 'सभी सेवाएँ देखें' }, equipment: { en: 'Equipment', hi: 'उपकरण' },
  words: { en: 'In their words', hi: 'मरीज़ों की ज़ुबानी' }, fromGoogle: { en: 'From Google reviews', hi: 'Google समीक्षाओं से' },
  allReviews: { en: 'See all reviews on Google', hi: 'Google पर सभी समीक्षाएँ' }, insurers: { en: 'Insurers and TPAs accepted', hi: 'मान्य बीमा कंपनियाँ और TPA' },
  written: { en: 'Written by the doctor', hi: 'डॉक्टर के लेख' }, allArticles: { en: 'All articles', hi: 'सभी लेख' },
  come: { en: 'Come see us', hi: 'हमसे मिलने आएँ' }, phone: { en: 'Phone', hi: 'फ़ोन' }, hours: { en: 'Hours', hi: 'समय' },
  address: { en: 'Address', hi: 'पता' }, directions: { en: 'Get directions', hi: 'रास्ता देखें' }, min: { en: 'min', hi: 'मिनट' },
  doctors: { en: 'Doctors and consultation fees', hi: 'डॉक्टर और परामर्श शुल्क' }, fee: { en: 'Consultation', hi: 'परामर्श' },
  camps: { en: 'Upcoming camps and offers', hi: 'आने वाले कैंप और ऑफ़र' }, training: { en: 'Training & fellowships', hi: 'प्रशिक्षण और फ़ेलोशिप' },
  team: { en: 'The team around her', hi: 'उनकी टीम' }, notSure: { en: 'Not sure what you need?', hi: 'तय नहीं कर पा रहे?' },
  findCondition: { en: 'Find your condition', hi: 'अपनी समस्या खोजें' }, back: { en: 'Back', hi: 'वापस' },
  myRecords: { en: 'Patient login: your prescriptions and reports', hi: 'मरीज़ लॉगिन: पर्चे और रिपोर्ट' },
  notFound: { en: 'This page is not here.', hi: 'यह पेज नहीं मिला।' }, powered: { en: 'Website and booking by', hi: 'वेबसाइट और बुकिंग' },
  ratedHere: { en: 'from patients who booked through us', hi: 'हमारे ज़रिए बुक करने वाले मरीज़ों से' },
} as const
type UIKey = keyof typeof UI

const LANG_KEY = 'site-lang'
const readLang = (): Lang => { try { return localStorage.getItem(LANG_KEY) === 'hi' ? 'hi' : 'en' } catch { return 'en' } }

const fmtDate = (d: string | null, lang: Lang) => d
  ? new Date(d + 'T00:00:00').toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

export function SiteFromPath() {
  const { slug = '' } = useParams()
  return <SiteApp siteKey={slug} base={`/s/${slug}`} />
}

export default function SiteApp({ siteKey, base }: { siteKey: string; base: string }) {
  const [data, setData] = useState<PublicSite | null | undefined>(undefined)
  const [lang, setLang] = useState<Lang>(readLang)
  useEffect(() => { getSite(siteKey).then(setData).catch(() => setData(null)) }, [siteKey])
  useEffect(() => { if (data) document.title = data.business.name }, [data])
  const switchLang = () => setLang(l => { const n: Lang = l === 'en' ? 'hi' : 'en'; try { localStorage.setItem(LANG_KEY, n) } catch { /* fine */ } return n })

  if (data === undefined) return <div style={{ minHeight: '100vh', background: '#f7f5f0' }} />
  if (data === null) return <Missing />

  const brand = data.site.brand_color || '#0f4c5c'
  const style = { '--site-brand': brand, '--site-ink': '#16232a', '--site-muted': '#5b6870', '--site-cream': '#f7f5f0', '--site-line': '#e6e1d6' } as CSSProperties
  const t = (k: UIKey) => tr(UI[k], lang)

  return (
    <div className="site-root" style={{ ...style, background: 'var(--site-cream)', color: 'var(--site-ink)', minHeight: '100vh', fontFamily: lang === 'hi' ? "'Noto Sans Devanagari','Manrope',system-ui,sans-serif" : "'Manrope','Noto Sans Devanagari',system-ui,sans-serif" }}>
      <style>{SITE_CSS}</style>
      <Header d={data} base={base} lang={lang} t={t} onLang={switchLang} />
      <Routes>
        <Route index element={<Home d={data} base={base} lang={lang} t={t} />} />
        <Route path="services" element={<Services d={data} lang={lang} t={t} />} />
        <Route path="about" element={<About d={data} lang={lang} t={t} />} />
        <Route path="posts" element={<Posts d={data} base={base} lang={lang} t={t} />} />
        <Route path="post/:article" element={<Post siteKey={siteKey} d={data} base={base} lang={lang} t={t} />} />
        <Route path="*" element={<Wrap><p style={{ padding: '80px 0' }}>{t('notFound')}</p></Wrap>} />
      </Routes>
      <Footer d={data} base={base} lang={lang} t={t} />
    </div>
  )
}

type P = { d: PublicSite; lang: Lang; t: (k: UIKey) => string; base?: string }

// ── Pieces ──────────────────────────────────────────────────────────────────

const Wrap = ({ children, style }: { children: ReactNode; style?: CSSProperties }) =>
  <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 20px', ...style }}>{children}</div>

const Kicker = ({ children }: { children: ReactNode }) =>
  <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--site-brand)', marginBottom: 10 }}>{children}</div>

const H2 = ({ children }: { children: ReactNode }) =>
  <h2 style={{ fontSize: 'clamp(26px,5vw,38px)', fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.15, margin: '0 0 14px' }}>{children}</h2>

// Doctors carry a speciality code (EYE, GYN…); the site prints its name.
const specialityName = (code: string | null, lang: Lang) => {
  const s = SPECIALITIES.find(x => x.id === code)
  return s ? (lang === 'hi' ? s.hi : s.en) : code ?? ''
}

function phoneOf(d: PublicSite) { return d.site.content.visit?.phone || d.business.phone || '' }
function telOf(d: PublicSite) { const p = phoneOf(d).replace(/[^\d+]/g, ''); return p ? `tel:${p.startsWith('+') ? p : '+91' + p.replace(/^0/, '')}` : '' }
function bookLink(d: PublicSite) { return d.business.qr_code ? clinicWaLink(WA_NUMBER, d.business.qr_code, d.business.name) : telOf(d) }

function BookButtons({ d, t, light = false }: { d: PublicSite; t: P['t']; light?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <a className="site-btn" href={bookLink(d)} target="_blank" rel="noreferrer"><CalendarCheck size={18} /> {t('book')}</a>
      {telOf(d) && <a className={light ? 'site-btn site-btn-ghost-light' : 'site-btn site-btn-ghost'} href={telOf(d)}><Phone size={17} /> {t('call')}</a>}
    </div>
  )
}

function Header({ d, base, lang, t, onLang }: P & { onLang: () => void }) {
  const [open, setOpen] = useState(false)
  const links: [string, UIKey][] = [[`${base}/`, 'home'], [`${base}/services`, 'services'], [`${base}/about`, 'doctor'], [`${base}/posts`, 'insights'], [`${base}/#visit`, 'visit']]
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(247,245,240,.94)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--site-line)' }}>
      <Wrap style={{ display: 'flex', alignItems: 'center', gap: 16, height: 68 }}>
        <Link to={`${base}/`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
          {d.site.logo_url && <img src={d.site.logo_url} alt="" style={{ height: 40, width: 'auto' }} />}
          <span style={{ fontWeight: 800, fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.business.name}</span>
        </Link>
        <nav className="site-nav" style={{ marginLeft: 'auto', display: 'flex', gap: 22 }}>
          {links.map(([to, k]) => to.includes('#')
            ? <a key={k} href={to} style={{ color: 'var(--site-ink)', textDecoration: 'none', fontWeight: 600, fontSize: 14.5 }}>{t(k)}</a>
            : <Link key={k} to={to} style={{ color: 'var(--site-ink)', textDecoration: 'none', fontWeight: 600, fontSize: 14.5 }}>{t(k)}</Link>)}
        </nav>
        <button onClick={onLang} className="site-lang" aria-label="Language">{lang === 'en' ? 'हिंदी' : 'English'}</button>
        {telOf(d) && <a href={telOf(d)} className="site-btn site-call" style={{ padding: '9px 14px' }}><Phone size={16} /> <span className="site-hide-sm">{t('call')}</span></a>}
        <button className="site-burger" onClick={() => setOpen(o => !o)} aria-label="Menu">{open ? <X size={22} /> : <Menu size={22} />}</button>
      </Wrap>
      {open && (
        <div className="site-drawer">
          {links.map(([to, k]) => to.includes('#')
            ? <a key={k} href={to} onClick={() => setOpen(false)}>{t(k)}</a>
            : <Link key={k} to={to} onClick={() => setOpen(false)}>{t(k)}</Link>)}
        </div>
      )}
    </header>
  )
}

function Home({ d, base, lang, t }: P) {
  const c = d.site.content
  const doc = c.doctor
  const featured = (c.treatments ?? []).filter(x => x.featured)
  const shownTreatments = featured.length ? featured : (c.treatments ?? []).slice(0, 4)
  const rating = c.google?.rating
  return (
    <main>
      {/* Hero */}
      <section style={{ padding: 'clamp(40px,8vw,88px) 0 clamp(36px,6vw,64px)' }}>
        <Wrap style={{ display: 'grid', gap: 40, alignItems: 'center' }} >
          <div className="site-hero">
            <div>
              {c.kicker && <Kicker>{tr(c.kicker, lang)}</Kicker>}
              <h1 style={{ fontSize: 'clamp(34px,7vw,60px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.05, margin: '0 0 18px' }}>{tr(c.tagline, lang) || d.business.name}</h1>
              {c.intro && <p style={{ fontSize: 'clamp(16px,2.6vw,19px)', color: 'var(--site-muted)', lineHeight: 1.6, margin: '0 0 26px', maxWidth: 560 }}>{tr(c.intro, lang)}</p>}
              <BookButtons d={d} t={t} />
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginTop: 22, fontSize: 14 }}>
                {doc && <Link to={`${base}/about`} style={{ color: 'var(--site-brand)', fontWeight: 700, textDecoration: 'none' }}>{t('meet')} {doc.name} →</Link>}
                {rating && (
                  <a href={c.google?.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--site-ink)', textDecoration: 'none' }}>
                    <Stars n={rating} /> <b>{rating}</b> {t('onGoogle')} · <span style={{ textDecoration: 'underline' }}>{t('reviewsLink')}</span>
                  </a>
                )}
              </div>
            </div>
            {d.site.hero_image_url && <img src={d.site.hero_image_url} alt="" className="site-hero-img" />}
          </div>
        </Wrap>
      </section>

      {/* The doctor */}
      {doc && (
        <section style={{ background: '#fff', borderTop: '1px solid var(--site-line)', borderBottom: '1px solid var(--site-line)', padding: 'clamp(40px,7vw,72px) 0' }}>
          <Wrap>
            <div className="site-two">
              <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                {(doc.avatar_url || doc.photo_url) && <img src={doc.avatar_url || doc.photo_url} alt={doc.name} style={{ width: 96, height: 96, borderRadius: 999, objectFit: 'cover', flex: '0 0 auto' }} />}
                <div>
                  <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 4px' }}>{doc.name}</h2>
                  <div style={{ color: 'var(--site-muted)', fontSize: 14.5, marginBottom: 12 }}>{tr(doc.qualification, lang)}</div>
                  <p style={{ fontSize: 17, lineHeight: 1.6, margin: 0 }}>{tr(doc.summary, lang)}</p>
                  <Link to={`${base}/about`} style={{ display: 'inline-block', marginTop: 14, color: 'var(--site-brand)', fontWeight: 700, textDecoration: 'none' }}>{t('background')} →</Link>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
                {(doc.training ?? []).filter(x => x.short).slice(0, 4).map(f => (
                  <div key={f.title} style={{ border: '1px solid var(--site-line)', borderRadius: 14, padding: 14, background: 'var(--site-cream)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{f.title}</div>
                    <div style={{ color: 'var(--site-muted)', fontSize: 13, marginTop: 4 }}>{f.short}</div>
                  </div>
                ))}
              </div>
            </div>
            {!!c.highlights?.length && (
              <div className="site-stats">
                {c.highlights.map(h => (
                  <div key={h.value + tr(h.label, 'en')}>
                    <div style={{ fontSize: 'clamp(30px,6vw,44px)', fontWeight: 800, color: 'var(--site-brand)', letterSpacing: '-.02em' }}>{h.value}</div>
                    <div style={{ color: 'var(--site-muted)', fontSize: 14 }}>{tr(h.label, lang)}</div>
                  </div>
                ))}
              </div>
            )}
          </Wrap>
        </section>
      )}

      {/* Treatments */}
      {!!shownTreatments.length && (
        <section style={{ padding: 'clamp(44px,8vw,84px) 0' }}>
          <Wrap>
            <Kicker>{t('whatWeTreat')}</Kicker>
            <H2>{tr(c.treatments_title, lang) || t('services')}</H2>
            <div className="site-grid4" style={{ marginTop: 24 }}>
              {shownTreatments.map(x => (
                <Link key={x.slug} to={`${base}/services#${x.slug}`} className="site-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{tr(x.title, lang)}</div>
                  <div style={{ color: 'var(--site-muted)', fontSize: 14, marginTop: 6 }}>{tr(x.teaser, lang)}</div>
                  <ArrowRight size={18} style={{ color: 'var(--site-brand)', marginTop: 14 }} />
                </Link>
              ))}
            </div>
            <Link to={`${base}/services`} style={{ display: 'inline-block', marginTop: 20, color: 'var(--site-brand)', fontWeight: 700, textDecoration: 'none' }}>{t('allServices')} →</Link>
          </Wrap>
        </section>
      )}

      {/* Doctors, live from Sehatsandhi */}
      {d.doctors.length > 1 && (
        <section style={{ padding: '0 0 clamp(44px,8vw,84px)' }}>
          <Wrap>
            <H2>{t('doctors')}</H2>
            <div className="site-grid3" style={{ marginTop: 18 }}>
              {d.doctors.map(x => (
                <div key={x.practitioner_id} className="site-card">
                  <div style={{ fontWeight: 800, fontSize: 16.5 }}>{x.full_name}{x.reg_verified && <ShieldCheck size={15} style={{ color: 'var(--site-brand)', marginLeft: 6, verticalAlign: '-2px' }} />}</div>
                  <div style={{ color: 'var(--site-muted)', fontSize: 13.5, marginTop: 4 }}>{[specialityName(x.speciality, lang), x.qualification].filter(Boolean).join(' · ')}</div>
                  {Number(x.fee) > 0 && <div style={{ marginTop: 10, fontSize: 14 }}>{t('fee')}: <b>₹{Number(x.fee).toLocaleString('en-IN')}</b></div>}
                </div>
              ))}
            </div>
          </Wrap>
        </section>
      )}

      {/* Equipment */}
      {!!c.technology?.items?.length && (
        <section style={{ background: 'var(--site-ink)', color: '#fff', padding: 'clamp(44px,8vw,84px) 0' }}>
          <Wrap>
            <Kicker><span style={{ color: '#9fd4d1' }}>{t('equipment')}</span></Kicker>
            <H2>{tr(c.technology.title, lang)}</H2>
            {c.technology.intro && <p style={{ color: '#c4d0d4', maxWidth: 620, lineHeight: 1.6, margin: '0 0 26px' }}>{tr(c.technology.intro, lang)}</p>}
            <div className="site-grid4">
              {c.technology.items.map(x => (
                <figure key={tr(x.name, 'en')} style={{ margin: 0 }}>
                  {x.image_url && <img src={x.image_url} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 14 }} />}
                  <figcaption style={{ marginTop: 10, fontWeight: 600, fontSize: 14.5 }}>{tr(x.name, lang)}</figcaption>
                </figure>
              ))}
            </div>
          </Wrap>
        </section>
      )}

      {/* Reviews */}
      {(!!c.testimonials?.length || !!d.reviews.length) && (
        <section style={{ padding: 'clamp(44px,8vw,84px) 0' }}>
          <Wrap>
            <Kicker>{t('words')}</Kicker>
            <H2>{c.testimonials?.length ? t('fromGoogle') : t('words')}</H2>
            <div className="site-grid2" style={{ marginTop: 18 }}>
              {(c.testimonials ?? []).map(x => (
                <blockquote key={x.name} className="site-card" style={{ margin: 0 }}>
                  <p style={{ fontSize: 16.5, lineHeight: 1.6, margin: 0 }}>“{x.text}”</p>
                  <div style={{ marginTop: 12, fontSize: 13.5, color: 'var(--site-muted)' }}><b style={{ color: 'var(--site-ink)' }}>{x.name}</b>{x.when ? ` · ${x.when}` : ''}</div>
                </blockquote>
              ))}
              {d.reviews.map((r, i) => (
                <blockquote key={i} className="site-card" style={{ margin: 0 }}>
                  <Stars n={r.rating} />
                  <p style={{ fontSize: 16, lineHeight: 1.6, margin: '8px 0 0' }}>“{r.text}”</p>
                </blockquote>
              ))}
            </div>
            {d.rating?.count ? <p style={{ marginTop: 14, color: 'var(--site-muted)', fontSize: 14 }}><Stars n={d.rating.average ?? 0} /> {d.rating.average} · {d.rating.count} {t('ratedHere')}</p> : null}
            {c.google?.url && <a href={c.google.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 12, color: 'var(--site-brand)', fontWeight: 700, textDecoration: 'none' }}>{t('allReviews')} →</a>}
          </Wrap>
        </section>
      )}

      {/* Camps */}
      {!!d.camps.length && (
        <section style={{ padding: '0 0 clamp(44px,8vw,84px)' }}>
          <Wrap>
            <H2>{t('camps')}</H2>
            <div className="site-grid2">
              {d.camps.map((x, i) => (
                <div key={i} className="site-card">
                  <div style={{ fontWeight: 800 }}>{x.title}</div>
                  <div style={{ color: 'var(--site-muted)', fontSize: 14, marginTop: 4 }}>{fmtDate(x.from, lang)}{x.to && x.to !== x.from ? ` – ${fmtDate(x.to, lang)}` : ''}{x.time ? ` · ${x.time}` : ''}</div>
                  {x.description && <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.55 }}>{x.description}</p>}
                </div>
              ))}
            </div>
          </Wrap>
        </section>
      )}

      {/* Insurance */}
      {c.insurance && (
        <section style={{ background: '#fff', borderTop: '1px solid var(--site-line)', borderBottom: '1px solid var(--site-line)', padding: 'clamp(44px,8vw,84px) 0' }}>
          <Wrap>
            <div className="site-two">
              <div>
                <H2>{tr(c.insurance.title, lang)}</H2>
                <p style={{ lineHeight: 1.6, color: 'var(--site-muted)' }}>{tr(c.insurance.intro, lang)}</p>
                {(c.insurance.points ?? []).map((p, i) => <p key={i} style={{ lineHeight: 1.6, borderLeft: '3px solid var(--site-brand)', paddingLeft: 12 }}>{tr(p, lang)}</p>)}
              </div>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 10 }}>{t('insurers')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(c.insurance.panel ?? []).map(x => <span key={x} style={{ border: '1px solid var(--site-line)', borderRadius: 999, padding: '6px 12px', fontSize: 13, background: 'var(--site-cream)' }}>{x}</span>)}
                </div>
                {c.insurance.note && <p style={{ marginTop: 14, fontSize: 14, color: 'var(--site-muted)' }}>{tr(c.insurance.note, lang)}</p>}
              </div>
            </div>
          </Wrap>
        </section>
      )}

      {/* Articles */}
      {!!d.articles.length && (
        <section style={{ padding: 'clamp(44px,8vw,84px) 0' }}>
          <Wrap>
            <Kicker>{t('insights')}</Kicker>
            <H2>{t('written')}</H2>
            <ArticleGrid d={d} base={base!} lang={lang} t={t} limit={6} />
            <Link to={`${base}/posts`} style={{ display: 'inline-block', marginTop: 20, color: 'var(--site-brand)', fontWeight: 700, textDecoration: 'none' }}>{t('allArticles')} →</Link>
          </Wrap>
        </section>
      )}

      <Visit d={d} lang={lang} t={t} />
    </main>
  )
}

function ArticleGrid({ d, base, lang, t, limit }: P & { base: string; limit?: number }) {
  return (
    <div className="site-grid3" style={{ marginTop: 18 }}>
      {d.articles.slice(0, limit ?? d.articles.length).map(a => (
        <Link key={a.slug} to={`${base}/post/${a.slug}`} className="site-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.35 }}>{a.title}</div>
          <div style={{ color: 'var(--site-muted)', fontSize: 13, marginTop: 8 }}>{fmtDate(a.published_on, lang)}{a.read_minutes ? ` · ${a.read_minutes} ${t('min')}` : ''}</div>
        </Link>
      ))}
    </div>
  )
}

function Visit({ d, lang, t }: P) {
  const v = d.site.content.visit ?? {}
  const address = tr(v.address, lang) || [d.business.address, d.business.city].filter(Boolean).join(', ')
  const hours = v.hours?.length ? v.hours.map(h => tr(h, lang)) : d.business.working_hours ? [d.business.working_hours] : []
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.business.name}, ${address.replace(/\n/g, ', ')}`)}`
  return (
    <section id="visit" style={{ background: 'var(--site-brand)', color: '#fff', padding: 'clamp(44px,8vw,84px) 0' }}>
      <Wrap>
        <div className="site-two">
          <div>
            <H2>{t('come')}</H2>
            <div style={{ display: 'grid', gap: 18, marginTop: 18 }}>
              {phoneOf(d) && <Fact icon={<Phone size={18} />} label={t('phone')}><a href={telOf(d)} style={{ color: '#fff' }}>{phoneOf(d)}</a></Fact>}
              {!!hours.length && <Fact icon={<Clock size={18} />} label={t('hours')}>{hours.map(h => <div key={h}>{h}</div>)}</Fact>}
              {address && <Fact icon={<MapPin size={18} />} label={t('address')}><div style={{ whiteSpace: 'pre-line' }}>{address}</div><a href={maps} target="_blank" rel="noreferrer" style={{ color: '#fff', fontWeight: 700 }}>{t('directions')} →</a></Fact>}
            </div>
            <div style={{ marginTop: 26 }}><BookButtons d={d} t={t} light /></div>
          </div>
          {v.photo_url && <img src={v.photo_url} alt="" style={{ width: '100%', borderRadius: 18, objectFit: 'cover', maxHeight: 420 }} />}
        </div>
      </Wrap>
    </section>
  )
}

const Fact = ({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) => (
  <div style={{ display: 'flex', gap: 12 }}>
    <span style={{ marginTop: 2, opacity: .85 }}>{icon}</span>
    <div><div style={{ fontSize: 12.5, letterSpacing: '.1em', textTransform: 'uppercase', opacity: .75, marginBottom: 4 }}>{label}</div><div style={{ fontSize: 16, lineHeight: 1.6 }}>{children}</div></div>
  </div>
)

function Stars({ n }: { n: number }) {
  return <span style={{ color: '#f2b01e', letterSpacing: 1 }} aria-label={`${n} of 5`}>{'★★★★★'.slice(0, Math.round(n))}<span style={{ color: '#d9d4c7' }}>{'★★★★★'.slice(Math.round(n))}</span></span>
}

function Services({ d, lang, t }: P) {
  const c = d.site.content
  useEffect(() => { const id = window.location.hash.slice(1); if (id) document.getElementById(id)?.scrollIntoView() }, [])
  return (
    <main style={{ padding: 'clamp(40px,7vw,72px) 0' }}>
      <Wrap>
        <Kicker>{t('services')}</Kicker>
        <h1 style={{ fontSize: 'clamp(32px,6vw,48px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 14px' }}>{t('findCondition')}</h1>
        {c.treatments_intro && <p style={{ fontSize: 18, color: 'var(--site-muted)', lineHeight: 1.6, maxWidth: 680 }}>{tr(c.treatments_intro, lang)}</p>}
        <div style={{ display: 'grid', gap: 14, marginTop: 28 }}>
          {(c.treatments ?? []).map((x, i) => (
            <section key={x.slug} id={x.slug} className="site-card" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 18, scrollMarginTop: 90 }}>
              <div style={{ fontWeight: 800, color: 'var(--site-brand)', fontSize: 14, paddingTop: 4 }}>{String(i + 1).padStart(2, '0')}</div>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{tr(x.title, lang)}</h2>
                <p style={{ margin: '8px 0 0', lineHeight: 1.65, fontSize: 16 }}>{tr(x.body, lang) || tr(x.teaser, lang)}</p>
              </div>
            </section>
          ))}
        </div>
        {c.not_sure && (
          <div className="site-card" style={{ marginTop: 28, background: 'var(--site-ink)', color: '#fff', border: 'none' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>{t('notSure')}</h2>
            <p style={{ margin: '0 0 16px', color: '#c4d0d4', lineHeight: 1.6 }}>{tr(c.not_sure, lang)}</p>
            <BookButtons d={d} t={t} light />
          </div>
        )}
      </Wrap>
    </main>
  )
}

function About({ d, lang, t }: P) {
  const doc = d.site.content.doctor
  if (!doc) return <Wrap><p style={{ padding: '80px 0' }}>{t('notFound')}</p></Wrap>
  return (
    <main style={{ padding: 'clamp(40px,7vw,72px) 0' }}>
      <Wrap>
        <div className="site-two" style={{ alignItems: 'start' }}>
          <div>
            <Kicker>{tr(doc.role, lang)}</Kicker>
            <h1 style={{ fontSize: 'clamp(34px,6vw,52px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 16px' }}>{doc.name}</h1>
            <Markdown text={tr(doc.bio, lang)} />
          </div>
          {doc.photo_url && <img src={doc.photo_url} alt={doc.name} style={{ width: '100%', borderRadius: 20, objectFit: 'cover', maxHeight: 520 }} />}
        </div>
        {!!doc.training?.length && (
          <>
            <h2 style={{ fontSize: 26, fontWeight: 800, margin: '44px 0 14px' }}>{t('training')}</h2>
            <div className="site-grid3">
              {doc.training.map(f => (
                <div key={f.title} className="site-card">
                  <div style={{ fontWeight: 800 }}>{f.title}</div>
                  <div style={{ color: 'var(--site-muted)', fontSize: 14, marginTop: 6 }}>{f.place}</div>
                </div>
              ))}
            </div>
          </>
        )}
        {!!d.site.content.highlights?.length && (
          <div className="site-stats">
            {d.site.content.highlights.map(h => (
              <div key={h.value}><div style={{ fontSize: 40, fontWeight: 800, color: 'var(--site-brand)' }}>{h.value}</div><div style={{ color: 'var(--site-muted)' }}>{tr(h.label, lang)}</div></div>
            ))}
          </div>
        )}
        {doc.team && (
          <div className="site-two" style={{ marginTop: 44, alignItems: 'center' }}>
            <div><h2 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 10px' }}>{t('team')}</h2><p style={{ lineHeight: 1.65, fontSize: 17 }}>{tr(doc.team.text, lang)}</p></div>
            {doc.team.photo_url && <img src={doc.team.photo_url} alt="" style={{ width: '100%', borderRadius: 20, objectFit: 'cover', maxHeight: 380 }} />}
          </div>
        )}
      </Wrap>
    </main>
  )
}

function Posts({ d, base, lang, t }: P) {
  return (
    <main style={{ padding: 'clamp(40px,7vw,72px) 0' }}>
      <Wrap>
        <Kicker>{t('insights')}</Kicker>
        <h1 style={{ fontSize: 'clamp(32px,6vw,48px)', fontWeight: 800, letterSpacing: '-.02em', margin: 0 }}>{t('written')}</h1>
        <ArticleGrid d={d} base={base!} lang={lang} t={t} />
      </Wrap>
    </main>
  )
}

function Post({ siteKey, d, base, lang, t }: P & { siteKey: string }) {
  const { article = '' } = useParams()
  const [a, setA] = useState<Article | null | undefined>(undefined)
  useEffect(() => { setA(undefined); getArticle(siteKey, article).then(setA).catch(() => setA(null)) }, [siteKey, article])
  useEffect(() => { if (a) document.title = `${a.title} · ${d.business.name}` }, [a, d.business.name])
  if (a === undefined) return <main style={{ minHeight: '60vh' }} />
  if (a === null) return <Wrap><p style={{ padding: '80px 0' }}>{t('notFound')}</p></Wrap>
  return (
    <main style={{ padding: 'clamp(40px,7vw,72px) 0' }}>
      <Wrap style={{ maxWidth: 760 }}>
        <Link to={`${base}/posts`} style={{ color: 'var(--site-brand)', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>← {t('insights')}</Link>
        <h1 style={{ fontSize: 'clamp(30px,6vw,44px)', fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.15, margin: '14px 0 10px' }}>{a.title}</h1>
        <div style={{ color: 'var(--site-muted)', fontSize: 14, marginBottom: 26 }}>{[a.author, fmtDate(a.published_on, lang), a.read_minutes ? `${a.read_minutes} ${t('min')}` : ''].filter(Boolean).join(' · ')}</div>
        <Markdown text={a.body} />
        <div className="site-card" style={{ marginTop: 36 }}>
          <div style={{ fontWeight: 800, marginBottom: 12 }}>{d.business.name}</div>
          <BookButtons d={d} t={t} />
        </div>
      </Wrap>
    </main>
  )
}

function Footer({ d, lang, t }: P) {
  const s = d.site.content.social ?? {}
  const icons: [string | undefined, ReactNode, string][] = [[s.facebook, <Facebook size={18} />, 'Facebook'], [s.instagram, <Instagram size={18} />, 'Instagram'], [s.youtube, <Youtube size={18} />, 'YouTube'], [s.google, <Star size={18} />, 'Google'], [s.justdial, <MessageCircle size={18} />, 'JustDial']]
  return (
    <footer style={{ padding: '36px 0 28px', borderTop: '1px solid var(--site-line)' }}>
      <Wrap style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 800 }}>{d.business.name}</div>
          <a href="https://www.sehatsandhi.com/my" style={{ fontSize: 13.5, color: 'var(--site-brand)', fontWeight: 600 }}>{t('myRecords')} →</a>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {icons.filter(([u]) => u).map(([u, ic, label]) => <a key={label} href={u} target="_blank" rel="noreferrer" aria-label={label} style={{ color: 'var(--site-ink)' }}>{ic}</a>)}
        </div>
      </Wrap>
      <Wrap style={{ marginTop: 18, fontSize: 12, color: 'var(--site-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>© {new Date().getFullYear()} {d.business.name}</span>
        <a href="https://www.sehatsandhi.com" style={{ color: 'var(--site-muted)' }}>{t('powered')} <b>Sehatsandhi</b></a>
      </Wrap>
      <span hidden>{lang}</span>
    </footer>
  )
}

function Missing() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f5f0', padding: 20, fontFamily: "'Manrope',system-ui,sans-serif", textAlign: 'center' }}>
      <div><h1 style={{ fontSize: 24 }}>This website is not available.</h1><a href="https://www.sehatsandhi.com" style={{ color: '#0f4c5c', fontWeight: 700 }}>Find doctors on Sehatsandhi →</a></div>
    </div>
  )
}

const SITE_CSS = `
.site-root a { -webkit-tap-highlight-color: transparent; }
.site-btn { display:inline-flex; align-items:center; gap:8px; background:var(--site-brand); color:#fff; font-weight:700; font-size:15.5px; padding:13px 20px; border-radius:12px; text-decoration:none; border:2px solid var(--site-brand); }
.site-btn-ghost { background:transparent; color:var(--site-brand); }
.site-btn-ghost-light { background:transparent; color:#fff; border-color:rgba(255,255,255,.7); }
.site-lang { border:1px solid var(--site-line); background:#fff; border-radius:10px; padding:7px 10px; font-weight:700; font-size:13.5px; cursor:pointer; font-family:inherit; }
.site-burger { display:none; background:none; border:0; cursor:pointer; color:var(--site-ink); padding:4px; }
.site-drawer { display:flex; flex-direction:column; padding:8px 20px 16px; border-top:1px solid var(--site-line); background:var(--site-cream); }
.site-drawer a { padding:12px 0; color:var(--site-ink); font-weight:700; text-decoration:none; border-bottom:1px solid var(--site-line); }
.site-card { background:#fff; border:1px solid var(--site-line); border-radius:18px; padding:20px; }
a.site-card:hover { border-color:var(--site-brand); }
.site-hero { display:grid; grid-template-columns:1.1fr .9fr; gap:44px; align-items:center; }
.site-hero-img { width:100%; aspect-ratio:4/5; object-fit:cover; border-radius:24px; }
.site-two { display:grid; grid-template-columns:1fr 1fr; gap:40px; }
.site-grid4 { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }
.site-grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
.site-grid2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.site-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; margin-top:36px; padding-top:28px; border-top:1px solid var(--site-line); }
.site-prose { font-size:17px; line-height:1.75; }
.site-prose h2 { font-size:24px; font-weight:800; margin:32px 0 10px; letter-spacing:-.01em; }
.site-prose h3 { font-size:19px; font-weight:800; margin:24px 0 8px; }
.site-prose p { margin:0 0 16px; }
.site-prose ul { margin:0 0 16px; padding-left:22px; }
.site-prose li { margin:6px 0; }
@media (max-width: 900px) {
  .site-nav { display:none !important; }
  .site-burger { display:block; }
  .site-hero, .site-two { grid-template-columns:1fr; gap:28px; }
  .site-hero-img { aspect-ratio:16/10; }
  .site-grid4, .site-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .site-grid3 { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media (max-width: 560px) {
  .site-grid3, .site-grid2 { grid-template-columns:1fr; }
  .site-hide-sm { display:none; }
}
`
