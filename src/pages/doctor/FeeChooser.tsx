import { useState } from 'react'
import { BusinessDoctor } from '../../lib/doctorsApi'
import { FEE_PAID_OPTIONS } from '../../lib/queueApi'
import { moneyExact } from '../../lib/format'
import { BIZ } from '../business/shared'

// The OPD fee at the desk (0133/0135): the doctor's fee from the system, a
// discount, or free — below the fee needs a reason, which the doctor's report
// shows with who gave it.

export interface FeeChoice { mode: 'full' | 'discount' | 'free'; price: string; reason: string }
export const emptyFee: FeeChoice = { mode: 'full', price: '', reason: '' }

export const doctorFee = (d?: BusinessDoctor | null) => d ? (d.discounted_fee ?? d.consultation_fee ?? 0) : 0

/** What to send: null = the system's fee; a number otherwise. */
export const feeToCharge = (c: FeeChoice): number | null =>
  c.mode === 'full' ? null : c.mode === 'free' ? 0 : Number(c.price)

/** What this choice will charge: the doctor's fee, a discounted one, or nothing. */
export const feeDueOf = (c: FeeChoice, d?: BusinessDoctor | null): number => {
  const fee = doctorFee(d)
  return fee <= 0 ? 0 : c.mode === 'full' ? fee : c.mode === 'free' ? 0 : Number(c.price) || 0
}

// 0226: how the fee was received at the desk. Asked once, then kept for the
// next patient on any of the screens that give a token — a desk mostly takes
// money the same way. '' = not said yet.
let lastPaidHow = ''
export function useFeePaidHow(): [string, (v: string) => void] {
  const [v, setV] = useState(lastPaidHow)
  return [v, (n: string) => { lastPaidHow = n; setV(n) }]
}
export const PAID_HOW_MISSING = 'Say how the fee was received — or choose "Not received now".'

/** "Fee received: Cash / UPI / … / Not received now" — shown only when there is a fee to take. */
export function FeePaidChooser({ due, value, onChange }: { due: number; value: string; onChange: (v: string) => void }) {
  if (!(due > 0)) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
      <span style={{ fontWeight: 700, color: BIZ.ink }}>Fee received:</span>
      {FEE_PAID_OPTIONS.map(([v, l]) => (
        <label key={v} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer', color: v === 'later' ? BIZ.mutedWarm : BIZ.ink }}>
          <input type="radio" checked={value === v} onChange={() => onChange(v)} /> {l}
        </label>
      ))}
    </div>
  )
}

/** "₹200 received." or "₹200 fee not received yet…" after a token is given. */
export function FeePaidNote({ fee, paid }: { fee: number; paid: number }) {
  if (!(fee > 0)) return null
  return paid > 0
    ? <span style={{ color: BIZ.green }}>{moneyExact(paid)} received.</span>
    : <span style={{ color: '#8a5a00' }}>{moneyExact(fee)} fee not received yet — take it in the patient's Billing.</span>
}

export function feeValid(c: FeeChoice, d?: BusinessDoctor | null): boolean {
  const fee = doctorFee(d)
  if (c.mode === 'full' || fee <= 0) return true
  if (c.reason.trim().length < 3) return false
  return c.mode === 'free' || (c.price !== '' && Number(c.price) >= 0 && Number(c.price) < fee)
}

export default function FeeChooser({ doctor, value, onChange, input }: {
  doctor?: BusinessDoctor | null
  value: FeeChoice
  onChange: (c: FeeChoice) => void
  input: React.CSSProperties
}) {
  const fee = doctorFee(doctor)
  if (!doctor) return null
  if (fee <= 0) {
    return <div style={{ fontSize: 12.5, color: BIZ.mutedWarm }}>{doctor.full_name} has no OPD fee set — no charge will be added. Set it under Clinic → Your team.</div>
  }
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, alignItems: 'center' }}>
        <span style={{ fontWeight: 700, color: BIZ.ink }}>OPD fee:</span>
        {([['full', `Full ${moneyExact(fee)}`], ['discount', 'Discount'], ['free', 'Free']] as const).map(([m, l]) => (
          <label key={m} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="radio" checked={value.mode === m} onChange={() => onChange({ ...value, mode: m })} /> {l}
          </label>
        ))}
        {value.mode === 'discount' && (
          <input style={{ ...input, width: 120 }} inputMode="decimal" placeholder={`₹ below ${fee}`} value={value.price}
            onChange={e => onChange({ ...value, price: e.target.value.replace(/[^0-9.]/g, '') })} />
        )}
      </div>
      {value.mode !== 'full' && (
        <input style={input} maxLength={300} value={value.reason}
          placeholder="Why? e.g. Doctor's advice — follow-up within 7 days"
          onChange={e => onChange({ ...value, reason: e.target.value })} />
      )}
    </div>
  )
}
