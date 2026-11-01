import { notFound } from 'next/navigation';

import { type Lang, type L10n, type PublicSite, WA_BOOKING, getSite } from '@/lib/sehat';

import { specialityName } from './specialities';

// What every page of a clinic site needs: the clinic's data, its language,
// links in that language, its public address and its contact links. Only
// Complete-package (tier 'full') sites are served here; free sites stay on
// Sehatsandhi's own one-page site.

export type B = { en: string; hi: string };

export const tr = (v: L10n | B | string | null | undefined, lang: Lang): string =>
  !v ? '' : typeof v === 'string' ? v : (lang === 'hi' ? v.hi || v.en : v.en || v.hi) ?? '';

export type Ctx = {
  key: string;
  lang: Lang;
  d: PublicSite;
  t: (v: L10n | B | string | null | undefined) => string;
  /** A path in this page's language: "/about/" → "/hi/about/" on Hindi pages. */
  href: (path: string) => string;
  /** The site's public origin, e.g. https://www.clinic.in */
  base: string;
  name: string;
  phone: { display: string; tel: string; wa: string } | null;
  bookUrl: string;
  /** The hospital layout (business_sites.template = 'hospital'). */
  hospital: boolean;
  /** WhatsApp booking for one doctor (the bot books into the hospital's queue). */
  bookDoctor: (name: string) => string;
};

export const langPath = (lang: Lang, path: string) => (lang === 'hi' ? (path === '/' ? '/hi/' : `/hi${path}`) : path);

export async function load(key: string, lang: Lang): Promise<Ctx> {
  const d = await getSite(decodeURIComponent(key));
  if (!d || d.site.tier !== 'full') notFound();
  // From the stored domain, not the request, so pages can be cached per clinic.
  const base = d.site.custom_domain
    ? `https://www.${d.site.custom_domain.replace(/^www\./, '')}`
    : `https://${d.site.slug}.sehatsandhi.com`;
  const raw = (d.site.content.visit?.phone || d.business.phone || '').trim();
  const digits = raw.replace(/[^\d]/g, '').replace(/^0+/, '');
  const intl = digits.length === 10 ? `91${digits}` : digits;
  const phone = intl ? { display: raw || `+${intl}`, tel: `tel:+${intl}`, wa: `https://wa.me/${intl}` } : null;
  const bookUrl = d.business.qr_code
    ? `https://wa.me/${WA_BOOKING}?text=${encodeURIComponent(`Hi ${d.business.qr_code} (${d.business.name}) — I want to book an appointment`)}`
    : phone?.tel ?? '#contact';
  const bookDoctor = (doc: string) => d.business.qr_code
    ? `https://wa.me/${WA_BOOKING}?text=${encodeURIComponent(`Hi ${d.business.qr_code} (${d.business.name}) — I want to book an appointment with ${doc}`)}`
    : bookUrl;
  return {
    key: decodeURIComponent(key), lang, d,
    t: (v) => tr(v, lang),
    href: (path) => langPath(lang, path),
    base, name: d.business.name, phone, bookUrl,
    hospital: d.site.template === 'hospital',
    bookDoctor,
  };
}

/** The doctor the site is about: the Website tab's doctor, else the first listed doctor. */
export function leadDoctor(d: PublicSite) {
  const c = d.site.content.doctor;
  if (c?.name) return c;
  const x = d.doctors[0];
  return x ? { name: x.full_name, qualification: x.qualification ? { en: x.qualification } : undefined, role: x.speciality ? { en: x.speciality } : undefined } : null;
}

/** Opening hours as one line. */
export const hoursLine = (c: Ctx) => {
  const v = c.d.site.content.visit?.hours;
  return v?.length ? v.map((x) => c.t(x)).join(' · ') : c.d.business.working_hours ?? '';
};

export type Department = { slug: string; title: B; teaser?: L10n; body?: L10n; image_url?: string; doctors: PublicSite['doctors'] };

/**
 * A hospital's departments: the ones it wrote in the Website tab (each matched
 * to its doctors by speciality code), else one per speciality its doctors have.
 * Doctors whose speciality matches no written department get one of their own.
 */
export function departments(d: PublicSite): Department[] {
  const written = d.site.content.departments ?? [];
  const code = (x: string | null) => (x ?? '').toUpperCase();
  const out: Department[] = written.map((w) => ({
    slug: w.slug,
    title: { en: w.title.en || w.title.hi || '', hi: w.title.hi || w.title.en || '' },
    teaser: w.teaser, body: w.body, image_url: w.image_url,
    doctors: d.doctors.filter((x) => w.speciality && code(x.speciality) === code(w.speciality)),
  }));
  const covered = new Set(written.map((w) => code(w.speciality ?? '')));
  for (const doc of d.doctors) {
    const c = code(doc.speciality);
    if (covered.has(c)) continue;
    let dep = out.find((x) => x.slug === c.toLowerCase());
    if (!dep) { dep = { slug: (c || 'other').toLowerCase(), title: specialityName(c), doctors: [] }; out.push(dep); }
    dep.doctors.push(doc);
  }
  return out;
}

/** A doctor's photo, bio and OPD days from the Website tab, matched by name. */
export const profileOf = (d: PublicSite, name: string) =>
  (d.site.content.doctor_profiles ?? []).find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
