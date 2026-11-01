'use client';

import { useState } from 'react';

// A post's square picture with a play button; the reel (9:16) plays in a
// pop-up at its own shape, so it is never cropped into the square card.

export default function ReelPicture({ image, reel, alt, playLabel, closeLabel }: { image: string; reel: string | null; alt: string; playLabel: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  const img = <img src={image} alt={alt} width={1080} height={1080} loading="lazy" style={{ width: '100%', height: 'auto', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block', background: 'var(--surface-2)' }} />;
  if (!reel) return img;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={playLabel} style={{ position: 'relative', display: 'block', width: '100%', padding: 0, border: 0, background: 'none', cursor: 'pointer' }}>
        {img}
        <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(15, 30, 45, 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(0,0,0,0.3)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(10, 18, 28, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', height: 'min(86vh, 760px)', aspectRatio: '9 / 16', maxWidth: '100%' }}>
            <video src={reel} poster={image} controls autoPlay playsInline style={{ width: '100%', height: '100%', borderRadius: 16, background: '#000', objectFit: 'contain' }} />
            <button type="button" onClick={() => setOpen(false)} style={{ position: 'absolute', top: -14, right: -14, width: 40, height: 40, borderRadius: '50%', border: 0, background: '#fff', color: 'var(--ink)', fontSize: 22, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} aria-label={closeLabel}>×</button>
          </div>
        </div>
      )}
    </>
  );
}
