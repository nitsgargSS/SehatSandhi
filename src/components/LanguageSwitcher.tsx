import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Globe } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import type { Lang } from '../i18n/translations'

const OPTIONS: { code: Lang; label: string }[] = [
  { code: 'hi', label: 'हिंदी' },
  { code: 'en', label: 'English' },
]

export default function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { lang, setLang } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const current = OPTIONS.find(o => o.code === lang) || OPTIONS[0]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition ${
          dark
            ? 'border-white/20 text-white/80 hover:text-white hover:border-white/40'
            : 'border-gray-200 text-gray-600 hover:text-teal-600 hover:border-teal-300'
        }`}
      >
        <Globe className="w-3.5 h-3.5" />
        {current.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-32 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50">
          {OPTIONS.map(o => (
            <button
              key={o.code}
              onClick={() => { setLang(o.code); setOpen(false) }}
              className={`w-full text-left px-4 py-2.5 text-sm transition ${
                lang === o.code ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
