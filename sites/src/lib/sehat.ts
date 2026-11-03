// Everything a clinic website reads from Sehatsandhi — public functions only,
// called with the publishable key. Responses are cached for an hour, so what
// a clinic changes in its Website tab, and new posts, articles and ratings,
// appear within the hour without a release. If Sehatsandhi cannot be reached,
// callers get null and render without that section.

export const SEHAT_URL = process.env.NEXT_PUBLIC_SEHAT_URL || 'https://tbmlhawtnrvvnemcljma.supabase.co';
export const SEHAT_KEY = process.env.NEXT_PUBLIC_SEHAT_KEY || 'sb_publishable_jR4wrLIVtOuoe49mwrT3IA_yRGUBEb2';
/** Sehatsandhi's WhatsApp booking number (the bot books into the clinic's queue). */
export const WA_BOOKING = '917015399355';

export async function rpc<T>(fn: string, args: Record<string, unknown>, revalidate = 3600): Promise<T | null> {
  try {
    const r = await fetch(`${SEHAT_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SEHAT_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      next: { revalidate },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export type L10n = { en?: string; hi?: string };
export type Lang = 'en' | 'hi';

/** The Website tab's content (Sehatsandhi src/site/siteData.ts SiteContent). */
export interface SiteContent {
  kicker?: L10n; tagline?: L10n; intro?: L10n;
  font?: string;
  google?: { rating?: number; url?: string };
  doctor?: {
    name: string; role?: L10n; qualification?: L10n; summary?: L10n; bio?: L10n;
    photo_url?: string; avatar_url?: string;
    training?: { title: string; place: string; short?: string }[];
    team?: { photo_url?: string; text?: L10n };
  };
  highlights?: { value: string; label: L10n }[];
  treatments_title?: L10n; treatments_intro?: L10n; not_sure?: L10n;
  treatments?: { slug: string; title: L10n; teaser?: L10n; body?: L10n; featured?: boolean }[];
  technology?: { title?: L10n; intro?: L10n; items: { name: L10n; image_url?: string }[] };
  testimonials?: { text: string; name: string; when?: string; source?: string }[];
  insurance?: { title?: L10n; intro?: L10n; points?: L10n[]; panel?: string[]; note?: L10n };
  visit?: { phone?: string; hours?: L10n[]; address?: L10n; photo_url?: string };
  social?: { google?: string; facebook?: string; instagram?: string; youtube?: string; justdial?: string };
  // Hospital template (business_sites.template = 'hospital'); all optional.
  emergency?: { phone?: string; text?: L10n };
  /** Departments; when absent they are made from the doctors' specialities. */
  departments?: { slug: string; title: L10n; teaser?: L10n; body?: L10n; speciality?: string; image_url?: string }[];
  facilities?: { name: L10n; text?: L10n; image_url?: string }[];
  packages?: { name: L10n; includes?: L10n[]; price?: string; note?: L10n }[];
  patient_guide?: { title: L10n; body: L10n }[];
  /** Photos, bios and OPD days for doctors, matched to Sehatsandhi's doctors by name. */
  doctor_profiles?: { name: string; photo_url?: string; bio?: L10n; opd?: L10n }[];
}

export interface PublicSite {
  site: { slug: string; custom_domain: string | null; template: string; tier: 'free' | 'full'; brand_color: string | null; logo_url: string | null; hero_image_url: string | null; content: SiteContent };
  business: { id: string; name: string; vertical: string; category: string | null; address: string | null; phone: string | null; working_hours: string | null; photo_url: string | null; qr_code: string | null; city: string | null; district: string | null; pin_code: string | null; google_place_id?: string | null };
  doctors: { practitioner_id: string; full_name: string; qualification: string | null; speciality: string | null; fee: number | null; reg_verified: boolean }[];
  rating: { average: number | null; count: number } | null;
  reviews: { rating: number; text: string; on: string }[];
  articles: { slug: string; lang: Lang; title: string; summary: string | null; image_url: string | null; read_minutes: number | null; published_on: string | null }[];
  camps: { title: string; description: string | null; from: string; to: string | null; time: string | null }[];
}

export type SocialPost = {
  id: string; post_date: string; topic: string | null; headline_en: string | null; headline_hi: string | null;
  caption: string | null; image_url: string; story_url: string | null; reel_url: string | null;
};
export type Article = {
  slug: string; group: string; lang: Lang; title: string; summary: string | null; image_url: string | null;
  author: string | null; read_minutes: number | null; published_on: string | null; body?: string; has_twin?: boolean;
};
export type Reviews = { average: number | null; count: number; reviews: { rating: number; text: string; on: string }[] };

export const getSite = (key: string) => rpc<PublicSite | null>('sehat_public_site', { p_key: key });
export const getSocial = (key: string, limit = 12) => rpc<SocialPost[]>('sehat_public_social', { p_key: key, p_limit: limit });
export const getArticles = (key: string) => rpc<Article[]>('sehat_public_articles', { p_key: key });
export const getArticle = (key: string, group: string, lang: Lang) => rpc<Article | null>('sehat_public_article', { p_key: key, p_group: group, p_lang: lang });
export const getReviews = (key: string) => rpc<Reviews | null>('sehat_public_reviews', { p_key: key, p_limit: 6 });

/** 0319: a hospital listed on Sehatsandhi International — its approved photos
 *  and videos (null when not listed, or paused). */
export type IntlMedia = { hospital_id: string; media: { kind: 'photo' | 'video' | 'youtube'; path: string | null; youtube_id: string | null; category: string; caption: string | null }[] };
export const getIntlMedia = (key: string) => rpc<IntlMedia | null>('sehat_intl_site_media', { p_key: key });
export const intlMediaUrl = (path: string) => `${SEHAT_URL}/storage/v1/object/public/intl-media/${path}`;
