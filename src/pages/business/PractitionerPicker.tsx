import { useEffect, useRef, useState } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { BIZ } from './shared'
import { SPECIALITIES } from '../../types'
import { searchPractitioners, PractitionerMatch } from '../../lib/identityApi'
import { DraftPractitioner } from '../../lib/businessApi'
import { searchDoctorsByName } from '../../lib/registryLookup'

// Adding a doctor to a business, either way round.
//
// The old wizard could only ever CREATE a doctor into a hospital, so a
// consultant who already worked somewhere else was typed in again as a fresh
// record — and the two copies then drifted apart. Search comes first here for
// exactly that reason: the common case is a doctor who is already on the
// platform, because a visiting consultant is by definition somebody else's
// full-time doctor.
//
// Three sources, in the order they are useful:
//   1. practitioners already here      — attach, no retyping
//   2. the Indian Medical Register     — real credentials, verifiable
//   3. typed in by hand                — the register is incomplete, and
//                                        somebody who qualified last month is
//                                        not in it yet

const input: React.CSSProperties = {
  padding: '11px 13px', borderRadius: 11, border: `1.5px solid ${BIZ.inputBorder}`,
  fontFamily: 'inherit', fontSize: 15, color: BIZ.ink, background: '#fff', width: '100%',
}

export default function PractitionerPicker({ added, onAdd, onRemove, clinicPhone }: {
  added: DraftPractitioner[]
  onAdd: (d: DraftPractitioner) => void
  onRemove: (index: number) => void
  /** The number the clinic itself registered on, for the "this doctor is me" case. */
  clinicPhone?: string
}) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<PractitionerMatch[]>([])
  const [registry, setRegistry] = useState<Awaited<ReturnType<typeof searchDoctorsByName>>>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  // Manual entry, shown once a search has come back without the person in it.
  const [draft, setDraft] = useState<DraftPractitioner>({ name: '', speciality: 'GEN' })
  const [manual, setManual] = useState(false)

  const req = useRef(0)

  // Name and a usable Indian mobile. Ten digits after stripping punctuation is
  // what normalisePhone in clinic-otp accepts, and matching that here means the
  // wizard cannot record a number the login flow would later reject.
  const ready = draft.name.trim().length > 1
    && (draft.phone ?? '').replace(/\D/g, '').length >= 10
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setMatches([]); setRegistry([]); setSearched(false); return }
    const id = ++req.current
    setSearching(true)
    const t = setTimeout(async () => {
      // Both sources at once: the platform knows who is already here, the
      // register knows who is real. Neither alone is enough.
      const [ours, imr] = await Promise.all([
        searchPractitioners(q),
        searchDoctorsByName(q).catch(() => []),
      ])
      if (id !== req.current) return
      setMatches(ours)
      // Anyone already on the platform is offered from there instead, so the
      // same person cannot be added twice from two different lists.
      const known = new Set(ours.map(o => (o.reg_number ?? '').toUpperCase()).filter(Boolean))
      setRegistry(imr.filter(d => !known.has((d.regNo ?? '').toUpperCase())).slice(0, 5))
      setSearching(false)
      setSearched(true)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const alreadyAdded = (id?: string, reg?: string) =>
    added.some(a =>
      (id && a.practitioner_id === id)
      || (reg && (a.reg_number ?? '').toUpperCase() === reg.toUpperCase()))

  const reset = () => {
    setQuery(''); setMatches([]); setRegistry([]); setSearched(false)
    setManual(false); setDraft({ name: '', speciality: 'GEN' })
  }

  // Picking a doctor from the search used to add them immediately. It now fills
  // the form instead, because there is one thing the search cannot tell us and
  // the doctor cannot work without: their phone number.
  //
  // practitioners.auth_uid is set by clinic-otp matching a login against a
  // phone. No phone means no login, no login means auth_uid stays null, and a
  // practitioner with a null auth_uid can never issue a prescription — the
  // Prescriptions pane refuses, correctly, because a prescription carries a
  // registration number and the person it belongs to should have signed in.
  //
  // Registering a doctor without a number produced a name on a roster who could
  // never use the system. Two clinics were registered that way before this was
  // caught.
  const addExisting = (m: PractitionerMatch) => {
    setDraft({
      name: m.full_name,
      speciality: m.speciality ?? 'GEN',
      qualification: m.qualification ?? undefined,
      reg_number: m.reg_number ?? undefined,
      smc_id: m.smc_id ?? undefined,
      practitioner_id: m.id,
      phone: '',
    })
    setManual(true)
    setQuery(''); setMatches([]); setRegistry([]); setSearched(false)
  }

  return (
    <div>
      {/* Who is already added. Above the search, because after the first one
          this list is what the user is checking against. */}
      {added.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {added.map((d, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              border: `1px solid ${BIZ.border}`, borderRadius: 12, marginBottom: 8, background: '#fdfcfa',
            }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: BIZ.ink }}>{d.name}</span>
                <span style={{ fontSize: 12.5, color: BIZ.mutedWarm }}>
                  {' · '}{SPECIALITIES.find(s => s.id === d.speciality)?.en ?? d.speciality}
                  {d.qualification ? ` · ${d.qualification}` : ''}
                </span>
                {/* Says plainly that this is a link, not a copy. Without it,
                    attaching an existing doctor looks identical to creating a
                    new one and nobody can tell which happened. */}
                {d.practitioner_id && (
                  <span style={{ display: 'block', fontSize: 12, color: BIZ.chipText, marginTop: 2 }}>
                    ✓ already on Sehatsandhi — will be linked, not duplicated
                  </span>
                )}
              </span>
              <button onClick={() => onRemove(i)} title="Remove"
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  color: '#d94848', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', padding: 4,
                }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!manual && (
        <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: BIZ.ink, marginBottom: 7 }}>
            Add a doctor
          </label>
          <div style={{ position: 'relative' }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or registration number…"
              style={input} />
            {searching && (
              <Loader2 className="w-4 h-4 animate-spin"
                style={{ position: 'absolute', right: 12, top: 13, color: BIZ.green }} />
            )}
          </div>
          <p style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 6, lineHeight: 1.6 }}>
            If they already work somewhere on Sehatsandhi, add them here and their profile
            follows them — you are not creating a second copy of the same doctor.
          </p>

          {/* Already here → attach */}
          {matches.length > 0 && (
            <div style={{ marginTop: 12, border: `1px solid ${BIZ.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: BIZ.chipBg, fontSize: 12, fontWeight: 800, color: BIZ.chipText }}>
                ALREADY ON SEHATSANDHI
              </div>
              {matches.map(m => {
                const dup = alreadyAdded(m.id, m.reg_number ?? undefined)
                return (
                  <button key={m.id} disabled={dup} onClick={() => addExisting(m)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '11px 13px', border: 'none', borderTop: `1px solid ${BIZ.border}`,
                      background: dup ? '#f7f5f0' : '#fff', cursor: dup ? 'default' : 'pointer',
                      fontFamily: 'inherit', opacity: dup ? 0.6 : 1,
                    }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: BIZ.ink }}>{m.full_name}</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 2 }}>
                        {SPECIALITIES.find(s => s.id === m.speciality)?.en ?? m.speciality ?? 'Doctor'}
                        {m.reg_number ? ` · Reg ${m.reg_number}` : ''}
                        {m.affiliation_count > 0
                          ? ` · works at ${m.affiliation_count} ${m.affiliation_count === 1 ? 'place' : 'places'}`
                          : ''}
                      </span>
                    </span>
                    {dup
                      ? <span style={{ fontSize: 12, fontWeight: 700, color: BIZ.mutedWarm }}>added</span>
                      : <Check style={{ width: 18, height: 18, color: BIZ.green, flex: '0 0 auto' }} />}
                  </button>
                )
              })}
            </div>
          )}

          {/* In the register but not here → create with real credentials */}
          {registry.length > 0 && (
            <div style={{ marginTop: 12, border: `1px solid ${BIZ.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: '#f3f0ff', fontSize: 12, fontWeight: 800, color: '#5b21b6' }}>
                FOUND IN THE MEDICAL REGISTER
              </div>
              {registry.map(d => (
                <button key={`${d.smcId}-${d.regNo}`} onClick={() => {
                  setDraft({
                    name: d.name, speciality: 'GEN', phone: '',
                    reg_number: d.regNo, smc_id: d.smcId,
                  })
                  setManual(true)
                  setQuery(''); setMatches([]); setRegistry([]); setSearched(false)
                }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                    padding: '11px 13px', border: 'none', borderTop: `1px solid ${BIZ.border}`,
                    background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: BIZ.ink }}>{d.name}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 2 }}>
                      {d.council} · Reg {d.regNo}{d.year ? ` · ${d.year}` : ''}
                    </span>
                  </span>
                  <Check style={{ width: 18, height: 18, color: BIZ.green, flex: '0 0 auto' }} />
                </button>
              ))}
            </div>
          )}

          {/* Neither list has them. The register is not complete — nobody who
              qualified in the last few months is in it — so typing must stay
              possible. */}
          {searched && !searching && matches.length === 0 && registry.length === 0 && (
            <div style={{ marginTop: 12, padding: '14px 16px', border: `1px dashed ${BIZ.inputBorder}`, borderRadius: 12 }}>
              <div style={{ fontSize: 13.5, color: BIZ.muted, marginBottom: 10 }}>
                No match for "{query.trim()}". New doctors and anyone who qualified recently
                will not be in the register yet.
              </div>
              <button onClick={() => { setDraft({ name: query.trim(), speciality: 'GEN' }); setManual(true) }}
                style={{
                  padding: '9px 16px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 800, border: `2px solid ${BIZ.green}`,
                  background: '#fff', color: BIZ.green,
                }}>
                Add "{query.trim()}" manually
              </button>
            </div>
          )}

          {!query.trim() && (
            <button onClick={() => setManual(true)}
              style={{
                marginTop: 12, padding: '10px 18px', borderRadius: 11, cursor: 'pointer',
                border: `2px dashed ${BIZ.green}`, background: '#fff', color: BIZ.green,
                fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
              }}>
              + Add a doctor manually
            </button>
          )}
        </>
      )}

      {manual && (
        <div style={{ border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: 16, background: '#fdfcfa' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: BIZ.ink, marginBottom: 12 }}>New doctor</div>
          <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2">
            <input placeholder="Full name *" value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={input} />
            <select value={draft.speciality}
              onChange={e => setDraft(d => ({ ...d, speciality: e.target.value }))} style={input}>
              {SPECIALITIES.map(sp => <option key={sp.id} value={sp.id}>{sp.en}</option>)}
            </select>
            <input placeholder="Qualification — e.g. MBBS, MD" value={draft.qualification ?? ''}
              onChange={e => setDraft(d => ({ ...d, qualification: e.target.value }))} style={input} />
            <input placeholder="Registration number (optional)" value={draft.reg_number ?? ''}
              onChange={e => setDraft(d => ({ ...d, reg_number: e.target.value }))} style={input} />
            <input placeholder="Mobile number *" inputMode="numeric" value={draft.phone ?? ''}
              onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} style={input} />
          </div>

          {/* The solo case, which is most clinics: the owner IS the doctor. They
              had to know to type the same number twice, and nothing said so. */}
          {clinicPhone && clinicPhone.replace(/\D/g, '').length >= 10 && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, cursor: 'pointer' }}>
              <input type="checkbox"
                checked={(draft.phone ?? '').replace(/\D/g, '') === clinicPhone.replace(/\D/g, '')}
                onChange={e => setDraft(d => ({ ...d, phone: e.target.checked ? clinicPhone : '' }))}
                style={{ width: 16, height: 16, accentColor: BIZ.green, cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: BIZ.ink }}>
                This doctor is me — use the clinic’s number ({clinicPhone})
              </span>
            </label>
          )}

          <div style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 8, lineHeight: 1.55 }}>
            The number matters: it is how this doctor signs in, and only a
            signed-in doctor can issue a prescription. One number can be both the
            clinic and the doctor.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button disabled={!ready}
              onClick={() => { onAdd({ ...draft, name: draft.name.trim(), phone: (draft.phone ?? '').trim() }); reset() }}
              style={{
                padding: '10px 18px', borderRadius: 10, border: 'none',
                background: BIZ.green, color: '#fff', fontFamily: 'inherit',
                fontSize: 14, fontWeight: 800,
                cursor: ready ? 'pointer' : 'not-allowed',
                opacity: ready ? 1 : 0.5,
              }}>
              Add doctor
            </button>
            <button onClick={reset}
              style={{
                padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${BIZ.inputBorder}`, background: '#fff', color: BIZ.muted,
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
