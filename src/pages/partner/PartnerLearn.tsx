import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Download, FileText, PlayCircle } from 'lucide-react'
import PartnerShell, { usePartnerMe, useTx } from './PartnerShell'
import {
  careContracts, careFileUrl, careModules, careProgress, careSettings, careStep,
  type CareContract, type CareModule, type CareProgress,
} from '../../lib/careApi'

// /partner/learn — the self-learning page (brief §4.2), Phase 1:
// each module has a YouTube video (loaded only when tapped — light on slow
// data) whose furthest point is recorded through the IFrame Player API, and a
// PDF that is opened, read, then marked "I have read this" after a minimum
// time. Module quizzes and the final exam arrive in Phase 2. Contracts and
// policies are listed at the end. A speed bump, not proof: the server keeps
// the furthest point and the reading time; nothing here claims more.

declare global {
  interface Window { YT?: { Player: new (el: HTMLElement, o: unknown) => YtPlayer; PlayerState: { PLAYING: number; ENDED: number } }; onYouTubeIframeAPIReady?: () => void }
}
interface YtPlayer { getCurrentTime(): number; getDuration(): number; destroy(): void }

let ytReady: Promise<void> | null = null
function loadYouTube(): Promise<void> {
  ytReady ??= new Promise(resolve => {
    if (window.YT?.Player) { resolve(); return }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return ytReady
}

export default function PartnerLearn() {
  return (
    <PartnerShell title="Learn" titleHi="सीखें" needs="registered">
      <Learn />
    </PartnerShell>
  )
}

function Learn() {
  const { tx } = useTx()
  const { reload } = usePartnerMe()
  const [modules, setModules] = useState<CareModule[] | null>(null)
  const [progress, setProgress] = useState<Record<string, CareProgress>>({})
  const [contracts, setContracts] = useState<CareContract[]>([])
  const [minSec, setMinSec] = useState(60)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const [m, p, c, s] = await Promise.all([careModules(), careProgress(), careContracts(), careSettings()])
      setModules(m.filter(x => x.is_published))
      setProgress(Object.fromEntries(p.map(x => [x.module_id, x])))
      setContracts(c.filter(x => x.is_current))
      setMinSec(Number(s.doc_min_seconds) || 60)
    } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { // jump to the module the banner pointed at
    if (modules && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
  }, [modules])

  const onStep = (p: CareProgress) => { setProgress(x => ({ ...x, [p.module_id]: p })); reload() }

  if (err) return <p className="text-red-600">{err}</p>
  if (!modules) return <p className="text-gray-400">{tx('Loading…', 'लोड हो रहा है…')}</p>
  const done = modules.filter(m => progress[m.id]?.video_completed_at && progress[m.id]?.doc_read_at).length

  return (<>
    <p className="text-sm text-gray-600">
      {tx(`${done} of ${modules.length} modules done. Watch each video to the end and read each PDF. Quizzes open soon.`,
          `${modules.length} में से ${done} मॉड्यूल पूरे। हर वीडियो अंत तक देखें और हर PDF पढ़ें। क्विज़ जल्द खुलेंगे।`)}
    </p>
    {modules.length === 0 && <div className="card text-gray-600">{tx('The modules are being prepared. Please check back soon.', 'मॉड्यूल तैयार हो रहे हैं। कृपया जल्द फिर देखें।')}</div>}
    {modules.map((m, i) => <ModuleCard key={m.id} m={m} n={i + 1} p={progress[m.id]} minSec={minSec} onStep={onStep} />)}

    <div className="card" id="contracts">
      <h2 className="font-bold text-navy-700 mb-2">{tx('Contracts & policies', 'अनुबंध और नीतियाँ')}</h2>
      {contracts.length === 0
        ? <p className="text-sm text-gray-500">{tx('The Partner Agreement and policies will appear here before you need to accept them.', 'पार्टनर एग्रीमेंट और नीतियाँ स्वीकार करने से पहले यहाँ दिखेंगी।')}</p>
        : <ul className="space-y-2">{contracts.map(c => <ContractRow key={c.id} c={c} />)}</ul>}
    </div>
  </>)
}

function ModuleCard({ m, n, p, minSec, onStep }: { m: CareModule; n: number; p?: CareProgress; minSec: number; onStep: (p: CareProgress) => void }) {
  const { tx, lang } = useTx()
  const [err, setErr] = useState('')
  const videoDone = !!p?.video_completed_at, docDone = !!p?.doc_read_at
  const ytId = (lang === 'hi' ? m.youtube_id_hi ?? m.youtube_id_en : m.youtube_id_en ?? m.youtube_id_hi) ?? null
  const pdf = (lang === 'hi' ? m.pdf_path_hi ?? m.pdf_path_en : m.pdf_path_en ?? m.pdf_path_hi) ?? null
  const step = async (ev: 'video' | 'doc_open' | 'doc_read', pct?: number) => {
    try { setErr(''); onStep(await careStep(m.id, ev, pct)) } catch (e) { setErr((e as Error).message) }
  }

  return (
    <section id={m.slug} className="card scroll-mt-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-gray-500">{tx(`Module ${n}`, `मॉड्यूल ${n}`)}{m.est_minutes ? ` · ${m.est_minutes} ${tx('min', 'मिनट')}` : ''}</div>
          <h2 className="font-bold text-navy-700 text-lg leading-snug">{tx(m.title_en, m.title_hi)}</h2>
          {(m.desc_en || m.desc_hi) && <p className="text-sm text-gray-600 mt-0.5">{tx(m.desc_en ?? '', m.desc_hi ?? '')}</p>}
        </div>
        {videoDone && docDone && <CheckCircle2 className="w-7 h-7 text-teal-600 shrink-0" aria-label={tx('Done', 'पूरा')} />}
      </div>

      <ul className="text-sm mt-3 space-y-1">
        <li className="flex items-center gap-2">{videoDone ? <CheckCircle2 className="w-4 h-4 text-teal-600" /> : <Circle className="w-4 h-4 text-gray-300" />}
          {tx('Video watched', 'वीडियो देखा')}{!videoDone && p?.video_max_pct ? ` (${p.video_max_pct}%)` : ''}</li>
        <li className="flex items-center gap-2">{docDone ? <CheckCircle2 className="w-4 h-4 text-teal-600" /> : <Circle className="w-4 h-4 text-gray-300" />}
          {tx('PDF read', 'PDF पढ़ा')}</li>
        <li className="flex items-center gap-2 text-gray-400"><Circle className="w-4 h-4" /> {tx('Module quiz — opens soon', 'मॉड्यूल क्विज़ — जल्द खुलेगा')}</li>
      </ul>

      {ytId && <Video id={ytId} startPct={p?.video_max_pct ?? 0} onPct={pct => step('video', pct)} />}
      {pdf && <Pdf path={pdf} opened={p?.doc_opened_at ?? null} read={docDone} minSec={minSec}
        onOpen={() => step('doc_open')} onRead={() => step('doc_read')} />}
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
    </section>
  )
}

function Video({ id, startPct, onPct }: { id: string; startPct: number; onPct: (pct: number) => void }) {
  const { tx } = useTx()
  const [on, setOn] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const best = useRef(startPct)
  const sent = useRef(startPct)

  useEffect(() => {
    if (!on || !box.current) return
    let player: YtPlayer | null = null
    let timer: number | undefined
    const report = (force = false) => {
      if (!player) return
      const d = player.getDuration(), t = player.getCurrentTime()
      if (!d) return
      const pct = Math.min(100, Math.floor((t / d) * 100))
      if (pct > best.current) best.current = pct
      // Report every 10 points, and always on the way past 90 and at the end.
      if (force || best.current >= sent.current + 10 || (best.current >= 90 && sent.current < 90)) {
        sent.current = best.current
        onPct(best.current)
      }
    }
    loadYouTube().then(() => {
      if (!box.current || !window.YT) return
      player = new window.YT.Player(box.current, {
        videoId: id, host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, autoplay: 1 },
        events: {
          onStateChange: (e: { data: number }) => {
            window.clearInterval(timer)
            if (e.data === window.YT!.PlayerState.PLAYING) timer = window.setInterval(() => report(), 5000)
            else if (e.data === window.YT!.PlayerState.ENDED) { best.current = 100; report(true) }
            else report()
          },
        },
      })
    })
    return () => { window.clearInterval(timer); report(); player?.destroy() }
  }, [on, id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-3">
      {on
        ? <div className="aspect-video w-full rounded-xl overflow-hidden bg-black"><div ref={box} className="w-full h-full" /></div>
        : <button onClick={() => setOn(true)} className="w-full aspect-video rounded-xl bg-navy-700 text-white flex flex-col items-center justify-center gap-2">
            <PlayCircle className="w-14 h-14" /><span className="text-sm">{tx('Tap to play the video', 'वीडियो चलाने के लिए टैप करें')}</span>
          </button>}
    </div>
  )
}

function Pdf({ path, opened, read, minSec, onOpen, onRead }: {
  path: string; opened: string | null; read: boolean; minSec: number; onOpen: () => Promise<void>; onRead: () => Promise<void>
}) {
  const { tx } = useTx()
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (opened && !read) { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) } }, [opened, read])
  const left = opened ? Math.max(0, Math.ceil(minSec - (now - new Date(opened).getTime()) / 1000)) : minSec
  const open = async (download: boolean) => {
    // Open the tab first (pop-up blockers), then point it at the signed link.
    const w = download ? null : window.open('', '_blank')
    try {
      const url = await careFileUrl(path, download)
      if (w) w.location.href = url; else window.location.href = url
      if (!opened) await onOpen()
    } catch { w?.close() }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button onClick={() => open(false)} className="py-2.5 px-4 rounded-xl border border-gray-300 text-gray-800 font-semibold inline-flex items-center gap-2 min-h-[44px]">
        <FileText className="w-4 h-4" /> {tx('Open PDF', 'PDF खोलें')}
      </button>
      <button onClick={() => open(true)} className="py-2.5 px-3 rounded-xl text-teal-700 inline-flex items-center gap-1 min-h-[44px]">
        <Download className="w-4 h-4" /> {tx('Download', 'डाउनलोड')}
      </button>
      {!read && opened && (
        <button disabled={busy || left > 0} onClick={async () => { setBusy(true); await onRead(); setBusy(false) }}
          className="btn-teal py-2.5 px-4 disabled:opacity-50 min-h-[44px]">
          {left > 0 ? tx(`I have read this (${left}s)`, `मैंने पढ़ लिया (${left} से.)`) : tx('I have read this', 'मैंने पढ़ लिया')}
        </button>
      )}
    </div>
  )
}

function ContractRow({ c }: { c: CareContract }) {
  const { tx, lang } = useTx()
  const path = (lang === 'hi' ? c.pdf_path_hi ?? c.pdf_path_en : c.pdf_path_en ?? c.pdf_path_hi) ?? null
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span>{tx(c.title_en, c.title_hi)} <span className="text-gray-400">· {c.version}</span></span>
      {path && <button className="text-teal-700 underline" onClick={async () => { const w = window.open('', '_blank'); try { const u = await careFileUrl(path); if (w) w.location.href = u } catch { w?.close() } }}>{tx('Open', 'खोलें')}</button>}
    </li>
  )
}
