import type { Article, PublicSite, Reviews as ReviewsData, SocialPost } from '@/lib/sehat';

import { ArticleCard } from './articles';
import type { Ctx, Department } from './ctx';
import { departments, hoursLine, profileOf } from './ctx';
import { Calendar, Check, Clock, Phone, Pin, Star, Whatsapp } from './icons';
import { BookBand, PageHero } from './parts';
import Reviews from './reviews';
import { POST_GRID, PostCard } from './social';
import { specialityName } from './specialities';

// The hospital layout of the clinic-site template (business_sites.template =
// 'hospital'). Hospital first, then its departments and doctors. Departments
// and the doctor directory come from Sehatsandhi's list of the hospital's
// doctors, so they are never out of date; facilities, packages, the patient
// guide, emergency number and doctor photos are optional Website tab content.

type Doc = PublicSite['doctors'][number];

function initials(name: string) {
  return name.replace(/^dr\.?\s*/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function DoctorCard({ c, doc }: { c: Ctx; doc: Doc }) {
  const p = profileOf(c.d, doc.full_name);
  const hi = c.lang === 'hi';
  return (
    <article className="card stack" style={{ padding: 20, gap: 12, flex: 1 }}>
      <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'nowrap' }}>
        {p?.photo_url
          ? <img src={p.photo_url} alt={doc.full_name} width={72} height={72} loading="lazy" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--line)', background: '#fff', flex: 'none' }} />
          : <span aria-hidden style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--brand-tint)', color: 'var(--brand-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, flex: 'none' }}>{initials(doc.full_name)}</span>}
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <b className="card-title" style={{ fontSize: 19 }}>{doc.full_name}</b>
          {doc.qualification && <span className="muted small">{doc.qualification}</span>}
          <span className="small" style={{ color: 'var(--brand-strong)', fontWeight: 700 }}>{c.t(specialityName(doc.speciality))}</span>
        </div>
      </div>
      {p?.bio && <p className="muted" style={{ fontSize: 15 }}>{c.t(p.bio)}</p>}
      {p?.opd && <p className="row small" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Clock size={16} />{c.t(p.opd)}</p>}
      <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 'auto', justifyContent: 'space-between' }}>
        {doc.fee ? <span className="muted small">{hi ? 'परामर्श फ़ीस' : 'Consultation'} ₹{doc.fee}</span> : <span />}
        <a className="btn btn-primary" href={c.bookDoctor(doc.full_name)} rel="noopener" style={{ minHeight: 44, padding: '0 16px' }}><Calendar size={18} />{hi ? 'बुक करें' : 'Book'}</a>
      </div>
    </article>
  );
}

function EmergencyBand({ c }: { c: Ctx }) {
  const e = c.d.site.content.emergency;
  if (!e?.phone) return null;
  const digits = e.phone.replace(/[^\d]/g, '').replace(/^0+/, '');
  const tel = `tel:+${digits.length === 10 ? `91${digits}` : digits}`;
  return (
    <div className="card row" style={{ padding: '16px 20px', gap: 14, alignItems: 'center', borderColor: 'var(--danger)', background: 'var(--danger-tint)' }}>
      <span style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 18 }}>{c.lang === 'hi' ? '24×7 इमरजेंसी' : '24×7 Emergency'}</span>
      <span style={{ flex: '1 1 200px' }}>{c.t(e.text) || (c.lang === 'hi' ? 'दिन-रात इमरजेंसी सेवा।' : 'Emergency care, day and night.')}</span>
      <a className="btn btn-primary" href={tel} style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}><Phone />{e.phone}</a>
    </div>
  );
}

export function HospitalHome({ c, posts, reviews, articles }: { c: Ctx; posts: SocialPost[] | null; reviews: ReviewsData | null; articles: Article[] }) {
  const s = c.d.site.content;
  const hi = c.lang === 'hi';
  const deps = departments(c.d);
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.name, c.d.business.address || c.t(s.visit?.address), c.d.business.city].filter(Boolean).join(', '))}`;
  const hero = c.d.site.hero_image_url || s.visit?.photo_url || c.d.business.photo_url;
  return (
    <>
      {/* Hero: the hospital */}
      <section style={{ paddingBlock: '44px 48px' }}>
        <div className="wrap hero-grid">
          <div className="stack" style={{ flex: '1 1 480px', gap: 16 }}>
            {s.kicker && <span className="eyebrow">{c.t(s.kicker)}</span>}
            <h1>{c.name}</h1>
            {s.tagline && <p className="lead" style={{ fontWeight: 700, color: 'var(--brand-strong)' }}>{c.t(s.tagline)}</p>}
            {s.intro && <p className="muted">{c.t(s.intro)}</p>}
            <div className="row" style={{ gap: 12, paddingTop: 6 }}>
              <a className="btn btn-primary" href={c.bookUrl} rel="noopener"><Calendar />{hi ? 'अपॉइंटमेंट बुक करें' : 'Book appointment'}</a>
              <a className="btn btn-ghost" href={c.href('/doctors/')}>{hi ? 'डॉक्टर खोजें' : 'Find a doctor'}</a>
            </div>
          </div>
          {hero && (
            <figure style={{ flex: '1 1 440px', margin: 0 }}>
              <img className="photo" src={hero} alt={c.name} width={1200} height={800} fetchPriority="high" style={{ aspectRatio: '3 / 2', height: 'auto', borderRadius: 24 }} />
            </figure>
          )}
        </div>
        <div className="wrap" style={{ marginTop: 24 }}><EmergencyBand c={c} /></div>
      </section>

      {/* Key figures */}
      {(s.highlights?.length || reviews?.count || c.d.doctors.length) ? (
        <section className="band">
          <div className="wrap trust">
            {c.d.doctors.length > 1 && <div><span className="trust-big">{c.d.doctors.length}</span><span className="muted small">{hi ? 'डॉक्टर' : 'doctors'}</span></div>}
            {deps.length > 1 && <div><span className="trust-big">{deps.length}</span><span className="muted small">{hi ? 'विभाग' : 'departments'}</span></div>}
            {(s.highlights ?? []).slice(0, 3).map((h) => <div key={h.value + c.t(h.label)}><span className="trust-big">{h.value}</span><span className="muted small">{c.t(h.label)}</span></div>)}
            {reviews?.count && reviews.average != null ? <div><span className="trust-big">{reviews.average.toFixed(1)} <Star size={20} /></span><span className="muted small">{hi ? `${reviews.count} मरीज़ों की रेटिंग` : `${reviews.count} patient ratings`}</span></div> : null}
          </div>
        </section>
      ) : null}

      {/* Departments */}
      {deps.length > 0 && (
        <section className="sec">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}><span className="eyebrow">{hi ? 'विभाग' : 'Departments'}</span><h2 className="h2">{c.t(s.treatments_title) || (hi ? 'हमारे विभाग' : 'Our departments')}</h2></div>
              <a href={c.href('/departments/')} style={{ fontWeight: 700 }}>{hi ? 'सभी विभाग →' : 'All departments →'}</a>
            </div>
            <div className="grid-cards grid-4">
              {deps.slice(0, 12).map((x) => (
                <a key={x.slug} className="card stack" href={c.href(`/departments/#${x.slug}`)} style={{ padding: 20, gap: 6, textDecoration: 'none', color: 'var(--ink)' }}>
                  <span className="card-title" style={{ fontSize: 19 }}>{c.t(x.title)}</span>
                  {x.teaser ? <span className="muted" style={{ fontSize: 15 }}>{c.t(x.teaser)}</span> : x.doctors.length > 0 && <span className="muted small">{x.doctors.length} {hi ? 'डॉक्टर' : x.doctors.length === 1 ? 'doctor' : 'doctors'}</span>}
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Doctors */}
      {c.d.doctors.length > 0 && (
        <section className="sec band">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}><span className="eyebrow">{hi ? 'हमारे डॉक्टर' : 'Our doctors'}</span><h2 className="h2">{hi ? 'अपने डॉक्टर से मिलें' : 'Meet our doctors'}</h2></div>
              <a href={c.href('/doctors/')} style={{ fontWeight: 700 }}>{hi ? 'सभी डॉक्टर →' : 'All doctors →'}</a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 18 }}>
              {c.d.doctors.slice(0, 6).map((x) => <DoctorCard key={x.practitioner_id} c={c} doc={x} />)}
            </div>
          </div>
        </section>
      )}

      {/* Facilities */}
      {s.facilities?.length ? (
        <section className="sec">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}><span className="eyebrow">{hi ? 'सुविधाएँ' : 'Facilities'}</span><h2 className="h2">{hi ? 'एक ही छत के नीचे' : 'Under one roof'}</h2></div>
              <a href={c.href('/facilities/')} style={{ fontWeight: 700 }}>{hi ? 'सभी सुविधाएँ →' : 'All facilities →'}</a>
            </div>
            <div className="grid-cards grid-4">
              {s.facilities.slice(0, 8).map((f) => (
                <div key={c.t(f.name)} className="card stack" style={{ overflow: 'hidden', gap: 0 }}>
                  {f.image_url && <img src={f.image_url} alt={c.t(f.name)} loading="lazy" style={{ width: '100%', height: 'auto', aspectRatio: '4 / 3', objectFit: 'cover' }} />}
                  <div className="stack" style={{ padding: 16, gap: 4 }}><b className="card-title" style={{ fontSize: 18 }}>{c.t(f.name)}</b>{f.text && <span className="muted small">{c.t(f.text)}</span>}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Packages */}
      {s.packages?.length ? (
        <section className="sec band">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}><span className="eyebrow">{hi ? 'पैकेज' : 'Packages'}</span><h2 className="h2">{hi ? 'हेल्थ चेक-अप पैकेज' : 'Health check-up packages'}</h2></div>
              <a href={c.href('/packages/')} style={{ fontWeight: 700 }}>{hi ? 'सभी पैकेज →' : 'All packages →'}</a>
            </div>
            <PackageGrid c={c} items={s.packages.slice(0, 3)} />
          </div>
        </section>
      ) : null}

      {posts && posts.length > 0 && (
        <section className="sec">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}><span className="eyebrow">{hi ? 'इस हफ़्ते' : 'This week'}</span><h2 className="h2">{hi ? 'सेहत के नए टिप्स' : 'Latest health tips'}</h2></div>
              <a href={c.href('/social/')} style={{ fontWeight: 700 }}>{hi ? 'सभी पोस्ट →' : 'All posts →'}</a>
            </div>
            <div style={POST_GRID}>{posts.slice(0, 3).map((p) => <a key={p.id} href={c.href('/social/')} style={{ textDecoration: 'none', color: 'var(--ink)' }}><PostCard c={c} p={p} compact /></a>)}</div>
          </div>
        </section>
      )}

      <Reviews c={c} sehat={reviews} />

      {s.insurance && (s.insurance.panel?.length || s.insurance.intro) ? (
        <section className="sec band" id="insurance">
          <div className="wrap row" style={{ gap: 40, alignItems: 'flex-start' }}>
            <div className="stack" style={{ flex: '1 1 380px', gap: 12 }}>
              <span className="eyebrow">{hi ? 'बीमा' : 'Insurance'}</span>
              <h2 className="h2">{c.t(s.insurance.title) || (hi ? 'कैशलेस इलाज' : 'Cashless treatment')}</h2>
              {s.insurance.intro && <p className="muted">{c.t(s.insurance.intro)}</p>}
            </div>
            {s.insurance.panel?.length ? <ul className="row" style={{ flex: '1 1 420px', gap: 8 }}>{s.insurance.panel.map((n) => <li key={n} className="chip chip-neutral" style={{ background: 'var(--surface)' }}>{n}</li>)}</ul> : null}
          </div>
        </section>
      ) : null}

      {articles.length > 0 && (
        <section className="sec">
          <div className="wrap stack" style={{ gap: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div className="stack" style={{ gap: 10 }}><span className="eyebrow">{hi ? 'पढ़ें' : 'Read'}</span><h2 className="h2">{hi ? 'हमारे डॉक्टरों के लेख' : 'From our doctors'}</h2></div>
              <a href={c.href('/posts/')} style={{ fontWeight: 700 }}>{hi ? 'सभी लेख →' : 'All articles →'}</a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 500px), 1fr))', gap: 28 }}>{articles.slice(0, 4).map((a) => <ArticleCard key={a.slug} c={c} a={a} />)}</div>
          </div>
        </section>
      )}

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
              <a className="btn btn-ghost" href={c.href('/patients/')}>{hi ? 'मरीज़ों के लिए जानकारी' : 'Patient guide'}</a>
            </div>
          </div>
        </div>
      </section>

      <BookBand c={c} />
    </>
  );
}

function PackageGrid({ c, items }: { c: Ctx; items: NonNullable<PublicSite['site']['content']['packages']> }) {
  const hi = c.lang === 'hi';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 18 }}>
      {items.map((p) => (
        <article key={c.t(p.name)} className="card stack" style={{ padding: 22, gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <b className="card-title">{c.t(p.name)}</b>
            {p.price && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--brand-strong)' }}>{p.price}</span>}
          </div>
          {p.includes?.length ? <ul className="stack" style={{ gap: 6 }}>{p.includes.map((x) => <li key={c.t(x)} className="row small" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Check size={16} color="var(--ok)" />{c.t(x)}</li>)}</ul> : null}
          {p.note && <p className="muted small">{c.t(p.note)}</p>}
          <a className="btn btn-primary" href={c.bookUrl} rel="noopener" style={{ marginTop: 'auto', alignSelf: 'flex-start' }}><Calendar size={18} />{hi ? 'बुक करें' : 'Book'}</a>
        </article>
      ))}
    </div>
  );
}

export function DoctorsPage({ c }: { c: Ctx }) {
  const hi = c.lang === 'hi';
  const deps = departments(c.d).filter((x) => x.doctors.length > 0);
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Doctors', hi: 'डॉक्टर' }} title={hi ? 'हमारे डॉक्टर' : 'Our doctors'}
        intro={hi ? `${c.d.doctors.length} डॉक्टर, ${deps.length} विभाग। डॉक्टर चुनें और WhatsApp पर अपॉइंटमेंट बुक करें।` : `${c.d.doctors.length} doctors across ${deps.length} departments. Choose a doctor and book on WhatsApp.`}>
        {deps.length > 1 && (
          <nav aria-label={hi ? 'विभाग' : 'Departments'} className="row" style={{ gap: 8, flex: '1 1 320px' }}>
            {deps.map((x) => <a key={x.slug} className="chip chip-neutral" style={{ textDecoration: 'none', background: 'var(--surface)' }} href={`#${x.slug}`}>{c.t(x.title)}</a>)}
          </nav>
        )}
      </PageHero>
      <section className="sec">
        <div className="wrap stack" style={{ gap: 40 }}>
          {/* A smaller hospital (mostly one doctor per department): one grid, each
              card already names its department; anchors sit on each department's
              first card. A bigger one: a section per department. */}
          {deps.every((x) => x.doctors.length <= 2) ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 18 }}>
              {deps.flatMap((x) => x.doctors.map((d, i) => (
                <div key={d.practitioner_id} id={i === 0 ? x.slug : undefined} style={{ scrollMarginTop: 100, display: 'flex' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><DoctorCard c={c} doc={d} /></div>
                </div>
              )))}
            </div>
          ) : deps.map((x) => (
            <section key={x.slug} id={x.slug} className="stack" style={{ gap: 16, scrollMarginTop: 100 }}>
              <h2 className="h2" style={{ fontSize: 26 }}>{c.t(x.title)}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 18 }}>
                {x.doctors.map((d) => <DoctorCard key={d.practitioner_id} c={c} doc={d} />)}
              </div>
            </section>
          ))}
          {c.d.doctors.length === 0 && <p className="muted">{hi ? 'डॉक्टरों की जानकारी जल्द आएगी।' : 'Doctor details coming soon.'}</p>}
        </div>
      </section>
      <BookBand c={c} />
    </>
  );
}

export function DepartmentsPage({ c }: { c: Ctx }) {
  const hi = c.lang === 'hi';
  const deps = departments(c.d);
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Departments', hi: 'विभाग' }} title={c.t(c.d.site.content.treatments_title) || (hi ? 'हमारे विभाग' : 'Our departments')} intro={c.t(c.d.site.content.treatments_intro) || undefined} />
      <section className="sec">
        <div className="wrap stack" style={{ gap: 20 }}>
          {deps.map((x: Department) => (
            <article key={x.slug} id={x.slug} className="card stack" style={{ padding: 24, gap: 12, scrollMarginTop: 100 }}>
              <h2 style={{ fontSize: 24 }}>{c.t(x.title)}</h2>
              {x.teaser && <p className="lead" style={{ fontSize: 18 }}>{c.t(x.teaser)}</p>}
              {x.body && c.t(x.body).split(/\n{2,}/).map((p, i) => <p key={i} className="muted">{p}</p>)}
              {x.doctors.length > 0 && (
                <div className="stack" style={{ gap: 8 }}>
                  <span className="muted small">{hi ? 'इस विभाग के डॉक्टर' : 'Doctors in this department'}</span>
                  <ul className="row" style={{ gap: 8 }}>
                    {x.doctors.map((d) => <li key={d.practitioner_id}><a className="chip chip-neutral" style={{ textDecoration: 'none' }} href={c.href(`/doctors/#${x.slug}`)}>{d.full_name}</a></li>)}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      <BookBand c={c} />
    </>
  );
}

export function FacilitiesPage({ c }: { c: Ctx }) {
  const s = c.d.site.content;
  const hi = c.lang === 'hi';
  const items = [...(s.facilities ?? []), ...(s.technology?.items ?? []).map((t) => ({ name: t.name, image_url: t.image_url, text: undefined }))];
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Facilities', hi: 'सुविधाएँ' }} title={hi ? 'सुविधाएँ और उपकरण' : 'Facilities and equipment'} />
      <section className="sec">
        <div className="wrap">
          {items.length === 0 ? <p className="muted">{hi ? 'जानकारी जल्द आएगी।' : 'Details coming soon.'}</p> : (
            <div className="grid-cards grid-4">
              {items.map((f) => (
                <div key={c.t(f.name)} className="card stack" style={{ overflow: 'hidden', gap: 0 }}>
                  {f.image_url && <img src={f.image_url} alt={c.t(f.name)} loading="lazy" style={{ width: '100%', height: 'auto', aspectRatio: '4 / 3', objectFit: 'cover' }} />}
                  <div className="stack" style={{ padding: 16, gap: 4 }}><b className="card-title" style={{ fontSize: 18 }}>{c.t(f.name)}</b>{f.text && <span className="muted small">{c.t(f.text)}</span>}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <BookBand c={c} />
    </>
  );
}

export function PackagesPage({ c }: { c: Ctx }) {
  const hi = c.lang === 'hi';
  const items = c.d.site.content.packages ?? [];
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Packages', hi: 'पैकेज' }} title={hi ? 'हेल्थ चेक-अप पैकेज' : 'Health check-up packages'}
        intro={hi ? 'पैकेज बुक करने या जानकारी के लिए WhatsApp करें।' : 'Book a package or ask about it on WhatsApp.'} />
      <section className="sec">
        <div className="wrap">{items.length ? <PackageGrid c={c} items={items} /> : <p className="muted">{hi ? 'पैकेज की जानकारी जल्द आएगी।' : 'Package details coming soon.'}</p>}</div>
      </section>
      <BookBand c={c} />
    </>
  );
}

export function PatientsPage({ c }: { c: Ctx }) {
  const s = c.d.site.content;
  const hi = c.lang === 'hi';
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Patient guide', hi: 'मरीज़ों के लिए' }} title={hi ? 'मरीज़ों और परिवार के लिए जानकारी' : 'Information for patients and families'} />
      <section className="sec">
        <div className="wrap row" style={{ gap: 40, alignItems: 'flex-start' }}>
          <div className="stack" style={{ flex: '1 1 520px', gap: 14 }}>
            {(s.patient_guide ?? []).map((g) => (
              <details key={c.t(g.title)} className="card" style={{ padding: '16px 20px' }} open={false}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 18 }}>{c.t(g.title)}</summary>
                <div className="stack" style={{ gap: 8, marginTop: 10 }}>{c.t(g.body).split(/\n{2,}/).map((p, i) => <p key={i} className="muted">{p}</p>)}</div>
              </details>
            ))}
            {!s.patient_guide?.length && <p className="muted">{hi ? 'भर्ती, मिलने का समय और बिलिंग की जानकारी के लिए हमें कॉल करें।' : 'For admission, visiting hours and billing, please call us.'}</p>}
          </div>
          <div className="stack" style={{ flex: '1 1 320px', gap: 14 }}>
            <EmergencyBand c={c} />
            <div className="card stack" style={{ padding: 22, gap: 10 }}>
              <b className="card-title">{hi ? 'समय' : 'Hours'}</b>
              {hoursLine(c) && <p className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Clock />{hoursLine(c)}</p>}
              {c.phone && <p className="row" style={{ gap: 10 }}><Phone /><a href={c.phone.tel}>{c.phone.display}</a></p>}
              {c.phone && <a className="btn btn-wa" href={c.phone.wa} style={{ alignSelf: 'flex-start' }}><Whatsapp />WhatsApp</a>}
            </div>
            {s.insurance?.panel?.length ? (
              <div className="card stack" style={{ padding: 22, gap: 10 }}>
                <b className="card-title">{hi ? 'कैशलेस बीमा' : 'Cashless insurance'}</b>
                <ul className="row" style={{ gap: 6 }}>{s.insurance.panel.map((n) => <li key={n} className="chip chip-neutral">{n}</li>)}</ul>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
