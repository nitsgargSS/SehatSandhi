import type { Metadata } from 'next';

import type { Ctx } from './ctx';
import { langPath, leadDoctor } from './ctx';

// Page details for search engines: title, description, canonical address and
// the other-language twin; and the clinic and its doctor as structured data.

export function meta(c: Ctx, path: string, title: string, description: string, image?: string | null): Metadata {
  const url = `${c.base}${langPath(c.lang, path)}`;
  const img = image || c.d.site.hero_image_url || c.d.site.content.doctor?.photo_url || c.d.site.logo_url || undefined;
  return {
    title,
    description,
    metadataBase: new URL(c.base),
    alternates: {
      canonical: url,
      languages: { 'en-IN': `${c.base}${langPath('en', path)}`, 'hi-IN': `${c.base}${langPath('hi', path)}`, 'x-default': `${c.base}${langPath('en', path)}` },
    },
    openGraph: { title, description, url, siteName: c.name, type: 'website', locale: c.lang === 'hi' ? 'hi_IN' : 'en_IN', ...(img ? { images: [img] } : {}) },
    robots: { index: true, follow: true },
  };
}

export function clinicSchema(c: Ctx) {
  const d = c.d;
  const doc = leadDoctor(d);
  const s = d.site.content;
  const clinicId = `${c.base}/#clinic`;
  const docId = `${c.base}/#doctor`;
  const sameAs = [s.social?.google, s.social?.facebook, s.social?.instagram, s.social?.youtube, s.social?.justdial].filter(Boolean);
  return [
    {
      '@context': 'https://schema.org',
      '@type': ['MedicalClinic', 'MedicalOrganization'],
      '@id': clinicId,
      name: c.name,
      url: c.base,
      ...(d.site.logo_url ? { logo: d.site.logo_url } : {}),
      ...(d.site.hero_image_url ? { image: d.site.hero_image_url } : {}),
      ...(c.phone ? { telephone: `+${c.phone.tel.replace(/^tel:\+/, '')}` } : {}),
      address: {
        '@type': 'PostalAddress',
        streetAddress: c.t(s.visit?.address) || d.business.address || undefined,
        addressLocality: d.business.city || undefined,
        addressRegion: d.business.district || undefined,
        postalCode: d.business.pin_code || undefined,
        addressCountry: 'IN',
      },
      knowsLanguage: ['en', 'hi'],
      isAcceptingNewPatients: true,
      ...(s.treatments?.length ? { availableService: s.treatments.map((x) => ({ '@type': 'MedicalProcedure', name: x.title.en || x.title.hi, url: `${c.base}/services/#${x.slug}` })) } : {}),
      ...(sameAs.length ? { sameAs } : {}),
      ...(doc ? { employee: { '@id': docId } } : {}),
    },
    ...(doc ? [{
      '@context': 'https://schema.org',
      '@type': 'Physician',
      '@id': docId,
      name: doc.name,
      ...(doc.qualification ? { description: [c.t(doc.qualification), c.t(doc.role)].filter(Boolean).join(' · ') } : {}),
      ...('photo_url' in doc && doc.photo_url ? { image: doc.photo_url } : {}),
      ...('training' in doc && doc.training?.length ? { alumniOf: doc.training.map((t) => ({ '@type': 'EducationalOrganization', name: t.place })) } : {}),
      knowsLanguage: ['en', 'hi'],
      worksFor: { '@id': clinicId },
      url: `${c.base}/about/`,
    }] : []),
  ];
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
