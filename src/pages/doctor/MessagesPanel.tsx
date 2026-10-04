import { useCallback, useEffect, useRef, useState } from 'react'
import { Phone, Send } from 'lucide-react'
import { listThreads, openThread, sendToPatient, type Thread, type Message } from '../../lib/messagesApi'

// 0197: patients' messages from the Sehatsandhi app, answered by the clinic.
// Every reply shows the patient the name of whoever wrote it.
const t = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })

export default function MessagesPanel({ businessId, onUnread }: { businessId: string; onUnread?: (n: number) => void }) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [phone, setPhone] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [onApp, setOnApp] = useState(true)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const th = await listThreads(businessId)
      setThreads(th)
      if (phone) { const r = await openThread(businessId, phone); setMsgs(r.messages); setOnApp(r.on_app) }
      onUnread?.(th.reduce((a, x) => a + (x.phone === phone ? 0 : Number(x.unread)), 0))
      setErr('')
    } catch (e) { setErr((e as Error).message) }
  }, [businessId, phone, onUnread])
  useEffect(() => { load() }, [load])
  useEffect(() => { const i = setInterval(load, 20_000); return () => clearInterval(i) }, [load])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone || !text.trim()) return
    setBusy(true); setErr('')
    try { const m = await sendToPatient(businessId, phone, text); setMsgs(x => [...x, m]); setText('') } catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
  }
  const current = threads.find(x => x.phone === phone)

  return (
    <div className="card shadow-sm p-0 overflow-hidden">
      <div className="grid md:grid-cols-[18rem_1fr] min-h-[28rem]">
        <div className={`border-r border-gray-100 ${phone ? 'hidden md:block' : ''}`}>
          <div className="p-3 border-b border-gray-100">
            <h2 className="font-bold text-navy-700">Messages</h2>
            <p className="text-xs text-gray-500">Patients write from the Sehatsandhi app after a visit.</p>
          </div>
          {!threads.length && <p className="p-3 text-sm text-gray-500">No messages yet.</p>}
          <div className="max-h-[32rem] overflow-y-auto">
            {threads.map(th => (
              <button key={th.phone} onClick={() => setPhone(th.phone)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 ${phone === th.phone ? 'bg-teal-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate ${th.unread ? 'font-bold text-navy-700' : 'text-gray-800'}`}>{th.names ?? `+${th.phone}`}</span>
                  {Number(th.unread) > 0 && <span className="text-xs font-bold bg-teal-600 text-white rounded-full px-2">{th.unread}</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">{th.last_from === 'clinic' ? 'You: ' : ''}{th.last_body}</div>
                <div className="text-[11px] text-gray-400">{t(th.last_at)}</div>
              </button>
            ))}
          </div>
        </div>
        <div className={`flex flex-col ${phone ? '' : 'hidden md:flex'}`}>
          {!phone ? <p className="m-auto text-sm text-gray-400">Choose a conversation.</p> : (
            <>
              <div className="p-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <button className="md:hidden text-teal-700 text-sm mr-2" onClick={() => setPhone(null)}>‹</button>
                  <span className="font-bold text-navy-700">{current?.names ?? `+${phone}`}</span>
                  {!onApp && <span className="ml-2 text-xs text-amber-700">not on the app — sees replies when they sign in</span>}
                </div>
                <a href={`tel:+${phone}`} className="text-sm text-teal-700 flex items-center gap-1"><Phone className="w-4 h-4" /> +{phone}</a>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[26rem] bg-gray-50">
                {msgs.map(m => (
                  <div key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === 'clinic' ? 'ml-auto bg-[#dcf8c6]' : 'bg-white border border-gray-100'}`}>
                    {m.from === 'clinic' && m.by && <div className="text-xs font-semibold text-teal-700">{m.by}</div>}
                    {m.photo_url && <a href={m.photo_url} target="_blank" rel="noreferrer"><img src={m.photo_url} alt="Photo from the patient" className="rounded-lg max-h-56 my-1" /></a>}
                    <div className="whitespace-pre-wrap text-gray-800">{m.body}</div>
                    <div className="text-[11px] text-gray-400 text-right">{t(m.at)}</div>
                  </div>
                ))}
                <div ref={end} />
              </div>
              {err && <p className="px-3 text-sm text-red-600">{err}</p>}
              <form onSubmit={send} className="p-3 border-t border-gray-100 flex gap-2">
                <textarea className="input-field flex-1" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Reply to the patient"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit() } }} />
                <button disabled={busy || !text.trim()} className="btn-teal px-4 flex items-center gap-1"><Send className="w-4 h-4" /> Send</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
