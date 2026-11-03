import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Lang } from './siteData'

// 0319: a hospital listed on Sehatsandhi International shows its approved
// photos and videos on its own website too — the same items Sehatsandhi
// checked, so there is nothing to upload twice. Nothing shows before the
// listing or while it is paused.

interface Item { kind: 'photo' | 'video' | 'youtube'; path: string | null; youtube_id: string | null; category: string; caption: string | null }
const url = (p: string) => supabase.storage.from('intl-media').getPublicUrl(p).data.publicUrl
const CAT: Record<string, { en: string; hi: string }> = {
  building: { en: 'Building', hi: 'भवन' }, rooms: { en: 'Rooms', hi: 'कमरे' }, icu: { en: 'ICU', hi: 'ICU' },
  ot: { en: 'Operation theatre', hi: 'ऑपरेशन थिएटर' }, equipment: { en: 'Equipment', hi: 'उपकरण' }, food: { en: 'Food', hi: 'भोजन' },
  lounge: { en: 'Family lounge', hi: 'परिवार लाउंज' }, tour: { en: 'Video tour', hi: 'वीडियो टूर' }, other: { en: 'Hospital', hi: 'हॉस्पिटल' },
}

export default function SiteGallery({ siteKey, lang }: { siteKey: string; lang: Lang }) {
  const [d, setD] = useState<{ hospital_id: string; media: Item[] } | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    Promise.resolve(supabase.rpc('sehat_intl_site_media', { p_key: siteKey })).then(({ data }) => setD((data as typeof d) ?? null), () => setD(null))
  }, [siteKey])
  if (!d || !d.media.length) return null
  const list = d.media
  const cur = open !== null ? list[open] : null
  const go = (k: number) => setOpen(i => i === null ? null : (i + k + list.length) % list.length)
  const thumb = (m: Item) => m.kind === 'youtube' ? `https://img.youtube.com/vi/${m.youtube_id}/hqdefault.jpg` : m.path ? url(m.path) : ''
  const hi = lang === 'hi'
  return (
    <section style={{ padding: 'clamp(44px,8vw,84px) 0', background: '#fff', borderTop: '1px solid var(--site-line)' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 clamp(16px,4vw,40px)' }}>
        <div style={{ color: 'var(--site-brand)', fontWeight: 700, fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase' }}>{hi ? 'हॉस्पिटल के अंदर' : 'Inside the hospital'}</div>
        <h2 style={{ fontFamily: 'var(--site-head)', fontSize: 'clamp(24px,3vw,32px)', fontWeight: 800, margin: '6px 0 18px' }}>{hi ? 'फ़ोटो और वीडियो' : 'Photos and videos'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
          {list.map((m, i) => (
            <button key={i} onClick={() => setOpen(i)} style={{ position: 'relative', aspectRatio: '4/3', border: 0, padding: 0, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', background: '#eee' }}>
              {m.kind === 'video' && m.path
                ? <video src={url(m.path)} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={thumb(m)} alt={m.caption ?? CAT[m.category]?.en ?? ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              {m.kind !== 'photo' && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: 54, height: 54, borderRadius: 99, background: 'rgba(0,0,0,.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>▶</span></span>}
              <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px 10px 8px', textAlign: 'left', color: '#fff', fontSize: 14, background: 'linear-gradient(transparent,rgba(0,0,0,.6))' }}>{m.caption || (hi ? CAT[m.category]?.hi : CAT[m.category]?.en)}</span>
            </button>
          ))}
        </div>
        <a href={`/international/hospitals/${d.hospital_id}`} style={{ display: 'inline-block', marginTop: 18, color: 'var(--site-brand)', fontWeight: 700, textDecoration: 'none' }}>
          {hi ? 'विदेश से आ रहे हैं? Sehatsandhi International पर हमें देखें →' : 'Coming from abroad? See us on Sehatsandhi International →'}
        </a>
      </div>
      {cur && (
        <div role="dialog" aria-modal="true" onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 1000, width: '100%', textAlign: 'center' }}>
            {cur.kind === 'photo' && cur.path && <img src={url(cur.path)} alt={cur.caption ?? ''} style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 10 }} />}
            {cur.kind === 'video' && cur.path && <video src={url(cur.path)} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 10 }} />}
            {cur.kind === 'youtube' && <iframe title={cur.caption ?? 'Video'} src={`https://www.youtube-nocookie.com/embed/${cur.youtube_id}?autoplay=1&rel=0`} allow="autoplay; encrypted-media" allowFullScreen style={{ width: '100%', aspectRatio: '16/9', border: 0, borderRadius: 10 }} />}
            <p style={{ color: '#fff', marginTop: 10 }}>{cur.caption}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 8 }}>
              {list.length > 1 && <button onClick={() => go(-1)} style={{ padding: '8px 16px', borderRadius: 99, border: 0 }}>‹ {hi ? 'पिछला' : 'Previous'}</button>}
              <button onClick={() => setOpen(null)} style={{ padding: '8px 16px', borderRadius: 99, border: 0 }}>{hi ? 'बंद करें' : 'Close'}</button>
              {list.length > 1 && <button onClick={() => go(1)} style={{ padding: '8px 16px', borderRadius: 99, border: 0 }}>{hi ? 'अगला' : 'Next'} ›</button>}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
