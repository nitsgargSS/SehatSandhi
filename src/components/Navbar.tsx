import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { WA_NUMBER } from '../types'

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const isDark = pathname.startsWith('/ng-ctrl-2026')

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 ${isDark ? 'bg-navy-700' : 'bg-white/95 backdrop-blur'} shadow-sm`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link to="/" className="flex items-center">
            <img src="/logo.png" alt="Sehatsandhi" className="h-20 w-auto" />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-2">
            <Link to="/" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>Home</Link>
            <Link to="/how-it-works" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>How it Works</Link>
            <Link to="/doctor" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>For Doctors</Link>
            <Link to="/partners" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>Partners</Link>
            <Link to="/points" className={`text-sm font-medium px-3 py-1.5 rounded-lg transition ${isDark ? 'text-white/80 hover:text-white' : 'text-gray-600 hover:text-teal-600'}`}>🌟 Points</Link>
            <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Main%20doctor%20dhundh%20raha%20hoon.`}
               target="_blank" rel="noreferrer"
               className="btn-teal text-sm py-2 px-5">
              📱 Book on WhatsApp
            </a>
            <Link to="/doctor" className="btn-navy text-sm py-2 px-5">Register Clinic</Link>
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
          <Link to="/" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">Home</Link>
          <Link to="/how-it-works" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">How it Works</Link>
          <Link to="/doctor" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">For Doctors</Link>
          <Link to="/partners" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">Partners</Link>
          <Link to="/points" onClick={() => setOpen(false)} className="text-gray-700 font-medium py-2">🌟 Sehat Points</Link>
          <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Main%20doctor%20dhundh%20raha%20hoon.`}
             target="_blank" rel="noreferrer" onClick={() => setOpen(false)}
             className="btn-teal text-sm justify-center">
            📱 Book on WhatsApp
          </a>
          <Link to="/doctor" onClick={() => setOpen(false)} className="btn-navy text-sm justify-center">Register Clinic</Link>
        </div>
      )}
    </nav>
  )
}
