import { Link } from 'react-router-dom'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// How to have a Sehatsandhi account and its data deleted — the page the app
// stores ask every app with accounts to publish. It says what the Privacy
// Policy says (sections on your rights and on how long we keep things), as
// steps: who to ask, what is removed, what the law makes us or the clinic keep.
export default function DeleteAccount() {
  const h = 'text-lg font-bold text-navy-700 mt-7 mb-2'
  const p = 'text-gray-700 leading-relaxed mb-3'
  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-5 py-10">
        <h1 className="text-3xl font-bold text-navy-700 mb-2">Delete your Sehatsandhi account and data</h1>
        <p className="text-sm text-gray-500 mb-6">Sehatsandhi – Doctors &amp; Clinics (app and website), by NG Technologies</p>

        <p className={p}>You can ask us to delete your Sehatsandhi account and the personal data in it at any time. It is free, and you do not need to give a reason.</p>

        <h2 className={h}>How to ask</h2>
        <ol className="list-decimal pl-6 text-gray-700 leading-relaxed space-y-1 mb-3">
          <li>Open our <Link to="/contact?topic=privacy" className="text-teal-700 underline">Contact page</Link> and choose <b>“My personal data”</b>, <i>or</i> email <a href="mailto:contact@sehatsandhi.com?subject=Privacy%20request%20-%20delete%20my%20account" className="text-teal-700 underline">contact@sehatsandhi.com</a> with the subject “Privacy request – delete my account”.</li>
          <li>Tell us the <b>mobile number</b> (patients) or <b>email address</b> (clinic staff) you use to sign in.</li>
          <li>We confirm the request with you on that number or address, so nobody else can delete your account.</li>
          <li>We delete the account and tell you when it is done — within <b>30 days</b>, usually much sooner.</li>
        </ol>

        <h2 className={h}>What is deleted</h2>
        <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1 mb-3">
          <li>Your sign-in and your profile: name, mobile number, email, address, PIN code.</li>
          <li>Family members you added, your saved searches and your notification settings.</li>
          <li>Your messages with clinics, and photos you uploaded yourself (for example a prescription photo for a medicine order).</li>
          <li>Your requests for medicines, an ambulance or an insurance advisor, once they are closed.</li>
        </ul>

        <h2 className={h}>What is kept, and why</h2>
        <ul className="list-disc pl-6 text-gray-700 leading-relaxed space-y-1 mb-3">
          <li><b>Your medical record at a clinic</b> — visits, prescriptions, reports and bills a clinic made for you — belongs to that clinic, which the law requires to keep medical records for a period (generally at least 3 years, longer for some records). We pass your request to the clinic; it decides what it may remove.</li>
          <li><b>Bills, payments and tax invoices</b> are kept for as long as tax and accounting law requires (generally 8 years).</li>
          <li><b>Reviews</b> you wrote stay, without your name or number attached.</li>
          <li>A record that you asked for deletion, and when, so we can show it was done.</li>
        </ul>

        <h2 className={h}>Deleting some data without closing the account</h2>
        <p className={p}>You can also ask us to correct or delete particular data — for example a family member, an uploaded photo or your address — and keep your account. Use the same Contact page or email, and say what you want removed.</p>

        <h2 className={h}>Clinics and other businesses</h2>
        <p className={p}>The owner of a clinic, hospital, lab, pharmacy or other business can ask for the business account to be closed in the same way. Patients’ medical records are returned to the business or kept as the law requires before the account is closed.</p>

        <p className="text-sm text-gray-500 mt-8">More detail is in our <Link to="/privacy" className="text-teal-700 underline">Privacy Policy</Link>, including how long each kind of data is kept and how to reach our Grievance Officer.</p>
      </main>
      <SiteFooter />
    </div>
  )
}
