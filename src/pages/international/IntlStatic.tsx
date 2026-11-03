import { Link } from 'react-router-dom'
import {
  Search, FileText, Scale, Plane, HeartPulse, ShieldCheck, Building2, Video, FileSignature, RefreshCw,
  Eye, Smile, Bone, Baby, Heart, Stethoscope, CheckCircle2, MessageCircle, Clock, Users,
} from 'lucide-react'
import IntlLayout, { C, Wrap, PageHead, CtaButton, Card, useTitle } from './IntlLayout'
import {
  LEVELS, GROUPS, FAQ, TRAVEL, PATIENT_CHECKLISTS, CHECKLIST, ESTIMATE_CLAUSES, intlWaLink, INTL_EMAIL,
  type CityLevel, type Grp,
} from '../../lib/intlContent'

const QUICK = [
  { code: 'cataract', label: 'Eye surgery', icon: Eye },
  { code: 'dental_implant', label: 'Dental', icon: Smile },
  { code: 'knee_replacement', label: 'Knee & hip', icon: Bone },
  { code: 'ivf', label: 'IVF', icon: Baby },
  { code: 'angioplasty', label: 'Heart', icon: Heart },
  { code: 'health_checkup', label: 'Health check-up', icon: Stethoscope },
]

const HOW = [
  { icon: Search, t: 'Compare', d: 'Pick your treatment. See checked hospitals across India with estimates, stay length and facilities.' },
  { icon: FileText, t: 'Send reports', d: 'Shortlist up to three hospitals and send your reports. A phone photo of each page is enough.' },
  { icon: Scale, t: 'Choose', d: 'Get written quotes and the doctors’ opinions within 48 hours. You decide.' },
  { icon: Plane, t: 'Travel', d: 'Your hospital sends the visa letter. We arrange airport pickup, stay and local travel.' },
  { icon: HeartPulse, t: 'Recover', d: 'Treatment, discharge papers in English, and online follow-ups once you are home.' },
]

export function IntlHome() {
  useTitle('Treatment in India, looked after')
  return (
    <IntlLayout>
      <section style={{ background: `linear-gradient(180deg, ${C.sand} 0%, ${C.cream} 100%)` }}>
        <Wrap className="py-12 sm:py-20 grid gap-10 lg:grid-cols-[1.2fr_1fr] items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium mb-5" style={{ color: C.green, border: `1px solid ${C.border}` }}>
              <ShieldCheck className="w-4 h-4" /> Checked hospitals in every city in India
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold leading-[1.1]">Treatment in India, with someone looking after you all the way.</h1>
            <p className="mt-5 text-lg leading-relaxed max-w-xl" style={{ color: C.muted }}>
              Compare hospitals and costs across big metros, regional cities and smaller towns. We suggest what usually suits your treatment — you make the choice. Then we arrange your visa letter, pickup and stay.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <CtaButton to="/international/compare">Compare hospitals</CtaButton>
              <CtaButton to="/international/quote" light>Get a free quote</CtaButton>
            </div>
            <p className="mt-4 text-sm flex items-center gap-2" style={{ color: C.muted }}><Clock className="w-4 h-4" /> A real person replies on WhatsApp within 24 hours.</p>
          </div>
          <Card className="shadow-sm">
            <p className="font-semibold mb-4">What do you need help with?</p>
            <div className="grid grid-cols-2 gap-3">
              {QUICK.map(q => (
                <Link key={q.code} to={`/international/compare?t=${q.code}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 hover:shadow-sm transition"
                  style={{ background: C.soft }}>
                  <q.icon className="w-5 h-5 shrink-0" style={{ color: C.green }} />
                  <span className="font-medium">{q.label}</span>
                </Link>
              ))}
            </div>
            <Link to="/international/treatments" className="block mt-4 text-center font-semibold" style={{ color: C.green }}>See all treatments →</Link>
          </Card>
        </Wrap>
      </section>

      <Wrap className="py-14">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">How it works</h2>
        <p className="mb-8" style={{ color: C.muted }}>Five steps from your first message to your follow-ups at home.</p>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {HOW.map((s, i) => (
            <li key={s.t}>
              <Card className="h-full">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: C.green }}>{i + 1}</span>
                  <s.icon className="w-5 h-5" style={{ color: C.green }} />
                </div>
                <p className="font-semibold mb-1">{s.t}</p>
                <p className="text-[15px] leading-relaxed" style={{ color: C.muted }}>{s.d}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Wrap>

      <RightCity />

      <Wrap className="py-14 grid gap-6 lg:grid-cols-3">
        {[
          { icon: ShieldCheck, t: 'Hospitals we have checked', d: 'Every licence valid, NABH accreditation, an ICU and an international desk. We check documents, walk through on video and sign an agreement before a listing opens.' },
          { icon: Users, t: 'You choose, always', d: 'We show every checked hospital that offers your treatment. No hospital can pay to appear higher, and we never call any doctor “the best”.' },
          { icon: MessageCircle, t: 'One person for your whole trip', d: 'Your coordinator answers on WhatsApp, meets you on arrival and stays in touch until your follow-ups at home.' },
        ].map(b => (
          <Card key={b.t}>
            <b.icon className="w-7 h-7 mb-3" style={{ color: C.green }} />
            <p className="font-semibold text-lg mb-2">{b.t}</p>
            <p className="leading-relaxed" style={{ color: C.muted }}>{b.d}</p>
          </Card>
        ))}
      </Wrap>

      <Wrap narrow className="pb-6">
        <h2 className="text-2xl font-bold mb-4">Common questions</h2>
        <FaqList items={FAQ.slice(0, 5)} />
        <Link to="/international/faq" className="inline-block mt-4 font-semibold" style={{ color: C.green }}>All questions →</Link>
      </Wrap>

      <BottomCta />
    </IntlLayout>
  )
}

function RightCity() {
  return (
    <section style={{ background: '#fff', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
      <Wrap className="py-14">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">Right care, right city</h2>
        <p className="mb-8 max-w-2xl" style={{ color: C.muted }}>
          India has excellent hospitals in cities of every size. For a routine procedure, a smaller city often gives the same care at a lower total cost. For complex treatment, larger centres have the most experience. Here is how we suggest — you decide.
        </p>
        <div className="grid gap-4 md:grid-cols-3 mb-10">
          {(Object.keys(LEVELS) as CityLevel[]).map(k => (
            <div key={k} className="rounded-2xl p-5" style={{ background: C.cream, border: `1px solid ${C.border}` }}>
              <Building2 className="w-6 h-6 mb-2" style={{ color: C.green }} />
              <p className="font-semibold text-lg">{LEVELS[k].name}</p>
              <p className="text-sm mb-2" style={{ color: C.muted }}>{LEVELS[k].examples}</p>
              <p className="leading-relaxed">{LEVELS[k].why}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-2xl" style={{ border: `1px solid ${C.border}` }}>
          <table className="w-full text-left text-[15px] min-w-[640px]">
            <thead style={{ background: C.soft }}>
              <tr><th className="p-3">Type of treatment</th><th className="p-3">For example</th><th className="p-3">Usually suits</th></tr>
            </thead>
            <tbody>
              {(Object.keys(GROUPS) as Grp[]).map(g => (
                <tr key={g} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td className="p-3 font-semibold align-top">{GROUPS[g].name}</td>
                  <td className="p-3 align-top" style={{ color: C.muted }}>{GROUPS[g].examples}</td>
                  <td className="p-3 align-top">{GROUPS[g].levels.map(l => LEVELS[l].name).join(' or ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm mt-3" style={{ color: C.muted }}>A general guide, not medical advice. Your doctor’s opinion on your reports comes first.</p>
      </Wrap>
    </section>
  )
}

function FaqList({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map(f => (
        <details key={f.q} className="rounded-2xl bg-white px-5 py-4 group" style={{ border: `1px solid ${C.border}` }}>
          <summary className="font-semibold cursor-pointer list-none flex justify-between gap-4">
            {f.q}<span className="transition-transform group-open:rotate-45 text-xl leading-none" style={{ color: C.green }}>+</span>
          </summary>
          <p className="mt-3 leading-relaxed" style={{ color: C.muted }}>{f.a}</p>
        </details>
      ))}
    </div>
  )
}

export function BottomCta() {
  return (
    <Wrap className="py-12">
      <div className="rounded-3xl p-8 sm:p-10 text-center" style={{ background: C.green, color: '#fff' }}>
        <h2 className="text-2xl sm:text-3xl font-bold">Not sure where to start?</h2>
        <p className="mt-2 text-lg opacity-90">Tell us what is troubling you. Your coordinator will reply within 24 hours.</p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/international/quote" className="rounded-full bg-white px-6 py-3 font-semibold" style={{ color: C.green }}>Get a free quote</Link>
          <a href={intlWaLink()} target="_blank" rel="noreferrer" className="rounded-full px-6 py-3 font-semibold" style={{ border: '1.5px solid #fff' }}>Message us on WhatsApp</a>
        </div>
      </div>
    </Wrap>
  )
}

export function IntlFaq() {
  useTitle('Questions')
  return (
    <IntlLayout>
      <PageHead kicker="FAQ" title="Your questions, answered" lead="If your question is not here, message us on WhatsApp. A real person replies." />
      <Wrap narrow className="py-10"><FaqList items={FAQ} /></Wrap>
      <BottomCta />
    </IntlLayout>
  )
}

export function IntlPlanTrip() {
  useTitle('Plan your trip')
  return (
    <IntlLayout>
      <PageHead kicker="Plan your trip" title="Coming to India for treatment" lead="Visa, flights, getting to the hospital, where to stay and what to bring. Your coordinator helps with every step." />
      <Wrap narrow className="py-10 flex flex-col gap-10">
        <section>
          <h2 className="text-2xl font-bold mb-3">Your e-Medical visa</h2>
          <ol className="flex flex-col gap-3 list-decimal pl-5 leading-relaxed">
            <li>Accept the written quote from the hospital you chose.</li>
            <li>The hospital issues your invitation letter through the government’s Medical and Ayush Visa Portal, usually within 2–3 working days.</li>
            <li>Apply online for an e-Medical visa on the official Indian visa website. Up to two family members can apply for e-Medical Attendant visas.</li>
            <li>Send us your visa and flight details so we can arrange your airport pickup.</li>
          </ol>
          <p className="mt-3 text-sm" style={{ color: C.muted }}>Visa rules can change. Always check the official Indian visa website for your country before you apply.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold mb-3">By country</h2>
          <div className="flex flex-col gap-3">
            {TRAVEL.countries.map(c => (
              <Card key={c.name}><p className="font-semibold">{c.name}</p><p className="mt-1" style={{ color: C.muted }}>{c.note}</p></Card>
            ))}
          </div>
        </section>
        <section>
          <h2 className="text-2xl font-bold mb-3">Airports</h2>
          <p className="mb-3" style={{ color: C.muted }}>Each hospital page shows its nearest airport and the road time. We meet you at arrivals.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TRAVEL.airports.map(a => (
              <Card key={a.code}>
                <p className="font-semibold flex items-center gap-2"><Plane className="w-4 h-4" style={{ color: C.green }} /> {a.code} · {a.name}</p>
                <p className="mt-1 text-[15px]" style={{ color: C.muted }}>{a.note}</p>
              </Card>
            ))}
          </div>
        </section>
        <section>
          <h2 className="text-2xl font-bold mb-3">Good to know</h2>
          <ul className="flex flex-col gap-2">
            {TRAVEL.tips.map(t => <li key={t} className="flex gap-3"><CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: C.green }} />{t}</li>)}
          </ul>
        </section>
        <p><Link to="/international/checklists" className="font-semibold" style={{ color: C.green }}>Printable checklists for each stage →</Link></p>
      </Wrap>
      <BottomCta />
    </IntlLayout>
  )
}

export function IntlChecklists() {
  useTitle('Patient checklists')
  return (
    <IntlLayout>
      <PageHead kicker="Checklists" title="What to do at each stage" lead="Print this page or keep it on your phone. Your coordinator also sends each list on WhatsApp at the right time." />
      <Wrap narrow className="py-10 grid gap-5">
        {PATIENT_CHECKLISTS.map(l => (
          <Card key={l.title}>
            <h2 className="text-xl font-bold mb-3">{l.title}</h2>
            <ul className="flex flex-col gap-2">
              {l.items.map(i => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="mt-1 w-4 h-4 rounded shrink-0" style={{ border: `2px solid ${C.green}` }} />{i}
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <button onClick={() => window.print()} className="justify-self-start rounded-full px-5 py-2 font-semibold" style={{ border: `1.5px solid ${C.green}`, color: C.green }}>Print</button>
      </Wrap>
    </IntlLayout>
  )
}

export function IntlHowWeCheck() {
  useTitle('How we check hospitals')
  const steps = [
    { icon: FileText, t: 'Documents', d: 'Every government licence, accreditation and panel, uploaded with expiry dates and checked by our team.' },
    { icon: Video, t: 'Video walkthrough', d: 'A live walk through the ICU, operation theatres, rooms and kitchen with the hospital’s team.' },
    { icon: FileSignature, t: 'Signed agreement', d: 'Price promise, written notice before any extra charge, service standards and NMC rules.' },
    { icon: RefreshCw, t: 'Kept up to date', d: 'Licences are tracked. When one expires, new enquiries pause until it is renewed.' },
  ]
  return (
    <IntlLayout>
      <PageHead kicker="How we check" title="Only hospitals that pass every check are listed" lead="Clinics and day-care centres cannot join. A hospital needs in-patient beds, an ICU, every licence valid, NABH accreditation and a desk for international patients." />
      <Wrap className="py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-12">
          {steps.map((s, i) => (
            <Card key={s.t}>
              <p className="text-sm font-semibold mb-2" style={{ color: C.green }}>Check {i + 1}</p>
              <s.icon className="w-6 h-6 mb-2" style={{ color: C.green }} />
              <p className="font-semibold mb-1">{s.t}</p>
              <p className="text-[15px] leading-relaxed" style={{ color: C.muted }}>{s.d}</p>
            </Card>
          ))}
        </div>
        <h2 className="text-2xl font-bold mb-4">What every hospital must have</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {CHECKLIST.filter(g => g.key !== 'F').map(g => (
            <Card key={g.key}>
              <p className="font-semibold text-lg">{g.title}</p>
              <p className="text-sm mb-3" style={{ color: C.muted }}>{g.note}</p>
              <ul className="flex flex-col gap-1.5 text-[15px]">
                {g.items.filter(i => !i.optional).slice(0, 6).map(i => (
                  <li key={i.key} className="flex gap-2"><CheckCircle2 className="w-4 h-4 shrink-0 mt-1" style={{ color: C.green }} />{i.label}</li>
                ))}
                {g.items.filter(i => !i.optional).length > 6 && <li className="text-sm" style={{ color: C.muted }}>and {g.items.filter(i => !i.optional).length - 6} more</li>}
              </ul>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 mt-10">
          <Card>
            <p className="font-semibold text-lg mb-2">Star levels</p>
            <p className="leading-relaxed" style={{ color: C.muted }}><b style={{ color: C.ink }}>5-star:</b> full NABH accreditation and at least two government panels. <b style={{ color: C.ink }}>4-star:</b> NABH entry-level (or full NABH applied for) and at least one government panel. Star levels describe accreditation only; they do not change the order you see.</p>
          </Card>
          <Card>
            <p className="font-semibold text-lg mb-2">If something goes wrong</p>
            <p className="leading-relaxed" style={{ color: C.muted }}>Tell your coordinator first, any time. Each hospital has a senior person who must answer within 48 hours. You can also write to our Grievance Officer at <a className="underline" href={`mailto:${INTL_EMAIL}`}>{INTL_EMAIL}</a>. Serious incidents pause a hospital’s listing while we review.</p>
          </Card>
        </div>
        <Card className="mt-4">
          <p className="font-semibold text-lg mb-2">About prices</p>
          <ol className="list-decimal pl-5 flex flex-col gap-1.5 leading-relaxed" style={{ color: C.muted }}>
            {ESTIMATE_CLAUSES.map(c => <li key={c}>{c}</li>)}
          </ol>
        </Card>
      </Wrap>
      <BottomCta />
    </IntlLayout>
  )
}
