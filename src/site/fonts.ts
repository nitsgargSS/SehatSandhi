// A site's typeface (content.font): a heading face and a body face, each with
// a Devanagari partner so Hindi keeps the same character. Loaded from Google
// Fonts only on a site page, so the rest of Sehatsandhi pays nothing for them.

export interface FontPair {
  key: string; label: string; note: string
  head: string; body: string; headHi: string; bodyHi: string
  headWeight: number; headTrack: string
  css: string   // Google Fonts families= part
}

export const FONT_PAIRS: FontPair[] = [
  { key: 'elegant', label: 'Elegant', note: 'Playfair Display with Lato — classic, like a printed brochure',
    head: "'Playfair Display'", body: "'Lato'", headHi: "'Noto Serif Devanagari'", bodyHi: "'Noto Sans Devanagari'",
    headWeight: 700, headTrack: '-.01em',
    css: 'family=Playfair+Display:wght@500;600;700&family=Lato:wght@400;700&family=Noto+Serif+Devanagari:wght@500;700&family=Noto+Sans+Devanagari:wght@400;600;700' },
  { key: 'graceful', label: 'Graceful', note: 'Cormorant Garamond with Jost — light and refined',
    head: "'Cormorant Garamond'", body: "'Jost'", headHi: "'Noto Serif Devanagari'", bodyHi: "'Noto Sans Devanagari'",
    headWeight: 700, headTrack: '0',
    css: 'family=Cormorant+Garamond:wght@500;600;700&family=Jost:wght@400;500;600;700&family=Noto+Serif+Devanagari:wght@500;700&family=Noto+Sans+Devanagari:wght@400;600;700' },
  { key: 'warm', label: 'Warm', note: 'Fraunces with Inter — soft serif, friendly',
    head: "'Fraunces'", body: "'Inter'", headHi: "'Noto Serif Devanagari'", bodyHi: "'Noto Sans Devanagari'",
    headWeight: 600, headTrack: '-.015em',
    css: 'family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=Noto+Serif+Devanagari:wght@500;700&family=Noto+Sans+Devanagari:wght@400;600;700' },
  { key: 'modern', label: 'Modern', note: 'Manrope throughout — clean and plain',
    head: "'Manrope'", body: "'Manrope'", headHi: "'Noto Sans Devanagari'", bodyHi: "'Noto Sans Devanagari'",
    headWeight: 800, headTrack: '-.02em',
    css: 'family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+Devanagari:wght@400;600;700' },
]

export const fontPair = (key: string | undefined): FontPair => FONT_PAIRS.find(f => f.key === key) ?? FONT_PAIRS[0]

/** Adds the pair's stylesheet to the page once. */
export function loadFontPair(p: FontPair) {
  const id = `site-font-${p.key}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id; link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${p.css}&display=swap`
  document.head.appendChild(link)
}
