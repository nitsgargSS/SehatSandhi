import { useEffect, useState } from 'react'
import { X, Tag } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../i18n/LanguageContext'

interface BannerOffer {
  code: string
  banner_text_en: string | null
  banner_text_hi: string | null
  valid_until: string | null
}

export default function OfferBanner() {
  const { lang } = useLanguage()
  const [offer, setOffer] = useState<BannerOffer | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const load = async () => {
      // No date filtering needed here — the RLS policy on
      // discount_codes already excludes anything outside its
      // valid_from/valid_until window, so an expired offer
      // simply stops being returned. That's what makes the
      // banner disappear on its own with no scheduled job.
      const { data } = await supabase
        .from('discount_codes')
        .select('code, banner_text_en, banner_text_hi, valid_until')
        .eq('show_on_banner', true)
        .order('valid_until', { ascending: true })
        .limit(1)

      if (data && data.length > 0) setOffer(data[0])
    }
    load()
  }, [])

  if (!offer || dismissed) return null

  const text = lang === 'hi'
    ? (offer.banner_text_hi || offer.banner_text_en)
    : (offer.banner_text_en || offer.banner_text_hi)

  if (!text) return null

  const daysLeft = offer.valid_until
    ? Math.ceil((new Date(offer.valid_until).getTime() - Date.now()) / 86400000)
    : null

  return (
    <div className="bg-amber-500 text-white">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Tag className="w-4 h-4 shrink-0" />
          <p className="text-sm font-medium truncate">{text}</p>
          {daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && (
            <span className="hidden sm:inline text-xs bg-white/25 px-2 py-0.5 rounded-full shrink-0">
              {daysLeft}{lang === 'hi' ? ' दिन बाकी' : daysLeft === 1 ? ' day left' : ' days left'}
            </span>
          )}
        </div>
        <button onClick={() => setDismissed(true)} className="shrink-0 hover:bg-white/20 rounded p-1 transition">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
