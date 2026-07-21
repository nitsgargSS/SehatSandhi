import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { translations, getTranslation, Lang } from './translations'

interface LanguageContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (path: string) => string
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

const STORAGE_KEY = 'sehatsandhi_lang'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'hi'
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved === 'en' || saved === 'hi' ? saved : 'hi'
  })

  const setLang = (l: Lang) => {
    setLangState(l)
    window.localStorage.setItem(STORAGE_KEY, l)
  }

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const t = (path: string) => getTranslation(path, lang)

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}

// Re-export for convenience in pages that need the raw dictionary
export { translations }
