import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { documentLink, getSendOptions, mailtoFor, sendDocument, type DocKind, type SendOptions } from '../lib/sendApi'

// "Send to patient", with the choice of how (0218):
//
//   WhatsApp · ₹0.50      from the wallet; without the add-on, a way to the plan
//   Email · free          sent by Sehatsandhi under the clinic's name
//   My own email app      opens the clinic's mail app with the link filled in
//
// One menu for every document, so a prescription, a bill and a report are sent
// the same way and cost the same.

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`

const row: CSSProperties = { display: 'grid', gap: 6, padding: '10px 0', borderTop: '1px solid #eef1ef' }
const action: CSSProperties = {
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '8px 12px', borderRadius: 8,
  border: '1px solid #cfd8d3', background: '#fff', color: '#1c2b24', textAlign: 'left', width: '100%',
}
const hint: CSSProperties = { fontSize: 11.5, color: '#5b6b63', lineHeight: 1.4 }

/** Ask the dashboard to show one of its tabs ("plan", "whatsapp"). */
const openTab = (tab: string) => window.dispatchEvent(new CustomEvent('sehat:open-tab', { detail: tab }))

export default function SendMenu({ kind, id, businessId, children, style, className, disabled, onSent }: {
  kind: DocKind
  id: string
  businessId: string
  /** The button's label. */
  children: ReactNode
  style?: CSSProperties
  className?: string
  disabled?: boolean
  /** Called with a line to show ("Sent on WhatsApp.") once something went. */
  onSent?: (note: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<SendOptions | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<'' | 'whatsapp' | 'email' | 'own'>('')
  const [err, setErr] = useState('')
  const [needsPlan, setNeedsPlan] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    setErr(''); setNeedsPlan(false)
    getSendOptions(businessId).then(setOptions)
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open, businessId])

  const done = (note: string) => { setOpen(false); onSent?.(note) }
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim())

  const viaWhatsApp = async () => {
    setBusy('whatsapp'); setErr(''); setNeedsPlan(false)
    try { await sendDocument(kind, id, 'whatsapp'); done('Sent on WhatsApp.') }
    catch (e) { setErr((e as Error).message); setNeedsPlan(!!(e as { needsPlan?: boolean }).needsPlan) }
    finally { setBusy('') }
  }
  const viaEmail = async () => {
    setBusy('email'); setErr('')
    try { await sendDocument(kind, id, 'email', email.trim()); done(`Emailed to ${email.trim()}.`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  const viaOwnApp = async () => {
    setBusy('own'); setErr('')
    try {
      window.location.href = mailtoFor(await documentLink(kind, id), email)
      done('Opened in your email app — press Send there.')
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }

  const blocked = options?.whatsapp_blocker ?? null
  const short = !!options && !blocked && options.balance_paise < options.whatsapp_paise

  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" style={style} className={className} disabled={disabled} onClick={() => setOpen(o => !o)}>{children}</button>
      {open && (
        <div role="dialog" aria-label="Send to patient" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, width: 300, maxWidth: '86vw',
          background: '#fff', border: '1px solid #cfd8d3', borderRadius: 12, boxShadow: '0 10px 30px rgba(15,40,30,.16)',
          padding: '12px 14px 6px', textAlign: 'left', fontWeight: 400,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1c2b24', paddingBottom: 8 }}>Send to patient</div>

          <div style={row}>
            {blocked || needsPlan ? (
              <>
                <button type="button" style={action} onClick={() => { setOpen(false); openTab('plan') }}>WhatsApp — add it to your plan →</button>
                <span style={hint}>{blocked ?? 'Add WhatsApp to your plan to send on WhatsApp.'}</span>
              </>
            ) : short ? (
              <>
                <button type="button" style={action} onClick={() => { setOpen(false); openTab('whatsapp') }}>WhatsApp — top up your wallet →</button>
                <span style={hint}>A message costs {rupees(options!.whatsapp_paise)}; your wallet has {rupees(options!.balance_paise)}.</span>
              </>
            ) : (
              <>
                <button type="button" style={action} disabled={!!busy} onClick={viaWhatsApp}>
                  {busy === 'whatsapp' ? 'Sending…' : `WhatsApp${options ? ` · ${rupees(options.whatsapp_paise)}` : ''}`}
                </button>
                <span style={hint}>
                  To the patient's mobile number.{options ? ` Taken from your wallet (${rupees(options.balance_paise)} left); returned if it is not delivered.` : ''}
                </span>
              </>
            )}
          </div>

          <div style={row}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Patient's email address"
              aria-label="Patient's email address"
              style={{ fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid #cfd8d3', width: '100%', boxSizing: 'border-box' }} />
            <button type="button" style={action} disabled={!!busy || !validEmail} onClick={viaEmail}>
              {busy === 'email' ? 'Sending…' : 'Email · free'}
            </button>
            <span style={hint}>Sent by Sehatsandhi in your clinic's name. If the patient replies, it comes to your clinic's email.</span>
            <button type="button" style={action} disabled={!!busy} onClick={viaOwnApp}>
              {busy === 'own' ? 'Opening…' : 'My own email app · free'}
            </button>
            <span style={hint}>Opens your email app with the message written — it goes from your own address when you press Send.</span>
          </div>

          {err && <div style={{ ...hint, color: '#a12b2b', padding: '8px 0 6px', borderTop: '1px solid #eef1ef' }}>{err}</div>}
        </div>
      )}
    </span>
  )
}
