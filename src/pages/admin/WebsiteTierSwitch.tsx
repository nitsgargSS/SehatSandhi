import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// 0283: a business's website is the free page or the full site. Only an admin
// moves it — a trigger keeps the owner from setting the tier themselves. The
// same goes for the full site's own domain, which the clinic template (sites/)
// serves once the domain is also added to the sehatsandhi-sites Vercel project.

// Keep just the bare host: 'https://www.SharmaClinic.com/about' -> 'sharmaclinic.com'.
// Stored without www: the template drops www before looking the site up, so
// the bare form is the one both addresses resolve to.
const hostOf = (v: string) => v.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '').replace(/^www\./, '')
// Same rule as the column's check (0282).
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/
export default function WebsiteTierSwitch({ businessId, canChange }: { businessId: string; canChange: boolean }) {
  const [site, setSite] = useState<{ slug: string; tier: 'free' | 'full'; custom_domain: string | null } | null | undefined>(undefined)
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('business_sites').select('slug, tier, custom_domain').eq('business_id', businessId).maybeSingle()
      .then(({ data, error }) => {
        if (error) setErr(error.message)
        setSite((data as typeof site) ?? null); setDomain((data as { custom_domain: string | null } | null)?.custom_domain ?? '')
      })
  }, [businessId])
  const flip = async () => {
    if (!site) return
    const tier = site.tier === 'full' ? 'free' : 'full'
    setBusy(true); setErr('')
    const { error } = await supabase.from('business_sites').update({ tier }).eq('business_id', businessId)
    setBusy(false)
    if (error) setErr(error.message); else setSite({ ...site, tier })
  }
  const saveDomain = async () => {
    if (!site) return
    const host = hostOf(domain)
    if (host && !DOMAIN_RE.test(host)) { setErr('Enter a domain like sharmaclinic.com.'); return }
    if (host.endsWith('sehatsandhi.com')) { setErr(`${site.slug}.sehatsandhi.com needs nothing here — just add it in Vercel.`); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('business_sites').update({ custom_domain: host || null }).eq('business_id', businessId)
    setBusy(false)
    if (error) setErr(error.code === '23505' ? 'Another website already has that domain.' : error.message)
    else { setSite({ ...site, custom_domain: host || null }); setDomain(host) }
  }
  if (site === undefined) return null
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <p className="font-bold text-navy-700 text-sm mb-1 flex items-center gap-1"><Globe className="w-4 h-4" /> Website</p>
      <p className="text-xs text-gray-600 mb-2">
        {!site ? 'No website yet — the owner creates it from the Website tab.'
          : site.tier === 'full' ? <>Full site (own name plan) — <a className="underline" href={`/s/${site.slug}`} target="_blank" rel="noreferrer">/s/{site.slug}</a></>
          : <>Free page — <a className="underline" href={`/s/${site.slug}`} target="_blank" rel="noreferrer">/s/{site.slug}</a></>}
      </p>
      {canChange && site && (
        <button disabled={busy} onClick={flip}
          className={`text-xs py-1.5 px-3 rounded-lg border ${site.tier === 'full' ? 'border-red-300 text-red-600' : 'border-teal-500 text-teal-700'} disabled:opacity-50`}>
          {busy ? 'Saving…' : site.tier === 'full' ? 'Back to the free page' : 'Give the full site'}
        </button>
      )}
      {site?.tier === 'full' && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-700 mb-1">Own domain</p>
          {site.custom_domain && <p className="text-xs text-gray-600 mb-1">
            Live address: <a className="underline" href={`https://${site.custom_domain}`} target="_blank" rel="noreferrer">{site.custom_domain}</a>
          </p>}
          {canChange && <>
            <div className="flex gap-2 flex-wrap">
              <input className="input-field text-xs py-1.5 max-w-xs" value={domain} placeholder="sharmaclinic.com"
                onChange={e => setDomain(e.target.value)} />
              <button disabled={busy || hostOf(domain) === (site.custom_domain ?? '')} onClick={saveDomain}
                className="text-xs py-1.5 px-3 rounded-lg border border-teal-500 text-teal-700 disabled:opacity-50">
                {busy ? 'Saving…' : domain.trim() ? 'Save domain' : 'Remove domain'}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Saved without www; both sharmaclinic.com and www.sharmaclinic.com open the site. Then in Vercel →
              sehatsandhi-sites → Domains add both (www as main, the bare domain redirecting to it — the site's links use www), and set the DNS records Vercel
              shows at the clinic's domain registrar. For {site.slug}.sehatsandhi.com, leave this empty and only add it in Vercel.
            </p>
          </>}
        </div>
      )}
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
