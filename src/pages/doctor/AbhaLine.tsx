import { useEffect, useState } from 'react'
import { BIZ } from '../business/shared'
import { abdmEnabled, setAbha, formatAbhaNumber } from '../../lib/abdmApi'
import type { PatientSummary } from '../../lib/patientsApi'

// 0287: the patient's ABHA in their header, for a clinic with ABDM switched on.
// Any staff member links one by typing it from the patient's card or app; that
// is "not verified" until ABDM itself confirms it (OTP or scan, when the
// gateway is connected). Every change is kept with who made it (0193).

const input: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, border: `1px solid ${BIZ.border}`, fontSize: 13.5 }
const link: React.CSSProperties = { color: '#0f6b4a', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 12.5 }

export default function AbhaLine({ businessId, memberId, summary, onSaved }: {
  businessId: string; memberId: string; summary: PatientSummary; onSaved: () => void
}) {
  const [on, setOn] = useState(false)
  const [edit, setEdit] = useState<{ number: string; address: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { abdmEnabled(businessId).then(setOn).catch(() => setOn(false)) }, [businessId])
  if (!on) return null

  const has = !!(summary.abha_number || summary.abha_address)
  const save = async (number: string, address: string) => {
    setBusy(true); setErr('')
    try { await setAbha(businessId, memberId, number, address); setEdit(null); onSaved() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const digits = edit ? edit.number.replace(/\D/g, '').length : 0

  if (!edit) return (
    <div style={{ fontSize: 12.5, color: BIZ.muted, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {has ? (
        <>
          <span style={{ fontWeight: 700, color: BIZ.ink }}>ABHA</span>
          {summary.abha_number && <span>{summary.abha_number}</span>}
          {summary.abha_address && <span>{summary.abha_address}</span>}
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
            background: summary.abha_verified_at ? '#e5f4e4' : '#f9eeda', color: summary.abha_verified_at ? '#1f6b2c' : '#8a5a00' }}>
            {summary.abha_verified_at ? 'Verified by ABDM' : 'Not verified'}
          </span>
          <button style={link} onClick={() => setEdit({ number: summary.abha_number ?? '', address: summary.abha_address ?? '' })}>Change</button>
        </>
      ) : (
        <button style={link} onClick={() => setEdit({ number: '', address: '' })}>Add ABHA (health ID)</button>
      )}
      {err && <span style={{ color: '#b3261e' }}>{err}</span>}
    </div>
  )

  return (
    <div style={{ marginTop: 8, padding: 12, borderRadius: 10, background: '#f6faf8', border: `1px solid ${BIZ.border}`, display: 'grid', gap: 8, maxWidth: 520 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.ink }}>ABHA — from the patient's ABHA card or app</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input style={{ ...input, flex: '1 1 190px' }} placeholder="ABHA number, 14 digits" inputMode="numeric" autoFocus
          value={edit.number} onChange={e => setEdit({ ...edit, number: formatAbhaNumber(e.target.value) })} aria-label="ABHA number" />
        <input style={{ ...input, flex: '1 1 190px' }} placeholder="ABHA address, e.g. ravi.kumar@abdm"
          value={edit.address} onChange={e => setEdit({ ...edit, address: e.target.value.replace(/\s/g, '').toLowerCase() })} aria-label="ABHA address" />
      </div>
      <div style={{ fontSize: 12, color: BIZ.muted }}>
        Either one is enough. Typed in, it shows as not verified until the patient confirms it with ABDM.
      </div>
      {err && <div style={{ fontSize: 13, color: '#b3261e' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={busy || (digits > 0 && digits !== 14) || (!edit.number && !edit.address)} onClick={() => save(edit.number, edit.address)}
          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#0f6b4a', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: busy ? .6 : 1 }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setEdit(null); setErr('') }} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${BIZ.border}`, background: '#fff', cursor: 'pointer' }}>Cancel</button>
        {has && (
          <button disabled={busy} onClick={() => save('', '')} style={{ ...link, color: '#b3261e', marginLeft: 'auto' }}>Remove ABHA</button>
        )}
      </div>
    </div>
  )
}
