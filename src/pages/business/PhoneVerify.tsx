import { useState } from 'react'
import { phoneVerify } from '../../lib/businessApi'
import { isValidPhone } from '../../lib/credentials'
import { BIZ } from './shared'

// Step 2: a code on WhatsApp to the number the business registers (0130).
// Shown only while phone-verify reports enabled — until AiSensy can send, the
// wizard skips it and admin confirms the number by calling.

const digits = (p: string) => {
  let d = (p ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return d
}
export const phoneKey = digits

const box: React.CSSProperties = {
  padding: '12px 14px', border: `1px solid ${BIZ.inputBorder}`, borderRadius: 12,
  fontSize: 16, fontFamily: 'inherit', outline: 'none', background: '#fdfbf6',
}

export default function PhoneVerify({ phone, verifiedPhone, onVerified, emailVerified }: {
  phone: string
  verifiedPhone: string | null
  onVerified: (p: string) => void
  /** The code is tied to the email login, so the email comes first. */
  emailVerified: boolean
}) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const verified = !!verifiedPhone && verifiedPhone === digits(phone)

  const send = async () => {
    setErr(''); setBusy(true)
    try { await phoneVerify('send', phone); setSent(true) }
    catch (e) { setErr((e as Error).message.replace(/^.*?:\s*/, '')) }
    finally { setBusy(false) }
  }
  const verify = async () => {
    setErr(''); setBusy(true)
    try {
      const r = await phoneVerify('verify', phone, code)
      if (r.verified) { onVerified(digits(phone)); setSent(false); setCode('') }
    } catch (e) { setErr((e as Error).message.replace(/^.*?:\s*/, '')) }
    finally { setBusy(false) }
  }

  return (
    <div className="sm:col-span-2 xl:col-span-3" style={{ border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: BIZ.ink, flex: '1 1 220px' }}>
          Verify your WhatsApp number {phone ? `(${phone})` : ''}
        </span>
        {verified ? (
          <span style={{ fontSize: 14, fontWeight: 800, color: BIZ.green }}>✓ Verified</span>
        ) : (
          <button type="button" onClick={send} disabled={busy || !emailVerified || !isValidPhone(phone)}
            style={{ padding: '10px 16px', borderRadius: 12, border: 'none', background: BIZ.green, color: '#fff', fontWeight: 800, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', opacity: busy || !emailVerified || !isValidPhone(phone) ? 0.6 : 1 }}>
            {sent ? 'Send again' : 'Send WhatsApp code'}
          </button>
        )}
      </div>
      {!emailVerified && !verified && (
        <p style={{ fontSize: 12.5, color: BIZ.mutedWarm, margin: '6px 0 0' }}>Verify your email first, then your number.</p>
      )}
      {sent && !verified && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code"
            style={{ ...box, width: 180, letterSpacing: 4 }} />
          <button type="button" onClick={verify} disabled={busy || code.length !== 6}
            style={{ padding: '0 16px', minHeight: 46, borderRadius: 12, border: `2px solid ${BIZ.green}`, background: '#fff', color: BIZ.green, fontWeight: 800, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', opacity: busy || code.length !== 6 ? 0.6 : 1 }}>
            Confirm code
          </button>
        </div>
      )}
      {err && <p style={{ fontSize: 13, color: '#c0392b', margin: '8px 0 0' }}>{err}</p>}
    </div>
  )
}
