import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { doctorUrl } from '../../lib/links'

// What patients see on the doctor's page (0137) — the page the WhatsApp bot and
// the website link to. The doctor edits it here, or the clinic's owner/manager
// for them. Registration number and status are not here: those are checked by
// Sehatsandhi and only admin can change them.

const LANGS = ['Hindi', 'English', 'Punjabi', 'Haryanvi', 'Urdu', 'Bengali', 'Marathi', 'Gujarati', 'Tamil', 'Telugu']

export default function PublicProfileEditor({ practitionerId }: { practitionerId: string }) {
  const [p, setP] = useState<{ full_name: string; qualification: string; about: string; experience: string; languages: string[]; photo_url: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('practitioners').select('full_name, qualification, about, experience_years, languages, photo_url')
      .eq('id', practitionerId).maybeSingle()
      .then(({ data }) => {
        const d = data as { full_name: string; qualification: string | null; about: string | null; experience_years: number | null; languages: string[] | null; photo_url: string | null } | null
        if (d) setP({ full_name: d.full_name, qualification: d.qualification ?? '', about: d.about ?? '', experience: d.experience_years != null ? String(d.experience_years) : '', languages: d.languages ?? [], photo_url: d.photo_url })
      })
  }, [practitionerId])

  if (!p) return null

  const save = async (patch?: Record<string, unknown>) => {
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.from('practitioners').update(patch ?? {
      qualification: p.qualification.trim() || null,
      about: p.about.trim() || null,
      experience_years: p.experience ? Number(p.experience) : null,
      languages: p.languages.length ? p.languages : null,
    }).eq('id', practitionerId)
    setBusy(false)
    if (error) setErr(error.message); else setMsg('Saved — your public page is updated.')
  }

  const upload = async (file: File) => {
    setErr(''); setMsg('')
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setErr('Use a PNG, JPG or WebP photo.'); return }
    if (file.size > 3 * 1024 * 1024) { setErr('Keep the photo under 3 MB.'); return }
    setBusy(true)
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${practitionerId}/photo-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('profile-photos').upload(path, file, { contentType: file.type })
    if (upErr) { setBusy(false); setErr(upErr.message); return }
    const url = supabase.storage.from('profile-photos').getPublicUrl(path).data.publicUrl
    setP({ ...p, photo_url: url })
    await save({ photo_url: url })
  }

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-navy-700">Public profile</h3>
        <a href={doctorUrl({ id: practitionerId, name: p.full_name })} target="_blank" rel="noreferrer" className="text-sm text-teal-700 underline">
          View my page
        </a>
      </div>
      <p className="text-sm text-gray-500">This is the page the WhatsApp bot and the website link patients to.</p>
      <div className="flex gap-4 items-center flex-wrap">
        {p.photo_url
          ? <img src={p.photo_url} alt="" className="w-20 h-20 rounded-xl object-cover border" />
          : <div className="w-20 h-20 rounded-xl bg-teal-50 border flex items-center justify-center text-2xl font-bold text-teal-600">{p.full_name.split(' ').pop()?.charAt(0)}</div>}
        <label className={`btn-teal text-sm px-4 py-2 cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          {p.photo_url ? 'Change photo' : 'Add photo'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="block text-xs font-medium text-gray-600 mb-1">Qualification</span>
          <input className="input-field" value={p.qualification} placeholder="e.g. MBBS, MS (Ophthalmology)"
            onChange={e => setP({ ...p, qualification: e.target.value })} /></label>
        <label className="text-sm"><span className="block text-xs font-medium text-gray-600 mb-1">Years of experience</span>
          <input className="input-field" inputMode="numeric" value={p.experience} placeholder="e.g. 12"
            onChange={e => setP({ ...p, experience: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></label>
      </div>
      <div>
        <span className="block text-xs font-medium text-gray-600 mb-1">Languages spoken</span>
        <div className="flex flex-wrap gap-2">
          {LANGS.map(l => {
            const on = p.languages.includes(l)
            return (
              <button key={l} type="button"
                onClick={() => setP({ ...p, languages: on ? p.languages.filter(x => x !== l) : [...p.languages, l] })}
                className={`text-xs px-3 py-1.5 rounded-full border ${on ? 'bg-teal-50 border-teal-500 text-teal-800' : 'bg-white border-gray-200 text-gray-600'}`}>
                {l}
              </button>
            )
          })}
        </div>
      </div>
      <label className="text-sm block"><span className="block text-xs font-medium text-gray-600 mb-1">About you</span>
        <textarea className="input-field min-h-[110px]" maxLength={1500} value={p.about}
          placeholder="What you treat, special interests, procedures you perform, where you trained…"
          onChange={e => setP({ ...p, about: e.target.value })} />
        <span className="text-xs text-gray-400">{p.about.length}/1500</span>
      </label>
      <div className="flex gap-3 items-center">
        <button onClick={() => save()} disabled={busy} className="btn-teal text-sm px-5 py-2 disabled:opacity-50">{busy ? 'Saving…' : 'Save profile'}</button>
        {msg && <span className="text-sm text-teal-700">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  )
}
