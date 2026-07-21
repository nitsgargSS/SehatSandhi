import { Link } from 'react-router-dom'
import { WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'

export default function Footer() {
  const { t } = useLanguage()

  return (
    <footer className="bg-navy-700 text-white pt-12 pb-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          <div>
            <img src="/logo.png" alt="Sehatsandhi" className="h-12 w-auto mb-3 brightness-0 invert" />
            <p className="text-white/70 text-sm leading-relaxed">
              {t('footer.tagline')}
            </p>
            <a href={`https://wa.me/${WA_NUMBER}`} target="_blank" rel="noreferrer"
               className="mt-4 inline-flex items-center gap-2 bg-teal-600 text-white text-sm px-4 py-2 rounded-full hover:bg-teal-500 transition">
              {t('footer.whatsappUs')}
            </a>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-white/90">{t('footer.patientsHeading')}</h4>
            <ul className="space-y-2 text-sm text-white/60">
              <li><Link to="/" className="hover:text-white transition">{t('footer.findDoctor')}</Link></li>
              <li><Link to="/how-it-works" className="hover:text-white transition">{t('footer.howItWorks')}</Link></li>
              <li><Link to="/points" className="hover:text-white transition">{t('footer.sehatPoints')}</Link></li>
              <li><a href={`https://wa.me/${WA_NUMBER}`} target="_blank" rel="noreferrer" className="hover:text-white transition">{t('footer.bookAppointment')}</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-white/90">{t('footer.partnersHeading')}</h4>
            <ul className="space-y-2 text-sm text-white/60">
              <li><Link to="/partners" className="hover:text-white transition">{t('footer.partnerOverview')}</Link></li>
              <li><Link to="/doctor" className="hover:text-white transition">{t('footer.registerAsDoctor')}</Link></li>
              <li><Link to="/partner" className="hover:text-white transition">{t('footer.pharmacyLabAmbulance')}</Link></li>
              <li><Link to="/doctor/login" className="hover:text-white transition">{t('footer.partnerLogin')}</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-white/90">{t('footer.contactHeading')}</h4>
            <ul className="space-y-2 text-sm text-white/60">
              <li>{t('footer.address')}</li>
              <li>📞 <a href={`https://wa.me/${WA_NUMBER}`} className="hover:text-white transition">WhatsApp</a></li>
              <li>✉️ <a href="mailto:hello@sehatsandhi.com" className="hover:text-white transition">hello@sehatsandhi.com</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row justify-between items-center gap-2">
          <p className="text-white/40 text-xs">{t('footer.rights')}</p>
          <div className="flex gap-4 text-white/40 text-xs">
            <Link to="/privacy" className="hover:text-white/70">{t('footer.privacy')}</Link>
            <Link to="/terms" className="hover:text-white/70">{t('footer.terms')}</Link>
          </div>
          <p className="text-white/40 text-xs">{t('footer.company')}</p>
        </div>
      </div>
    </footer>
  )
}
