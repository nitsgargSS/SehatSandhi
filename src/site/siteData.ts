import { supabase } from '../lib/supabase'

// A business's website (0282): what sehat_public_site hands out. Text the
// business writes is {en, hi}; anything Hindi it has not written falls back
// to English.

export type Lang = 'en' | 'hi'
export type L10n = { en?: string; hi?: string }
export const tr = (v: L10n | string | null | undefined, lang: Lang): string =>
  !v ? '' : typeof v === 'string' ? v : (lang === 'hi' ? v.hi || v.en : v.en || v.hi) ?? ''

export interface SiteContent {
  kicker?: L10n; tagline?: L10n; intro?: L10n
  google?: { rating?: number; url?: string }
  doctor?: {
    name: string; role?: L10n; qualification?: L10n; summary?: L10n; bio?: L10n
    photo_url?: string; avatar_url?: string
    training?: { title: string; place: string; short?: string }[]
    team?: { photo_url?: string; text?: L10n }
  }
  highlights?: { value: string; label: L10n }[]
  treatments_title?: L10n; treatments_intro?: L10n; not_sure?: L10n
  treatments?: { slug: string; title: L10n; teaser?: L10n; body?: L10n; featured?: boolean }[]
  technology?: { title?: L10n; intro?: L10n; items: { name: L10n; image_url?: string }[] }
  testimonials?: { text: string; name: string; when?: string; source?: string }[]
  insurance?: { title?: L10n; intro?: L10n; points?: L10n[]; panel?: string[]; note?: L10n }
  visit?: { phone?: string; hours?: L10n[]; address?: L10n; photo_url?: string }
  social?: { google?: string; facebook?: string; instagram?: string; youtube?: string; justdial?: string }
}

export interface PublicSite {
  site: { slug: string; custom_domain: string | null; template: string; brand_color: string | null; logo_url: string | null; hero_image_url: string | null; content: SiteContent }
  business: { id: string; name: string; vertical: string; category: string | null; address: string | null; phone: string | null; working_hours: string | null; photo_url: string | null; qr_code: string | null; city: string | null; district: string | null; pin_code: string | null }
  doctors: { practitioner_id: string; full_name: string; qualification: string | null; speciality: string | null; fee: number | null; reg_verified: boolean }[]
  rating: { average: number | null; count: number } | null
  reviews: { rating: number; text: string; on: string }[]
  articles: ArticleMeta[]
  camps: { title: string; description: string | null; from: string; to: string | null; time: string | null }[]
}
export interface ArticleMeta { slug: string; lang: Lang; title: string; summary: string | null; image_url: string | null; read_minutes: number | null; published_on: string | null }
export interface Article extends ArticleMeta { body: string; author: string | null }

export async function getSite(key: string): Promise<PublicSite | null> {
  const { data, error } = await supabase.rpc('sehat_public_site', { p_key: key })
  if (error) throw new Error(error.message)
  return (data as PublicSite | null) ?? null
}

export async function getArticle(key: string, slug: string): Promise<Article | null> {
  const { data, error } = await supabase.rpc('sehat_public_site', { p_key: key, p_article: slug })
  if (error) throw new Error(error.message)
  return (data as Article | null) ?? null
}

/**
 * The site a hostname stands for, or null for Sehatsandhi itself:
 * <slug>.sehatsandhi.com, or a clinic's own domain. Our own hosts — the main
 * site, staging, Vercel previews, localhost — are never a clinic's site.
 */
export function siteKeyFromHost(host = window.location.hostname): string | null {
  const h = host.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app') || h.endsWith('.localhost')) return null
  if (h === 'sehatsandhi.com' || h === 'www.sehatsandhi.com') return null
  const sub = h.match(/^([a-z0-9-]+)\.sehatsandhi\.com$/)?.[1]
  if (sub) return ['www', 'staging', 'app', 'api', 'admin'].includes(sub) ? null : sub
  if (h.includes('sehatsandhi')) return null
  return h
}
