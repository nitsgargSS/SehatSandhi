import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X, LogIn } from 'lucide-react'
import { WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'
import LanguageSwitcher from './LanguageSwitcher'

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { t } = useLanguage()
  const isDark = pathname.startsWith('/ng-ctrl-2026')

  return (
    // sticky, not fixed: a fixed bar is taken out of flow and pinned to the
    // viewport, so it rendered *underneath* the sandbox banner above it and
    // lost its top 40px. Sticky keeps the same pinned-while-scrolling
    // behaviour but respects whatever precedes it in the document.
    <nav className={`sticky top-0 z-50 ${isDark ? 'bg-navy-700' : 'bg-white/95 backdrop-blur'} shadow-sm`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link to="/" className="flex items-center">
            <img src="/logo.png" alt="Sehatsandhi" className="h-20 w-auto" />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-2">
            <Link to="/" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>{t('nav.home')}</Link>
            <Link to="/how-it-works" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>{t('nav.howItWorks')}</Link>
            <Link to="/for-doctors" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>{t('nav.forDoctors')}</Link>
            <Link to="/business" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>For Business</Link>
            {/* Clear, dedicated login link — the ONLY way for a doctor
                or receptionist to find their dashboard was previously
                buried at the bottom of the footer */}
            <Link to="/doctor/login" className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-teal-200 text-teal-700 hover:bg-teal-50 transition">
              <LogIn className="w-3.5 h-3.5" /> {t('nav.login')}
            </Link>
            <LanguageSwitcher dark={isDark} />
            <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Main%20doctor%20dhundh%20raha%20hoon.`}
               target="_blank" rel="noreferrer"
               className="btn-teal text-sm py-2 px-5">
              {t('nav.bookWhatsapp')}
            </a>
            <Link to="/business/register" className="btn-navy text-sm py-2 px-5">{t('nav.registerClinic')}</Link>
          </div>

          {/* Mobile hamburger */}
          <button className="md:hidden p-2" onClick={() => setOpen(!open)}>
            {open ? <X className="text-gray-700" /> : <Menu className="text-gray-700" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 px-4 py-4 flex flex-col gap-3">
          <div className="flex justify-end mb-1">
            <LanguageSwitcher />
          </div>
          <Link to="/" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">{t('nav.home')}</Link>
          <Link to="/how-it-works" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">{t('nav.howItWorks')}</Link>
          <Link to="/for-doctors" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">{t('nav.forDoctors')}</Link>
          <Link to="/business" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">For Business</Link>
          <Link to="/doctor/login" onClick={() => setOpen(false)}
            className="flex items-center gap-2 text-teal-700 font-medium py-2 border-t border-gray-100 pt-3">
            <LogIn className="w-4 h-4" /> {t('nav.login')}
          </Link>
          <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Main%20doctor%20dhundh%20raha%20hoon.`}
             target="_blank" rel="noreferrer" onClick={() => setOpen(false)}
             className="btn-teal text-sm justify-center">
            {t('nav.bookWhatsapp')}
          </a>
          <Link to="/business/register" onClick={() => setOpen(false)} className="btn-navy text-sm justify-center">{t('nav.registerClinic')}</Link>
        </div>
      )}
    </nav>
  )
}
