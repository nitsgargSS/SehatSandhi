'use client';

import { useState } from 'react';
import type { IntlMedia } from '@/lib/sehat';

// 0319: the hospital's photos and videos that Sehatsandhi approved for its
// International listing — the same items, shown on its own website too.
// The page passes them in (fetched on the server, refreshed hourly); this
// only draws the grid and the full-screen viewer.

const CAT: Record<string, { en: string; hi: string }> = {
  building: { en: 'Building', hi: 'भवन' }, rooms: { en: 'Rooms', hi: 'कमरे' }, icu: { en: 'ICU', hi: 'ICU' },
  ot: { en: 'Operation theatre', hi: 'ऑपरेशन थिएटर' }, equipment: { en: 'Equipment', hi: 'उपकरण' }, food: { en: 'Food', hi: 'भोजन' },
  lounge: { en: 'Family lounge', hi: 'परिवार लाउंज' }, tour: { en: 'Video tour', hi: 'वीडियो टूर' }, other: { en: 'Hospital', hi: 'हॉस्पिटल' },
};

export default function Gallery({ data, base, lang }: { data: IntlMedia; base: string; lang: 'en' | 'hi' }) {
  const [open, setOpen] = useState<number | null>(null);
  const list = data.media;
  if (!list.length) return null;
  const hi = lang === 'hi';
  const url = (p: string) => `${base}/storage/v1/object/public/intl-media/${p}`;
  const thumb = (m: IntlMedia['media'][number]) => (m.kind === 'youtube' ? `https://img.youtube.com/vi/${m.youtube_id}/hqdefault.jpg` : m.path ? url(m.path) : '');
  const label = (m: IntlMedia['media'][number]) => m.caption || (hi ? CAT[m.category]?.hi : CAT[m.category]?.en) || '';
  const cur = open !== null ? list[open] : null;
  const go = (k: number) => setOpen((i) => (i === null ? null : (i + k + list.length) % list.length));
  return (
    <section className="sec" style={{ background: 'var(--surface)' }}>
      <div className="wrap stack" style={{ gap: 22 }}>
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">{hi ? 'हॉस्पिटल के अंदर' : 'Inside the hospital'}</span>
          <h2 className="h2">{hi ? 'फ़ोटो और वीडियो' : 'Photos and videos'}</h2>
        </div>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {list.map((m, i) => (
            <button key={i} type="button" onClick={() => setOpen(i)} aria-label={label(m)}
              style={{ position: 'relative', aspectRatio: '4 / 3', border: 0, padding: 0, borderRadius: 18, overflow: 'hidden', cursor: 'pointer', background: 'var(--surface-2)' }}>
              {m.kind === 'video' && m.path
                ? <video src={url(m.path)} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={thumb(m)} alt={label(m)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              {m.kind !== 'photo' && (
                <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(15,30,45,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </span>
              )}
              <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '22px 12px 10px', textAlign: 'left', color: '#fff', fontSize: 14, background: 'linear-gradient(transparent, rgba(0,0,0,.62))' }}>{label(m)}</span>
            </button>
          ))}
        </div>
        <a href={`https://www.sehatsandhi.com/international/hospitals/${data.hospital_id}`} rel="noopener" style={{ color: 'var(--brand-strong)', fontWeight: 700 }}>
          {hi ? 'विदेश से आ रहे हैं? Sehatsandhi International पर हमें देखें →' : 'Coming from abroad? See us on Sehatsandhi International →'}
        </a>
      </div>
      {cur && (
        <div role="dialog" aria-modal="true" aria-label={label(cur)} onClick={() => setOpen(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(10,18,28,.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1000, width: '100%', textAlign: 'center' }}>
            {cur.kind === 'photo' && cur.path && <img src={url(cur.path)} alt={label(cur)} style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 14 }} />}
            {cur.kind === 'video' && cur.path && <video src={url(cur.path)} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 14, background: '#000' }} />}
            {cur.kind === 'youtube' && <iframe title={label(cur)} src={`https://www.youtube-nocookie.com/embed/${cur.youtube_id}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen style={{ width: '100%', aspectRatio: '16 / 9', border: 0, borderRadius: 14 }} />}
            <p style={{ color: '#fff', marginTop: 10 }}>{label(cur)}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 6 }}>
              {list.length > 1 && <button type="button" className="btn btn-ghost" style={{ background: '#fff' }} onClick={() => go(-1)}>‹ {hi ? 'पिछला' : 'Previous'}</button>}
              <button type="button" className="btn btn-ghost" style={{ background: '#fff' }} onClick={() => setOpen(null)}>{hi ? 'बंद करें' : 'Close'}</button>
              {list.length > 1 && <button type="button" className="btn btn-ghost" style={{ background: '#fff' }} onClick={() => go(1)}>{hi ? 'अगला' : 'Next'} ›</button>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
