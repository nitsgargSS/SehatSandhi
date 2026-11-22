import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Mail, Search } from 'lucide-react'
import PartnerShell, { useTx } from './PartnerShell'
import { CATEGORY_HI, careFaq, careFaqSynonyms, careSettings, faqHelpful, fillVars, searchFaq, type CareFaq } from '../../lib/careApi'

// /partner/help — the Help Center (brief §14.2), public. Answers come from the
// same care_partner_faq table the chat will use later; {{variables}} are filled
// from the live settings, so changing the fee changes every answer at once.
// Search understands Hindi, English and Roman-script Hindi through keywords and
// synonyms. No phone number anywhere: the fallback is email.

// Partner pages that exist so far; links to later ones (pay, dashboard, tickets, exam) stay hidden until built.
const BUILT = ['/partner', '/partner/how-it-works', '/partner/login', '/partner/register', '/partner/learn', '/partner/help', '/partner/exam', '/partner/certify', '/partner/pay', '/partner/agreement', '/partner/dashboard', '/partner/tickets']

const ORDER = ['Training & Quiz', 'Fee & ID', 'Rewards & Payouts', 'Doctors & Leads', 'Rules', 'Account & Support']

export default function PartnerHelp() {
  return (
    <PartnerShell title="Help Center" titleHi="सहायता केंद्र">
      <Help />
    </PartnerShell>
  )
}

function Help() {
  const { tx } = useTx()
  const [faqs, setFaqs] = useState<CareFaq[] | null>(null)
  const [syn, setSyn] = useState<{ term: string; canonical: string }[]>([])
  const [vars, setVars] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([careFaq(), careFaqSynonyms(), careSettings()])
      .then(([f, s, v]) => { setFaqs(f.filter(x => x.is_active)); setSyn(s); setVars(v) }, () => setFaqs([]))
  }, [])
  const hits = useMemo(() => (faqs && q.trim() ? searchFaq(q, faqs, syn) : null), [q, faqs, syn])
  const email = vars.contact_email || 'contact@sehatsandhi.com'
  const sla = vars.ticket_sla_hours || '48'

  if (!faqs) return <p className="text-gray-400">{tx('Loading…', 'लोड हो रहा है…')}</p>
  const cats = [...ORDER.filter(c => faqs.some(f => f.category === c)), ...[...new Set(faqs.map(f => f.category))].filter(c => !ORDER.includes(c))]

  return (<>
    <label className="relative block">
      <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input className="input-field pl-10 text-base" value={q} onChange={e => setQ(e.target.value)}
        placeholder={tx('Type your question, e.g. "fees kitni hai"', 'अपना सवाल लिखें, जैसे "फ़ीस कितनी है"')} />
    </label>

    {hits ? (
      hits.length ? hits.map(f => <Answer key={f.id} f={f} vars={vars} open onToggle={() => undefined} />)
        : <Fallback email={email} sla={sla} question={q} />
    ) : cats.map(c => (
      <section key={c} className="space-y-2">
        <h2 className="font-bold text-navy-700">{tx(c, CATEGORY_HI[c] ?? c)}</h2>
        {faqs.filter(f => f.category === c).map(f =>
          <Answer key={f.id} f={f} vars={vars} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} />)}
      </section>
    ))}

    {!hits && <Fallback email={email} sla={sla} />}
  </>)
}

function Answer({ f, vars, open, onToggle }: { f: CareFaq; vars: Record<string, string>; open: boolean; onToggle: () => void }) {
  const { tx } = useTx()
  const [voted, setVoted] = useState(false)
  const site = vars.site ?? ''
  const link = f.link_path ? fillVars(f.link_path, vars).replace(site, '') : null
  // Links inside the answer text are written as {{site}}/partner/...; show them as plain paths.
  // Inline links ({{site}}/partner/...) are dropped from the text: the button below is the link.
  const text = fillVars(tx(f.answer_en, f.answer_hi), vars).replace(new RegExp(`\\s*(?:Details:|Check status:|Add details here:|Register here:)?\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\S*`, 'g'), '').trim()
  return (
    <div className="card">
      <button onClick={onToggle} className="w-full text-left flex items-start justify-between gap-2">
        <span className="font-semibold text-gray-800">{tx(f.question_en, f.question_hi)}</span>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />}
      </button>
      {open && (
        <div className="mt-2 text-[15px] text-gray-700 space-y-3">
          <p className="whitespace-pre-line">{text}</p>
          {link && BUILT.includes(link.split(/[?#]/)[0]) && <Link to={link} className="inline-block text-teal-700 font-semibold underline">{tx('Go there', 'वहाँ जाएँ')} ›</Link>}
          <div className="flex items-center gap-3 text-sm text-gray-500">
            {voted ? <span>{tx('Thank you.', 'धन्यवाद।')}</span> : (<>
              <span>{tx('Did this help?', 'क्या इससे मदद मिली?')}</span>
              <button className="px-3 py-1.5 rounded-full border border-gray-200 min-h-[36px]" onClick={() => { faqHelpful(f.id, true); setVoted(true) }}>{tx('Yes', 'हाँ')}</button>
              <button className="px-3 py-1.5 rounded-full border border-gray-200 min-h-[36px]" onClick={() => { faqHelpful(f.id, false); setVoted(true) }}>{tx('No', 'नहीं')}</button>
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}

function Fallback({ email, sla, question }: { email: string; sla: string; question?: string }) {
  const { tx } = useTx()
  const href = `mailto:${email}?subject=${encodeURIComponent('Partner question')}${question ? `&body=${encodeURIComponent(question)}` : ''}`
  return (
    <div className="card text-[15px] text-gray-700">
      <p>{question
        ? tx(`I couldn't find an answer to that. Please email your question to ${email} and we will reply within ${sla} hours.`,
             `इस सवाल का जवाब मुझे नहीं मिला। कृपया अपना सवाल ${email} पर ईमेल करें, हम ${sla} घंटे में जवाब देंगे।`)
        : tx(`Still stuck? Email ${email} and we will reply within ${sla} hours.`, `अब भी परेशानी है? ${email} पर ईमेल करें, हम ${sla} घंटे में जवाब देंगे।`)}</p>
      <a href={href} className="mt-3 inline-flex items-center gap-2 btn-teal py-2.5 px-4"><Mail className="w-4 h-4" /> {tx('Email us', 'हमें ईमेल करें')}</a>
    </div>
  )
}
