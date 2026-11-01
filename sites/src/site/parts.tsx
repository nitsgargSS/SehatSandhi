import type { B, Ctx } from './ctx';
import { Calendar, Whatsapp } from './icons';

// Shared page parts: the page title band and the closing "book a visit" band.

export function PageHero({ c, crumb, title, intro, children }: { c: Ctx; crumb: B; title: string; intro?: string; children?: React.ReactNode }) {
  return (
    <section className="page-hero">
      <div className="wrap stack" style={{ gap: 18, paddingBlock: '36px 44px' }}>
        <nav aria-label={c.lang === 'hi' ? 'आप यहाँ हैं' : 'Breadcrumb'} className="crumbs small">
          <a href={c.href('/')}>{c.lang === 'hi' ? 'होम' : 'Home'}</a> / <span aria-current="page">{c.t(crumb)}</span>
        </nav>
        <div className="row" style={{ gap: 28, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div className="stack" style={{ flex: '1 1 520px', gap: 14 }}>
            <h1>{title}</h1>
            {intro && <p className="lead muted" style={{ maxWidth: '42em' }}>{intro}</p>}
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

export function BookBand({ c }: { c: Ctx }) {
  return (
    <section className="sec" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="cta-band">
          <div className="stack" style={{ flex: '1 1 360px', gap: 8 }}>
            <h2 style={{ fontSize: 28 }}>{c.lang === 'hi' ? 'अपनी सेहत के बारे में सवाल?' : 'Questions about your health?'}</h2>
            <p style={{ fontSize: 17, opacity: 0.92 }}>{c.lang === 'hi' ? 'अपॉइंटमेंट बुक करें, या WhatsApp पर पूछें।' : 'Book a visit, or ask on WhatsApp.'}</p>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <a className="btn btn-light" href={c.bookUrl} rel="noopener"><Calendar />{c.lang === 'hi' ? 'अपॉइंटमेंट बुक करें' : 'Book appointment'}</a>
            {c.phone && <a className="btn btn-wa" href={c.phone.wa}><Whatsapp />WhatsApp</a>}
          </div>
        </div>
      </div>
    </section>
  );
}
