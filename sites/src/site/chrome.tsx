import type { Ctx } from './ctx';
import { hoursLine, langPath } from './ctx';
import { Calendar, Clock, MenuIcon, Phone, User, Whatsapp } from './icons';
import TextSize from './textsize';
import Tracker from './track';

// The frame around every page: utility bar (hours, phone, text size,
// language), header with the clinic's logo and menu, footer, and on phones a
// fixed Call / WhatsApp / Book bar. Book opens Sehatsandhi's WhatsApp booking
// for this clinic, so appointments land in the clinic's own queue.

const NAV: { key: string; href: string; label: { en: string; hi: string } }[] = [
  { key: 'services', href: '/services/', label: { en: 'Treatments', hi: 'इलाज' } },
  { key: 'doctor', href: '/about/', label: { en: 'Doctor', hi: 'डॉक्टर' } },
  { key: 'articles', href: '/posts/', label: { en: 'Articles', hi: 'लेख' } },
  { key: 'social', href: '/social/', label: { en: 'Health tips', hi: 'सेहत टिप्स' } },
  { key: 'contact', href: '/contact/', label: { en: 'Contact', hi: 'संपर्क' } },
];

function LangSwitch({ c, path }: { c: Ctx; path: string }) {
  return (
    <div className="lang-switch" role="group" aria-label={c.lang === 'hi' ? 'भाषा' : 'Language'}>
      {c.lang === 'en' ? <span aria-current="true">English</span> : <a href={langPath('en', path)} hrefLang="en" lang="en">English</a>}
      {c.lang === 'hi' ? <span aria-current="true" lang="hi">हिंदी</span> : <a href={langPath('hi', path)} hrefLang="hi" lang="hi">हिंदी</a>}
    </div>
  );
}

function Header({ c, path, current }: { c: Ctx; path: string; current?: string }) {
  const book = c.lang === 'hi' ? 'अपॉइंटमेंट बुक करें' : 'Book appointment';
  const s = c.d.site;
  return (
    <>
      <a className="skip" href="#main">{c.lang === 'hi' ? 'मुख्य सामग्री पर जाएँ' : 'Skip to content'}</a>
      <div className="utility">
        <div className="wrap utility-in">
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            {hoursLine(c) && <><Clock /><span className="hours-long">{hoursLine(c)}</span></>}
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 18 }}>
            <a href="https://www.sehatsandhi.com/my" className="row utility-records" style={{ alignItems: 'center', gap: 6 }}><User size={18} />{c.lang === 'hi' ? 'मेरी रिपोर्ट' : 'My records'}</a>
            {c.phone && <a href={c.phone.tel}>{c.phone.display}</a>}
            <TextSize lang={c.lang} />
            <LangSwitch c={c} path={path} />
          </div>
        </div>
      </div>
      <header className="site-header">
        <div className="wrap header-in">
          <a className="brand-link" href={c.href('/')}>
            {s.logo_url
              ? <img className="brand-logo" src={s.logo_url} alt={c.name} height={48} style={{ width: 'auto', maxWidth: 180 }} />
              : <span className="brand-name">{c.name}</span>}
            {(c.d.business.city || c.d.business.district) && <span className="brand-sub">{c.t(s.content.kicker) || c.d.business.category || ''}<br />{c.d.business.city || c.d.business.district}</span>}
          </a>
          <nav className="main-nav" aria-label="Main">
            {NAV.map((n) => <a key={n.key} className="navlink" href={c.href(n.href)} aria-current={current === n.key ? 'page' : undefined}>{c.t(n.label)}</a>)}
            <a className="btn btn-primary" href={c.bookUrl} rel="noopener" style={{ minHeight: 52 }}>{book}</a>
          </nav>
          <details className="menu">
            <summary aria-label={c.lang === 'hi' ? 'मेन्यू' : 'Menu'}><MenuIcon /></summary>
            <nav className="menu-panel" aria-label="Main">
              {NAV.map((n) => <a key={n.key} href={c.href(n.href)} aria-current={current === n.key ? 'page' : undefined}>{c.t(n.label)}</a>)}
              <a href="https://www.sehatsandhi.com/my">{c.lang === 'hi' ? 'मेरी रिपोर्ट' : 'My records'}</a>
              <a className="btn btn-primary" href={c.bookUrl} rel="noopener">{book}</a>
            </nav>
          </details>
        </div>
      </header>
    </>
  );
}

function Footer({ c }: { c: Ctx }) {
  const soc = c.d.site.content.social ?? {};
  const links: [string | undefined, string][] = [[soc.facebook, 'Facebook'], [soc.instagram, 'Instagram'], [soc.youtube, 'YouTube'], [soc.google, 'Google']];
  return (
    <footer className="site-footer">
      <div className="wrap stack" style={{ paddingBlock: '56px 28px', gap: 40 }}>
        <div className="foot-grid">
          <div className="stack" style={{ gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 21 }}>{c.name}</span>
            {(c.t(c.d.site.content.visit?.address) || c.d.business.address) && <span style={{ fontSize: 15, color: '#bfcad6' }}>{c.t(c.d.site.content.visit?.address) || c.d.business.address}</span>}
          </div>
          <nav aria-label={c.lang === 'hi' ? 'पेज' : 'Pages'} className="stack" style={{ gap: 8 }}>
            <b style={{ fontWeight: 600, color: '#fff' }}>{c.lang === 'hi' ? 'पेज' : 'Pages'}</b>
            {NAV.map((n) => <a key={n.key} href={c.href(n.href)}>{c.t(n.label)}</a>)}
          </nav>
          <div className="stack" style={{ gap: 8 }}>
            <b style={{ fontWeight: 600, color: '#fff' }}>{c.lang === 'hi' ? 'मरीज़ों के लिए' : 'Patients'}</b>
            <a href={c.bookUrl} rel="noopener">{c.lang === 'hi' ? 'अपॉइंटमेंट बुक करें' : 'Book appointment'}</a>
            <a href="https://www.sehatsandhi.com/my">{c.lang === 'hi' ? 'मेरी रिपोर्ट' : 'My records'}</a>
            {links.filter(([u]) => u).map(([u, l]) => <a key={l} href={u} rel="noopener">{l}</a>)}
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <b style={{ fontWeight: 600, color: '#fff' }}>{c.lang === 'hi' ? 'संपर्क' : 'Contact'}</b>
            {c.phone && <a href={c.phone.tel}>{c.phone.display}</a>}
            {c.phone && <a href={c.phone.wa}>WhatsApp</a>}
            {hoursLine(c) && <span style={{ color: '#bfcad6' }}>{hoursLine(c)}</span>}
          </div>
        </div>
        <div className="foot-base">
          <span>© {new Date().getFullYear()} {c.name}. {c.lang === 'hi' ? 'यहाँ दी गई जानकारी सामान्य है; अपनी सेहत के लिए डॉक्टर से मिलें।' : 'Information here is general; please see a doctor about your own health.'}</span>
          <span>{c.lang === 'hi' ? 'वेबसाइट और बुकिंग' : 'Website and booking by'} <a href="https://www.sehatsandhi.com" style={{ fontWeight: 600, color: '#fff' }}>Sehatsandhi</a></span>
        </div>
      </div>
    </footer>
  );
}

function QuickBar({ c }: { c: Ctx }) {
  return (
    <nav className="quickbar" aria-label={c.lang === 'hi' ? 'जल्दी संपर्क' : 'Quick contact'}>
      {c.phone && <a className="btn btn-ghost" href={c.phone.tel}><Phone />{c.lang === 'hi' ? 'कॉल' : 'Call'}</a>}
      {c.phone && <a className="btn btn-wa" href={c.phone.wa}><Whatsapp size={20} />WhatsApp</a>}
      <a className="btn btn-primary" href={c.bookUrl} rel="noopener"><Calendar size={20} />{c.lang === 'hi' ? 'बुक करें' : 'Book'}</a>
    </nav>
  );
}

/** The page frame. `path` is this page's English path, e.g. "/about/". */
export function Shell({ c, path, current, children }: { c: Ctx; path: string; current?: string; children: React.ReactNode }) {
  const style = c.d.site.brand_color && /^#[0-9a-f]{6}$/i.test(c.d.site.brand_color) ? ({ ['--brand' as string]: c.d.site.brand_color } as React.CSSProperties) : undefined;
  return (
    <div className="sn has-quickbar" lang={c.lang} style={style}>
      <Header c={c} path={path} current={current} />
      <main id="main">{children}</main>
      <Footer c={c} />
      <QuickBar c={c} />
      <Tracker siteKey={c.key} />
    </div>
  );
}
