import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'
import PartnerShell, { usePartnerMe, useTx } from './PartnerShell'
import { careModules, quizStart, quizSubmit, refresherStart, whenIST, type CareModule, type QuizAttempt, type QuizResult } from '../../lib/careApi'

// /partner/quiz/:slug (a module's quiz), /partner/exam (the final exam) and
// /partner/refresher (the yearly renewal quiz, 0337) —
// brief §4.4, Phase 2. The questions come from the server with their options
// already shuffled and no answers; grading happens there too. A started
// attempt resumes if the page is reopened; walking away counts as a fail.

export function PartnerModuleQuiz() {
  const { slug } = useParams()
  return (
    <PartnerShell title="Module quiz" titleHi="मॉड्यूल क्विज़" needs="registered">
      <QuizFor slug={slug ?? ''} />
    </PartnerShell>
  )
}

export function PartnerFinalExam() {
  return (
    <PartnerShell title="Final exam" titleHi="फ़ाइनल परीक्षा" needs="registered">
      <QuizFor slug={null} />
    </PartnerShell>
  )
}

export function PartnerRefresher() {
  return (
    <PartnerShell title="Refresher quiz" titleHi="रिफ़्रेशर क्विज़" needs="registered">
      <QuizFor slug={null} refresher />
    </PartnerShell>
  )
}

function QuizFor({ slug, refresher = false }: { slug: string | null; refresher?: boolean }) {
  const { tx } = useTx()
  const { me, reload } = usePartnerMe()
  // 0338: the refresher also reactivates an ID paused for having no paying business in time.
  const [reactivating] = useState(() => refresher && me.partner?.status === 'paused' && (me.partner.status_reason ?? '').startsWith('Inactive:'))
  const back = refresher ? (reactivating ? '/partner/dashboard' : '/partner/renew') : '/partner/learn'
  const [mod, setMod] = useState<CareModule | null | undefined>(slug ? undefined : null)
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (slug) careModules().then(ms => setMod(ms.find(m => m.slug === slug && m.is_published) ?? null), () => setMod(null))
  }, [slug])

  const start = async () => {
    setBusy(true); setErr('')
    try { setAttempt(refresher ? await refresherStart() : await quizStart(mod?.id ?? null)); setAnswers({}) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const submit = async () => {
    if (!attempt) return
    setBusy(true); setErr('')
    try { setResult(await quizSubmit(attempt.attempt_id, answers)); await reload() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const pick = (qid: string, oid: string, multi: boolean) =>
    setAnswers(a => ({ ...a, [qid]: multi ? (a[qid]?.includes(oid) ? a[qid].filter(x => x !== oid) : [...(a[qid] ?? []), oid]) : [oid] }))

  if (slug && mod === undefined) return <p className="text-gray-400">{tx('Loading…', 'लोड हो रहा है…')}</p>
  if (slug && !mod) return <p className="card text-gray-600">{tx('This quiz was not found.', 'यह क्विज़ नहीं मिला।')} <Link to="/partner/learn" className="text-teal-700 underline">{tx('Back to Learn', 'सीखें पर वापस')}</Link></p>

  // ── Result ──
  if (result) {
    return (
      <div className="space-y-3">
        <div className={`card ${result.passed ? 'border-2 border-teal-500' : 'border-2 border-amber-400'}`}>
          <p className="text-xl font-bold text-navy-700 flex items-center gap-2">
            {result.passed ? <CheckCircle2 className="w-7 h-7 text-teal-600" /> : <XCircle className="w-7 h-7 text-amber-600" />}
            {result.passed ? tx('Passed!', 'पास!') : tx('Not passed this time', 'इस बार पास नहीं हुए')}
          </p>
          <p className="text-gray-700 mt-1">{tx(`You scored ${result.correct} of ${result.total} (${Math.round(result.score_pct)}%). The pass mark is ${result.pass_mark}%.`,
            `आपके ${result.total} में से ${result.correct} सही (${Math.round(result.score_pct)}%)। पास होने के लिए ${result.pass_mark}% चाहिए।`)}</p>
          {!result.passed && result.next_allowed_at && (
            <p className="text-gray-700 mt-1">{tx(`You can try again after ${whenIST(result.next_allowed_at)}. Use the time to watch the videos and read the PDFs again.`,
              `आप ${whenIST(result.next_allowed_at)} के बाद फिर से कोशिश कर सकते हैं। तब तक वीडियो फिर देखें और PDF फिर पढ़ें।`)}</p>
          )}
          {result.passed && result.kind === 'final' && (
            <p className="text-gray-700 mt-1">{tx('Congratulations. Next, pay the certification fee to get your Partner ID and badge.', 'बधाई हो। अब अपना Partner ID और बैज पाने के लिए सर्टिफ़िकेशन फ़ीस दें।')}</p>
          )}
          {!result.passed && result.kind === 'final' && (result.rules_missed ?? 0) > 0 && (
            <p className="text-amber-800 mt-1">{tx(`${result.rules_missed} question(s) on the rules (dos and don'ts, ethics, communication, code of conduct) were wrong. Every rules question must be right to pass — read those modules again.`,
              `नियमों (क्या करें-न करें, नैतिकता, बातचीत, आचार संहिता) के ${result.rules_missed} सवाल गलत थे। पास होने के लिए नियमों के सभी सवाल सही होने चाहिए — ये मॉड्यूल फिर से पढ़ें।`)}</p>
          )}
          {result.passed && result.reactivated && (
            <p className="text-gray-700 mt-1">{tx('Well done. Your Partner ID is active again.', 'शाबाश। आपका Partner ID फिर से चालू है।')}</p>
          )}
          {result.passed && result.kind === 'refresher' && !result.reactivated && (
            <p className="text-gray-700 mt-1">{tx('Well done. Next, pay the renewal fee to renew your Partner ID for 12 months.', 'शाबाश। अब अपना Partner ID 12 महीने के लिए रिन्यू करने के लिए रिन्यूअल फ़ीस दें।')}</p>
          )}
        </div>
        {!result.passed && result.revise && result.revise.length > 0 && (
          <div className="card">
            <p className="font-semibold text-navy-700 mb-1">{tx('Revise these topics', 'इन विषयों को दोहराएँ')}</p>
            <ul className="list-disc pl-5 text-gray-700">
              {result.revise.map(t => <li key={t.slug}><Link to={`/partner/learn#${t.slug}`} className="text-teal-700 underline">{tx(t.title_en, t.title_hi)}</Link></li>)}
            </ul>
          </div>
        )}
        {result.passed && result.review?.map((q, i) => (
          <div key={q.id} className="card text-[15px]">
            <p className="font-semibold text-gray-800">{i + 1}. {tx(q.text_en, q.text_hi)}</p>
            <ul className="mt-2 space-y-1">
              {q.options.map(o => {
                const right = q.correct.includes(o.id), chose = q.chosen.includes(o.id)
                return <li key={o.id} className={`rounded-lg px-3 py-1.5 ${right ? 'bg-teal-50 text-teal-900' : chose ? 'bg-red-50 text-red-800' : 'text-gray-600'}`}>
                  {right ? '✓ ' : chose ? '✗ ' : ''}{tx(o.text_en, o.text_hi)}</li>
              })}
            </ul>
            {(q.explain_en || q.explain_hi) && <p className="text-sm text-gray-600 mt-2">{tx(q.explain_en ?? '', q.explain_hi ?? '')}</p>}
          </div>
        ))}
        {result.passed && result.kind === 'final' ? <Link to="/partner/certify" className="btn-teal py-3 px-6 w-fit">{tx('Get your Partner ID', 'अपना Partner ID पाएँ')}</Link>
          : result.kind === 'refresher' ? <Link to={back} className="btn-teal py-3 px-6 w-fit">{reactivating ? tx('Go to your dashboard', 'अपने डैशबोर्ड पर जाएँ') : tx('Back to renewal', 'रिन्यूअल पर वापस')}</Link>
          : <Link to="/partner/learn" className="btn-teal py-3 px-6 w-fit">{tx('Back to Learn', 'सीखें पर वापस')}</Link>}
      </div>
    )
  }

  // ── Before starting ──
  if (!attempt) {
    return (
      <div className="card space-y-3">
        {mod && <p className="font-semibold text-navy-700">{tx(mod.title_en, mod.title_hi)}</p>}
        <ul className="list-disc pl-5 text-gray-700 text-[15px] space-y-1">
          {refresher && (reactivating
            ? <li>{tx('Pass this short quiz from all the modules to reactivate your paused Partner ID.', 'अपना रुका हुआ Partner ID फिर चालू करने के लिए सभी मॉड्यूल से यह छोटा क्विज़ पास करें।')}</li>
            : <li>{tx('Your yearly check before renewal: a short set of questions from all the modules. It keeps every Partner ID current.', 'रिन्यूअल से पहले सालाना जाँच: सभी मॉड्यूल से कुछ सवाल। इससे हर Partner ID सही बना रहता है।')}</li>)}
          <li>{slug ? tx('A few questions from this module\'s video and PDF.', 'इस मॉड्यूल के वीडियो और PDF से कुछ सवाल।') : tx('Questions from every module.', 'हर मॉड्यूल से सवाल।')}</li>
          <li>{tx('Each question has 4 options and one right answer — tap it. Nothing to write.', 'हर सवाल के 4 विकल्प और एक सही जवाब — उस पर टैप करें। कुछ लिखना नहीं।')}</li>
          {!slug && !refresher && <li>{tx('To pass: the pass mark overall, and every question on the rules right.', 'पास होने के लिए: कुल पास मार्क, और नियमों के सभी सवाल सही।')}</li>}
          <li>{tx('Once you start, finish within the time shown. Leaving it unfinished counts as not passed.', 'शुरू करने के बाद दिए गए समय में पूरा करें। अधूरा छोड़ने पर पास नहीं माना जाएगा।')}</li>
        </ul>
        {err && <p className="text-red-600">{err}</p>}
        <div className="flex gap-3 flex-wrap">
          <button disabled={busy} onClick={start} className="btn-teal py-3 px-6">{busy ? tx('Starting…', 'शुरू हो रहा है…') : slug || refresher ? tx('Start the quiz', 'क्विज़ शुरू करें') : tx('Start the exam', 'परीक्षा शुरू करें')}</button>
          <Link to={back} className="py-3 px-4 text-gray-600">{tx('Not now', 'अभी नहीं')}</Link>
        </div>
      </div>
    )
  }

  // ── The questions ──
  const answered = attempt.questions.filter(q => (answers[q.id] ?? []).length > 0).length
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{tx(`Finish by ${whenIST(attempt.expires_at)}.`, `${whenIST(attempt.expires_at)} तक पूरा करें।`)}</p>
      {attempt.questions.map((q, i) => {
        const multi = q.qtype === 'multi'
        return (
          <fieldset key={q.id} className="card">
            <legend className="sr-only">{i + 1}</legend>
            <p className="font-semibold text-gray-800 text-[16px]">{i + 1}. {tx(q.text_en, q.text_hi)}</p>
            {multi && <p className="text-xs text-teal-700 mt-0.5">{tx('Choose all that are right.', 'सभी सही जवाब चुनें।')}</p>}
            <div className="mt-2 space-y-2">
              {q.options.map(o => {
                const on = (answers[q.id] ?? []).includes(o.id)
                return (
                  <label key={o.id} className={`flex items-center gap-3 rounded-xl border-2 px-3 min-h-[52px] cursor-pointer ${on ? 'border-teal-600 bg-teal-50' : 'border-gray-200 bg-white'}`}>
                    <input type={multi ? 'checkbox' : 'radio'} name={q.id} checked={on} onChange={() => pick(q.id, o.id, multi)} className="w-5 h-5" />
                    <span className="text-[15px]">{tx(o.text_en, o.text_hi)}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        )
      })}
      {err && <p className="text-red-600">{err}</p>}
      <button disabled={busy || answered < attempt.questions.length} onClick={submit} className="btn-teal py-3 px-6 w-full disabled:opacity-50">
        {answered < attempt.questions.length
          ? tx(`Answer all questions (${answered}/${attempt.questions.length})`, `सभी सवालों के जवाब दें (${answered}/${attempt.questions.length})`)
          : busy ? tx('Checking…', 'जाँच रहे हैं…') : tx('Submit', 'जमा करें')}
      </button>
    </div>
  )
}
