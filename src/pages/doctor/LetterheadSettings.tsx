import { useState } from 'react'
import { supabase } from '../../lib/supabase'

// The hospital's banner for printing (0135): uploaded once, printed at the top
// of OPD slips, bills, prescriptions and discharge summaries. Without one they
// print the name, address and phone.

export default function LetterheadSettings({ businessId, current, onSaved }: {
  businessId: string
  current: string | null
  onSaved: (url: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const upload = async (file: File) => {
    setErr('')
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setErr('Use a PNG, JPG or WebP image.'); return }
    if (file.size > 2 * 1024 * 1024) { setErr('Keep the image under 2 MB.'); return }
    setBusy(true)
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${businessId}/banner-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('letterheads').upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw new Error(upErr.message)
      const url = supabase.storage.from('letterheads').getPublicUrl(path).data.publicUrl
      const { error } = await supabase.rpc('sehat_set_letterhead', { p_business: businessId, p_url: url })
      if (error) throw new Error(error.message)
      onSaved(url)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('sehat_set_letterhead', { p_business: businessId, p_url: null })
    setBusy(false)
    if (error) setErr(error.message); else onSaved(null)
  }

  return (
    <div className="card shadow-sm space-y-3">
      <div>
        <h3 className="font-bold text-navy-700">Printing — hospital banner</h3>
        <p className="text-sm text-gray-500">
          Printed at the top of OPD slips, bills, prescriptions and discharge summaries. A wide image works best
          (about 1600 × 300 pixels) with your logo, name, address and phone. Without one, your name, address and phone print as text.
        </p>
      </div>
      {current && <img src={current} alt="Current banner" className="w-full max-h-40 object-contain border rounded-lg bg-white" />}
      <div className="flex gap-2 flex-wrap items-center">
        <label className={`btn-teal text-sm px-4 py-2 cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          {busy ? 'Uploading…' : current ? 'Replace banner' : 'Upload banner'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        </label>
        {current && <button onClick={remove} disabled={busy} className="text-sm text-red-600 px-3">Remove</button>}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}
