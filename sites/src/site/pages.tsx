import type { Reviews as ReviewsData } from '@/lib/sehat';

import type { Ctx } from './ctx';
import { hoursLine, leadDoctor } from './ctx';
import { Calendar, Clock, Phone, Pin, Whatsapp } from './icons';
import { BookBand, PageHero } from './parts';
import Reviews from './reviews';
import SiteForm, { type Field } from './siteform';

// The Doctor, Treatments and Contact pages of a clinic site.

export function DoctorPage({ c, reviews }: { c: Ctx; reviews: ReviewsData | null }) {
  const doc = leadDoctor(c.d);
  const s = c.d.site.content;
  const full = s.doctor;
  const hi = c.lang === 'hi';
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Doctor', hi: 'डॉक्टर' }} title={doc?.name || c.name} intro={[c.t(doc?.qualification), c.t(doc?.role)].filter(Boolean).join(' · ')}>
        <a className="btn btn-primary" href={c.bookUrl} rel="noopener"><Calendar />{hi ? 'अपॉइंटमेंट बुक करें' : 'Book appointment'}</a>
      </PageHero>
      <section className="sec">
        <div className="wrap row" style={{ gap: 48, alignItems: 'flex-start' }}>
          {full?.photo_url && <div className="portrait-panel" style={{ flex: '0 1 380px', margin: 0 }}><img src={full.photo_url} alt={full.name} width={960} height={1200} /></div>}
          <div className="stack" style={{ flex: '1 1 460px', gap: 16 }}>
            {full?.summary && <p className="lead">{c.t(full.summary)}</p>}
            {full?.bio && c.t(full.bio).split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            {full?.training?.length ? (
              <>
                <h2 className="h2" style={{ marginTop: 12 }}>{hi ? 'प्रशिक्षण व अनुभव' : 'Training & experience'}</h2>
                <ol className="timeline">{full.training.map((t) => <li key={t.title + t.place}><b style={{ fontWeight: 700 }}>{t.title}</b><br /><span className="muted small">{t.place}</span></li>)}</ol>
              </>
            ) : null}
            {c.d.doctors.length > 1 && (
              <>
                <h2 className="h2" style={{ marginTop: 12 }}>{hi ? 'हमारे डॉक्टर' : 'Our doctors'}</h2>
                <ul className="stack" style={{ gap: 10 }}>
                  {c.d.doctors.map((x) => <li key={x.practitioner_id} className="card" style={{ padding: '14px 18px' }}><b style={{ fontWeight: 700 }}>{x.full_name}</b>{x.qualification ? <span className="muted"> · {x.qualification}</span> : null}{x.speciality ? <span className="muted"> · {x.speciality}</span> : null}</li>)}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>
      {full?.team?.photo_url && (
        <section className="sec band">
          <div className="wrap row" style={{ gap: 40, alignItems: 'center' }}>
            <div className="stack" style={{ flex: '1 1 320px', gap: 10 }}>
              <span className="eyebrow">{hi ? 'टीम' : 'The team'}</span>
              <h2 className="h2">{hi ? 'हमारी टीम' : 'Our team'}</h2>
              {full.team.text && <p className="muted">{c.t(full.team.text)}</p>}
            </div>
            <img className="photo" src={full.team.photo_url} alt={c.t(full.team.text) || c.name} loading="lazy" style={{ flex: '1 1 480px', maxWidth: 640, aspectRatio: '3 / 2' }} />
          </div>
        </section>
      )}
      <Reviews c={c} sehat={reviews} />
      <BookBand c={c} />
    </>
  );
}

export function TreatmentsPage({ c }: { c: Ctx }) {
  const s = c.d.site.content;
  const list = [...(s.treatments ?? [])].sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  const hi = c.lang === 'hi';
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Treatments', hi: 'इलाज' }} title={c.t(s.treatments_title) || (hi ? 'हमारे इलाज' : 'Our treatments')} intro={c.t(s.treatments_intro) || undefined} />
      <section className="sec">
        <div className="wrap stack" style={{ gap: 18 }}>
          {list.length === 0 && <p className="muted">{hi ? 'जानकारी जल्द आएगी।' : 'Details coming soon.'}</p>}
          {list.map((x) => (
            <article key={x.slug} id={x.slug} className="card stack" style={{ padding: 24, gap: 10, scrollMarginTop: 100, maxWidth: 900 }}>
              <h2 style={{ fontSize: 24 }}>{c.t(x.title)}</h2>
              {x.teaser && <p className="lead" style={{ fontSize: 18 }}>{c.t(x.teaser)}</p>}
              {x.body && c.t(x.body).split(/\n{2,}/).map((p, i) => <p key={i} className="muted">{p}</p>)}
            </article>
          ))}
          {s.not_sure && (
            <div className="card stack" style={{ padding: 24, gap: 10, maxWidth: 900, background: 'var(--brand-tint)', borderColor: 'transparent' }}>
              <b className="card-title">{hi ? 'पक्का नहीं कि क्या चाहिए?' : 'Not sure what you need?'}</b>
              <p>{c.t(s.not_sure)}</p>
              <a className="btn btn-primary" href={c.bookUrl} rel="noopener" style={{ alignSelf: 'flex-start' }}><Calendar />{hi ? 'अपॉइंटमेंट बुक करें' : 'Book appointment'}</a>
            </div>
          )}
        </div>
      </section>
      <BookBand c={c} />
    </>
  );
}

const CONTACT_FIELDS: Field[] = [
  { name: 'name', label: { en: 'Your name', hi: 'आपका नाम' }, required: true, half: true },
  { name: 'phone', type: 'tel', label: { en: 'Phone / WhatsApp', hi: 'फ़ोन / WhatsApp' }, half: true },
  { name: 'email', type: 'email', label: { en: 'Email (optional)', hi: 'ईमेल (वैकल्पिक)' }, half: true },
  { name: 'subject', type: 'select', label: { en: 'About', hi: 'विषय' }, half: true, options: [
    { value: 'Appointment', label: { en: 'Appointment', hi: 'अपॉइंटमेंट' } },
    { value: 'Insurance / cashless', label: { en: 'Insurance / cashless', hi: 'बीमा / कैशलेस' } },
    { value: 'Reports', label: { en: 'Reports', hi: 'रिपोर्ट' } },
    { value: 'Other', label: { en: 'Something else', hi: 'कुछ और' } },
  ] },
  { name: 'message', type: 'textarea', label: { en: 'Your message', hi: 'आपका संदेश' }, required: true },
];

export function ContactPage({ c }: { c: Ctx }) {
  const s = c.d.site.content;
  const hi = c.lang === 'hi';
  const address = c.t(s.visit?.address) || c.d.business.address || '';
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.name, address, c.d.business.city].filter(Boolean).join(', '))}`;
  return (
    <>
      <PageHero c={c} crumb={{ en: 'Contact', hi: 'संपर्क' }} title={hi ? 'संपर्क करें' : 'Contact us'} intro={address || undefined}>
        <div className="row" style={{ gap: 10 }}>
          <a className="btn btn-primary" href={maps} rel="noopener"><Pin />{hi ? 'रास्ता देखें' : 'Get directions'}</a>
          {c.phone && <a className="btn btn-wa" href={c.phone.wa}><Whatsapp />WhatsApp</a>}
        </div>
      </PageHero>
      <section className="sec">
        <div className="wrap row" style={{ gap: 40, alignItems: 'flex-start' }}>
          <div className="stack" style={{ flex: '1 1 300px', gap: 14 }}>
            <h2 className="h2">{c.name}</h2>
            {address && <p className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Pin />{address}</p>}
            {hoursLine(c) && <p className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}><Clock />{hoursLine(c)}</p>}
            {c.phone && <p className="row" style={{ gap: 10 }}><Phone /><a href={c.phone.tel}>{c.phone.display}</a></p>}
            <a className="btn btn-primary" href={c.bookUrl} rel="noopener" style={{ alignSelf: 'flex-start' }}><Calendar />{hi ? 'अपॉइंटमेंट बुक करें' : 'Book appointment'}</a>
            <p className="muted small">{hi ? 'इमरजेंसी में कृपया कॉल करें या आएँ — यह फ़ॉर्म इस्तेमाल न करें।' : 'For an emergency, please call or come in — do not use this form.'}</p>
          </div>
          <div className="card" style={{ flex: '1 1 460px', padding: 24, minWidth: 0 }} id="message">
            <h2 style={{ fontSize: 24, marginBottom: 14 }}>{hi ? 'संदेश भेजें' : 'Send a message'}</h2>
            <SiteForm siteKey={c.key} lang={c.lang} kind="contact" fields={CONTACT_FIELDS}
              submit={{ en: 'Send message', hi: 'संदेश भेजें' }}
              done={{ en: 'Thank you — we have your message and will reply soon.', hi: 'धन्यवाद — आपका संदेश मिल गया है, हम जल्द जवाब देंगे।' }} />
          </div>
        </div>
      </section>
    </>
  );
}
