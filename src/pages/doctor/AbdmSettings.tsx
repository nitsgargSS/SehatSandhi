import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { setHfrId, setHprId } from '../../lib/abdmApi'

// 0287: the clinic's ABDM IDs, under Clinic. ABDM needs both before a clinic
// can share records: the facility's Health Facility Registry ID, and each
// doctor's Healthcare Professionals Registry ID. The owner or a manager sets
// them; the database also lets a doctor set their own.

type Doc = { id: string; full_name: string; hpr_id: string | null }

export default function AbdmSettings({ businessId, canEdit }: { businessId: string; canEdit: boolean }) {
  const [hfr, setHfr] = useState<string | null | undefined>(undefined)
  const [hfrDraft, setHfrDraft] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  const load = useCallback(() => {
    supabase.from('businesses').select('hfr_id').eq('id', businessId).maybeSingle()
      .then(({ data }) => { const v = (data as { hfr_id?: string | null } | null)?.hfr_id ?? null; setHfr(v); setHfrDraft(v ?? '') })
    supabase.from('business_practitioners').select('role, practitioners(id, full_name, hpr_id)')
      .eq('business_id', businessId).in('role', ['doctor', 'owner'])
      .then(({ data }) => {
        const list = ((data ?? []) as unknown as { practitioners: Doc | null }[]).map(r => r.practitioners).filter((p): p is Doc => !!p)
        setDocs(list); setDrafts(Object.fromEntries(list.map(d => [d.id, d.hpr_id ?? ''])))
      })
  }, [businessId])
  useEffect(load, [load])

  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key); setErr(''); setSaved('')
    try { await f(); setSaved(key); load() } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }

  if (hfr === undefined) return null
  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-600">
        To share records with a patient's ABHA app, ABDM needs this facility's ID and each doctor's ID. Register at
        {' '}<a className="text-teal-700 underline" href="https://facility.abdm.gov.in" target="_blank" rel="noreferrer">facility.abdm.gov.in</a> and
        {' '}<a className="text-teal-700 underline" href="https://hpr.abdm.gov.in" target="_blank" rel="noreferrer">hpr.abdm.gov.in</a> if you have not, then enter them here.
      </p>

      <div>
        <label className="font-semibold text-navy-700 block mb-1">Health Facility Registry (HFR) ID</label>
        <div className="flex gap-2 flex-wrap items-center">
          <input className="input-field max-w-xs" placeholder="e.g. IN2710000123" value={hfrDraft} disabled={!canEdit}
            onChange={e => setHfrDraft(e.target.value.toUpperCase().replace(/\s/g, ''))} aria-label="HFR ID" />
          {canEdit && hfrDraft !== (hfr ?? '') && (
            <button className="btn-teal text-sm py-2 px-4" disabled={busy === 'hfr'} onClick={() => run('hfr', () => setHfrId(businessId, hfrDraft))}>
              {busy === 'hfr' ? 'Saving…' : 'Save'}
            </button>
          )}
          {saved === 'hfr' && <span className="text-teal-700">Saved</span>}
        </div>
      </div>

      <div>
        <label className="font-semibold text-navy-700 block mb-1">Doctors' Healthcare Professionals Registry (HPR) IDs</label>
        {docs.length === 0 && <p className="text-gray-500">No doctors on the team yet.</p>}
        <div className="space-y-2">
          {docs.map(d => (
            <div key={d.id} className="flex gap-2 flex-wrap items-center">
              <span className="w-44 truncate">{d.full_name}</span>
              <input className="input-field max-w-xs" placeholder="14 digits, or name@hpr.abdm" value={drafts[d.id] ?? ''} disabled={!canEdit}
                onChange={e => setDrafts({ ...drafts, [d.id]: e.target.value })} aria-label={`HPR ID for ${d.full_name}`} />
              {canEdit && (drafts[d.id] ?? '') !== (d.hpr_id ?? '') && (
                <button className="btn-teal text-sm py-2 px-4" disabled={busy === d.id} onClick={() => run(d.id, () => setHprId(businessId, d.id, drafts[d.id] ?? ''))}>
                  {busy === d.id ? 'Saving…' : 'Save'}
                </button>
              )}
              {saved === d.id && <span className="text-teal-700">Saved</span>}
            </div>
          ))}
        </div>
      </div>
      {err && <p className="text-red-600">{err}</p>}
    </div>
  )
}
