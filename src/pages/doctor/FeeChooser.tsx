import { BusinessDoctor } from '../../lib/doctorsApi'
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
