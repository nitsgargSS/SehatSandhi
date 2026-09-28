import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { activeConfig } from '../lib/env'
import { markPasswordChanged } from '../lib/passwordState'

// 0156: two things every login can do for itself, used on the admin Account
// tab and a clinic user's My practice.
//
//   PhoneVerifyCard   prove your own mobile on WhatsApp. Hidden while the
//                     WhatsApp code is switched off (phone-verify says so) —
//                     then an admin marks numbers verified after calling.
//   SetPasswordByCode set a password with a code emailed to you, for anyone
//                     who signs in by code or has forgotten theirs.

async function phoneVerify<T>(body: unknown): Promise<T> {
  const { url, anon } = activeConfig()
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${url}/functions/v1/phone-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${session?.access_token ?? anon}` },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out?.error || `Request failed (${res.status})`)
  return out as T
}

export function PhoneVerifyCard({ phone, verifiedAt, onVerified }: {
  phone: string | null; verifiedAt: string | null; onVerified: () => void
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { phoneVerify<{ enabled: boolean }>({ action: 'status' }).then(r => setEnabled(r.enabled)).catch(() => setEnabled(false)) }, [])

  const shown = phone ? `+${phone.replace(/\D/g, '').replace(/^(?!91)/, '91')}` : null
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card shadow-sm">
      <h3 className="font-bold text-navy-700 mb-1">Your mobile number</h3>
      {!phone ? <p className="text-sm text-gray-500">No number on your account. Ask an admin to add it.</p> : (
        <p className="text-sm text-gray-700 mb-2">
          {shown} {verifiedAt ? <span className="text-teal-700 font-medium">· ✓ verified</span> : <span className="text-amber-700">· not verified yet</span>}
        </p>
      )}
      {phone && !verifiedAt && enabled === false && (
        <p className="text-xs text-gray-500">Verification by WhatsApp code is coming soon. Until then an admin confirms your number by calling you.</p>
      )}
      {phone && !verifiedAt && enabled && (
        !sent ? (
          <button disabled={busy} onClick={() => run(async () => { await phoneVerify({ action: 'send', phone }); setSent(true) })}
            className="btn-teal text-sm py-2 px-4 disabled:opacity-50">{busy ? 'Sending…' : 'Send me a WhatsApp code'}</button>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <input className="input-field text-center font-mono w-32" inputMode="numeric" maxLength={6} placeholder="••••••"
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            <button disabled={busy || code.length !== 6}
              onClick={() => run(async () => { await phoneVerify({ action: 'verify', phone, code }); onVerified() })}
              className="btn-teal text-sm py-2 px-4 disabled:opacity-50">Verify</button>
          </div>
        )
      )}
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      <p className="text-xs text-gray-400 mt-2">One mobile number belongs to one person on Sehatsandhi.</p>
    </div>
  )
}

/** A clinic user's own number, read from their practitioner record. */
export function PractitionerPhoneCard({ practitionerId }: { practitionerId: string }) {
  const [row, setRow] = useState<{ phone: string | null; phone_verified_at: string | null } | null>(null)
  const load = () => {
    supabase.from('practitioners').select('phone, phone_verified_at').eq('id', practitionerId).maybeSingle()
      .then(({ data }) => setRow((data as { phone: string | null; phone_verified_at: string | null } | null) ?? null))
  }
  useEffect(load, [practitionerId])
  if (!row) return null
  return <PhoneVerifyCard phone={row.phone} verifiedAt={row.phone_verified_at} onVerified={load} />
}

export function SetPasswordByCode() {
  const [step, setStep] = useState<'idle' | 'sent'>('idle')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const send = async () => {
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.auth.reauthenticate()
    setBusy(false)
    if (error) { setErr(error.message); return }
    setStep('sent')
  }
  const save = async () => {
    setErr('')
    if (pw.next !== pw.confirm) { setErr('The two passwords do not match.'); return }
    if (pw.next.length < 12) { setErr('Use at least 12 characters — length matters more than symbols.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw.next, nonce: code.trim() })
    setBusy(false)
    if (error) { setErr(/nonce|otp|token/i.test(error.message) ? 'That code is not right, or has expired. Ask for a new one.' : error.message); return }
    await markPasswordChanged().catch(() => {})
    setStep('idle'); setCode(''); setPw({ next: '', confirm: '' })
    setMsg('Password set. You can now sign in with it, or keep using an emailed code.')
  }

  return (
    <div className="card shadow-sm">
      <h3 className="font-bold text-navy-700 mb-1">Set a password with an emailed code</h3>
      <p className="text-sm text-gray-500 mb-3">
        For when you sign in with a code and have no password, or have forgotten it. We email you a code to prove it is you.
      </p>
      {msg && <p className="text-sm text-teal-700 mb-2">{msg}</p>}
      {step === 'idle' ? (
        <button disabled={busy} onClick={send} className="btn-outline text-sm disabled:opacity-50">{busy ? 'Sending…' : 'Email me a code'}</button>
      ) : (
        <div className="space-y-2">
          <input className="input-field text-center font-mono w-40" inputMode="numeric" maxLength={8} placeholder="Code from email"
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <input className="input-field" type="password" autoComplete="new-password" placeholder="New password (12+ characters)"
            value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} />
          <input className="input-field" type="password" autoComplete="new-password" placeholder="New password again"
            value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
          <div className="flex gap-2">
            <button disabled={busy || code.length < 6 || !pw.next} onClick={save} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Set password'}</button>
            <button onClick={() => setStep('idle')} className="text-sm text-gray-500 underline">Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
    </div>
  )
}
