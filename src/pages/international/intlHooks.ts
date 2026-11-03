import { useEffect, useState, useCallback } from 'react'
import { loadCatalogue, type Catalogue } from '../../lib/intlApi'
import { readStore, writeStore, inr, inCurrency } from '../../lib/intlContent'

export function useCatalogue() {
  const [cat, setCat] = useState<Catalogue | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { loadCatalogue().then(setCat, e => setErr(e?.message || 'Could not load. Please refresh.')) }, [])
  return { cat, err }
}

/** The visitor's currency, remembered on this device. */
export function useCurrency() {
  const [cur, setCurState] = useState<string>(() => readStore('intl-cur', 'INR'))
  const setCur = (c: string) => { setCurState(c); writeStore('intl-cur', c) }
  return { cur, setCur }
}

/** "₹1,60,000 – ₹2,20,000" plus "≈ $1,900 – $2,600" when a rate is set. */
export function priceText(min: number, max: number, cur: string, fx: Record<string, number>) {
  const r = min === max ? inr(min) : `${inr(min)} – ${inr(max)}`
  const a = inCurrency(min, cur, fx); const b = inCurrency(max, cur, fx)
  return { inr: r, local: a && b ? (min === max ? `≈ ${a}` : `≈ ${a} – ${b}`) : null }
}

export interface ShortItem { h: string; t: string }
/** Up to three hospitals for one treatment, remembered on this device. */
export function useShortlist() {
  const [list, setList] = useState<ShortItem[]>(() => readStore<ShortItem[]>('intl-shortlist', []))
  useEffect(() => { writeStore('intl-shortlist', list) }, [list])
  const has = useCallback((h: string, t: string) => list.some(i => i.h === h && i.t === t), [list])
  const toggle = (h: string, t: string): string | null => {
    if (has(h, t)) { setList(l => l.filter(i => !(i.h === h && i.t === t))); return null }
    const same = list.filter(i => i.t === t)
    if (same.length >= 3) return 'You can shortlist up to 3 hospitals for one treatment.'
    setList(l => [...l.filter(i => i.t === t), { h, t }])
    return null
  }
  const clear = () => setList([])
  return { list, has, toggle, clear }
}
