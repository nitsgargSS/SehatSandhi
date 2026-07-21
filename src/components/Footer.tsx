import { Link } from 'react-router-dom'
import { WA_NUMBER } from '../types'

export default function Footer() {
  return (
    <footer className="bg-navy-700 text-white pt-12 pb-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          <div>
            <img src="/logo.png" alt="Sehatsandhi" className="h-12 w-auto mb-3 brightness-0 invert" />
            <p className="text-white/70 text-sm leading-relaxed">
              स्वास्थ्य की नई साझेदारी<br />
              <span className="text-white/50 text-xs">Health's New Partnership</span>
            </p>
            <a href={`https://wa.me/${WA_NUMBER}`} target="_blank" rel="noreferrer"
               className="mt-4 inline-flex items-center gap-2 bg-teal-600 text-white text-sm px-4 py-2 rounded-full hover:bg-teal-500 transition">
              📱 WhatsApp us
            </a>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-white/90">Patients</h4>
            <ul className="space-y-2 text-sm text-white/60">
              <li><Link to="/" className="hover:text-white transition">Find a Doctor</Link></li>
              <li><Link to="/how-it-works" className="hover:text-white transition">How it Works</Link></li>
              <li><Link to="/points" className="hover:text-white transition">🌟 Sehat Points</Link></li>
              <li><a href={`https://wa.me/${WA_NUMBER}`} target="_blank" rel="noreferrer" className="hover:text-white transition">Book Appointment</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-white/90">Partners</h4>
            <ul className="space-y-2 text-sm text-white/60">
              <li><Link to="/partners" className="hover:text-white transition">Partner Overview</Link></li>
              <li><Link to="/doctor" className="hover:text-white transition">Register as Doctor</Link></li>
              <li><Link to="/partner" className="hover:text-white transition">Pharmacy / Lab / Ambulance</Link></li>
              <li><Link to="/doctor/login" className="hover:text-white transition">Partner Login</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-white/90">Contact</h4>
            <ul className="space-y-2 text-sm text-white/60">
              <li>📍 Yamuna Nagar, Haryana</li>
              <li>📞 <a href={`https://wa.me/${WA_NUMBER}`} className="hover:text-white transition">WhatsApp</a></li>
              <li>✉️ <a href="mailto:hello@sehatsandhi.com" className="hover:text-white transition">hello@sehatsandhi.com</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row justify-between items-center gap-2">
          <p className="text-white/40 text-xs">© 2026 Sehatsandhi. All rights reserved.</p>
          <div className="flex gap-4 text-white/40 text-xs">
            <Link to="/privacy" className="hover:text-white/70">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-white/70">Terms</Link>
          </div>
          <p className="text-white/40 text-xs">NG Technologies, Yamuna Nagar</p>
        </div>
      </div>
    </footer>
  )
}
