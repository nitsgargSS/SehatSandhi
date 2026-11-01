'use client';

import { useEffect, useState } from 'react';

// Text size for visitors who see poorly: A / A+ / A++ in the top bar. The
// whole page is scaled (CSS zoom), so layouts keep their proportions. The
// choice stays in this browser; TEXT_SIZE_BOOT applies it before first paint.

const SIZES = [1, 1.15, 1.3];
const KEY = 'sn-text-size';

/** Runs in <head> before the page paints, so the text does not jump. */
export const TEXT_SIZE_BOOT = `try{var z=parseFloat(localStorage.getItem('${KEY}'));if(z>1)document.documentElement.style.zoom=z}catch(e){}`;

export default function TextSize({ lang }: { lang: 'en' | 'hi' }) {
  const [z, setZ] = useState(1);
  useEffect(() => {
    try { const v = parseFloat(localStorage.getItem(KEY) || '1'); if (SIZES.includes(v)) setZ(v); } catch { /* storage blocked */ }
  }, []);
  const pick = (v: number) => {
    setZ(v);
    document.documentElement.style.setProperty('zoom', v > 1 ? String(v) : '');
    try { localStorage.setItem(KEY, String(v)); } catch { /* storage blocked */ }
  };
  return (
    <div className="textsize" role="group" aria-label={lang === 'hi' ? 'अक्षरों का आकार' : 'Text size'}>
      {SIZES.map((v, i) => (
        <button key={v} type="button" onClick={() => pick(v)} aria-pressed={z === v} style={{ fontSize: 13 + i * 3 }}>
          A{'+'.repeat(i)}
        </button>
      ))}
    </div>
  );
}
