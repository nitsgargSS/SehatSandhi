import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { StatTile } from '../../components/Charts'
import { supabase } from '../../lib/supabase'

// Visits and taps on the clinic's own website (0303) — e.g. sneyeshospital.com,
// which reports page views and Call / WhatsApp / Book taps to Sehatsandhi.
// Shown under the listing report only when the clinic has a live site.

interface Report {
  has_site: boolean
  totals: Record<string, number>
  visitors: number
  pages: { path: string; views: number }[]
  sources: { host: string; visits: number }[]
}

const PAGE_NAMES: Record<string, string> = {
  '/': 'Home', '/hi/': 'Home (Hindi)', '/glaucoma/': 'Glaucoma', '/retina/': 'Retina', '/cornea/': 'Cornea',
  '/about/': 'Doctor', '/services/': 'Services', '/posts/': 'Articles', '/contact/': 'Visit us', '/book/': 'Book',
  '/social/': 'Social', '/vision-check/': 'Vision check',
}
const pageName = (p: string) => PAGE_NAMES[p] ?? PAGE_NAMES[p.replace(/^\/hi/, '')] ?? p

export default function WebsiteVisitsCard({ businessId, days }: { businessId: string; days: number }) {
  const [r, setR] = useState<Report | null>(null)
  useEffect(() => {
    supabase.rpc('sehat_site_visit_report', { p_business: businessId, p_days: days })
      .then(({ data, error }) => setR(error ? null : (data as Report)))
  }, [businessId, days])
  if (!r?.has_site) return null
  const n = (k: string) => r.totals[k] ?? 0
  return (
    <div className="card shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="w-5 h-5 text-teal-600" />
        <div>
          <h3 className="font-bold text-navy-700">Your website</h3>
          <p className="text-xs text-gray-500">Visits and taps on your own site, last {days} days. No cookies; visitors are counted per browser tab.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Visitors" value={r.visitors} sub={`${n('page_view')} pages seen`} />
        <StatTile label="Tapped Call" value={n('call_click')} />
        <StatTile label="Tapped WhatsApp" value={n('whatsapp_click')} />
        <StatTile label="Sent a booking request" value={n('book_sent')} sub={`${n('book_start')} opened booking`} />
      </div>
      {(r.pages.length > 0 || r.sources.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-1">Most-read pages</div>
            {r.pages.map((p) => <div key={p.path} className="flex justify-between py-1 border-b border-gray-100"><span>{pageName(p.path)}</span><span className="text-gray-500">{p.views}</span></div>)}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-1">Where visitors came from</div>
            {r.sources.map((s) => <div key={s.host} className="flex justify-between py-1 border-b border-gray-100"><span>{s.host === 'direct' ? 'Typed the address / app' : s.host}</span><span className="text-gray-500">{s.visits}</span></div>)}
          </div>
        </div>
      )}
      {n('vision_check') > 0 && <p className="text-xs text-gray-500">{n('vision_check')} people finished the quick vision check.</p>}
    </div>
  )
}
