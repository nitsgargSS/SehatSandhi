import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Markdown from '../../site/Markdown'
import type { L10n, SiteContent } from '../../site/siteData'
import { FONT_PAIRS, fontPair, loadFontPair } from '../../site/fonts'

// The business's own website (0282), edited by its owner: the address, colour,
// logo and photos, the blocks of text the site prints, and the articles.
// Doctors, fees, ratings, hours and camps are not here — the site reads those
// live from the rest of Sehatsandhi, so they are edited where they always were.
// RLS lets only the owner (or an admin) write; the tab is the owner's alone.

interface SiteRow {
  business_id: string; slug: string; custom_domain: string | null; is_live: boolean
  brand_color: string | null; logo_url: string | null; hero_image_url: string | null; content: SiteContent
}
interface ArticleRow {
  id?: string; slug: string; lang: 'en' | 'hi'; title: string; summary: string | null; body: string
  image_url: string | null; author: string | null; read_minutes: number | null; published_on: string | null; is_published: boolean
}

const COLOURS = ['#0f4c5c', '#0d9488', '#1e3a8a', '#7c2d12', '#6d28d9', '#be123c', '#166534', '#334155']
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
const slugify = (s: string, max = 50) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '')
const today = () => new Date().toISOString().slice(0, 10)

async function uploadImage(businessId: string, file: File, name: string): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP image.')
  if (file.size > 3 * 1024 * 1024) throw new Error('Keep the image under 3 MB.')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${businessId}/${name}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('site-images').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return supabase.storage.from('site-images').getPublicUrl(path).data.publicUrl
}

export default function WebsitePanel({ businessId, businessName }: { businessId: string; businessName: string }) {
  const [site, setSite] = useState<SiteRow | null | undefined>(undefined)
  const [articles, setArticles] = useState<ArticleRow[]>([])
  const [err, setErr] = useState('')

  const load = async () => {
    const [{ data: s, error: e1 }, { data: a, error: e2 }] = await Promise.all([
      supabase.from('business_sites').select('business_id, slug, custom_domain, is_live, brand_color, logo_url, hero_image_url, content').eq('business_id', businessId).maybeSingle(),
      supabase.from('site_articles').select('id, slug, lang, title, summary, body, image_url, author, read_minutes, published_on, is_published').eq('business_id', businessId).order('published_on', { ascending: false, nullsFirst: true }),
    ])
    if (e1 || e2) { setErr((e1 ?? e2)!.message); setSite(null); return }
    setSite((s as SiteRow | null) ?? null)
    setArticles((a as ArticleRow[]) ?? [])
  }
  useEffect(() => { load() }, [businessId])

  if (site === undefined) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
  if (site === null) return <CreateSite businessId={businessId} businessName={businessName} err={err} onMade={load} />
  return (
    <div className="space-y-4">
      <SiteEditor businessId={businessId} site={site} onSaved={setSite} />
      <Articles businessId={businessId} articles={articles} onChanged={load} siteUrl={siteUrl(site.slug)} />
    </div>
  )
}

const siteUrl = (slug: string) => `${window.location.origin}/s/${slug}`

function CreateSite({ businessId, businessName, err: loadErr, onMade }: { businessId: string; businessName: string; err: string; onMade: () => void }) {
  const [slug, setSlug] = useState(() => slugify(businessName))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(loadErr)
  const make = async () => {
    if (!SLUG_RE.test(slug)) { setErr('Use 3–50 small letters, numbers and dashes.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('business_sites').insert({ business_id: businessId, slug, content: {} })
    setBusy(false)
    if (error) setErr(error.code === '23505' ? 'That address is taken. Try another.' : error.message); else onMade()
  }
  return (
    <div className="card shadow-sm space-y-3">
      <div>
        <h3 className="font-bold text-navy-700">Your website</h3>
        <p className="text-sm text-gray-500">
          A website for {businessName}, free: your doctors, fees, hours, reviews and WhatsApp booking appear on it
          by themselves. Choose its address, then add your photos and text.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-500">{window.location.host}/s/</span>
        <input className="input-field max-w-xs" value={slug} onChange={e => setSlug(slugify(e.target.value))} />
      </div>
      <button onClick={make} disabled={busy} className="btn-teal text-sm px-5 py-2">{busy ? 'Creating…' : 'Create my website'}</button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Section({ title, hint, open: startOpen = false, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="border border-gray-100 rounded-xl">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span>
          <span className="font-semibold text-navy-700">{title}</span>
          {hint && <span className="block text-xs text-gray-500">{hint}</span>}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  )
}

const Label = ({ children }: { children: ReactNode }) => <span className="block text-xs font-semibold text-gray-600 mb-1">{children}</span>

/** English and Hindi side by side; Hindi left empty shows the English. */
function Bi({ label, value, onChange, rows = 1 }: { label: string; value: L10n | undefined; onChange: (v: L10n) => void; rows?: number }) {
  const v = value ?? {}
  const field = (lang: 'en' | 'hi') => rows > 1
    ? <textarea className="input-field" rows={rows} value={v[lang] ?? ''} placeholder={lang === 'hi' ? 'हिंदी (optional)' : 'English'}
        onChange={e => onChange({ ...v, [lang]: e.target.value })} />
    : <input className="input-field" value={v[lang] ?? ''} placeholder={lang === 'hi' ? 'हिंदी (optional)' : 'English'}
        onChange={e => onChange({ ...v, [lang]: e.target.value })} />
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className="grid sm:grid-cols-2 gap-2">{field('en')}{field('hi')}</div>
    </label>
  )
}

function Text({ label, value, onChange, placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input className="input-field" value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

function ImagePick({ businessId, label, name, url, onChange, wide }: { businessId: string; label: string; name: string; url: string | null | undefined; onChange: (u: string | null) => void; wide?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pick = async (f: File) => {
    setBusy(true); setErr('')
    try { onChange(await uploadImage(businessId, f, name)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-3 flex-wrap">
        {url && <img src={url} alt="" className={`${wide ? 'w-40 h-24' : 'w-16 h-16'} object-cover rounded-lg border bg-white`} />}
        <label className={`btn-outline text-sm cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          {busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
        </label>
        {url && <button type="button" onClick={() => onChange(null)} className="text-sm text-red-600">Remove</button>}
      </div>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}

/** A list of rows, each with its own fields, with add, remove and move up. */
function Rows<T>({ items, blank, add, render, onChange }: { items: T[]; blank: () => T; add: string; render: (it: T, set: (v: T) => void) => ReactNode; onChange: (v: T[]) => void }) {
  const set = (i: number, v: T) => onChange(items.map((x, j) => j === i ? v : x))
  const move = (i: number) => { if (i === 0) return; const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50/60 space-y-2">
          {render(it, v => set(i, v))}
          <div className="flex gap-3 justify-end text-xs">
            {i > 0 && <button type="button" onClick={() => move(i)} className="text-gray-500">Move up</button>}
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-red-600 inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Remove</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, blank()])} className="text-sm text-teal-700 font-semibold inline-flex items-center gap-1"><Plus className="w-4 h-4" /> {add}</button>
    </div>
  )
}

function FontPick({ value, onChange }: { value: string | undefined; onChange: (k: string) => void }) {
  useEffect(() => { FONT_PAIRS.forEach(loadFontPair) }, [])
  const current = fontPair(value).key
  return (
    <div>
      <Label>Font style</Label>
      <div className="grid sm:grid-cols-2 gap-2">
        {FONT_PAIRS.map(f => (
          <button key={f.key} type="button" onClick={() => onChange(f.key)}
            className={`text-left rounded-xl border-2 px-4 py-3 bg-white ${current === f.key ? 'border-teal-600' : 'border-gray-100 hover:border-gray-300'}`}>
            <span className="block text-2xl text-gray-900" style={{ fontFamily: `${f.head},serif`, fontWeight: f.headWeight }}>{f.label}: care close to home</span>
            <span className="block text-sm text-gray-700 mt-0.5" style={{ fontFamily: `${f.body},sans-serif` }}>Gentle care for every patient. <span style={{ fontFamily: `${f.headHi},serif` }}>आँखों की देखभाल</span></span>
            <span className="block text-xs text-gray-400 mt-1" style={{ fontFamily: 'inherit' }}>{f.note}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── The site ────────────────────────────────────────────────────────────────

function SiteEditor({ businessId, site, onSaved }: { businessId: string; site: SiteRow; onSaved: (s: SiteRow) => void }) {
  const [s, setS] = useState<SiteRow>(site)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const c = s.content ?? {}
  const setC = (patch: Partial<SiteContent>) => setS(x => ({ ...x, content: { ...x.content, ...patch } }))
  const dirty = JSON.stringify(s) !== JSON.stringify(site)

  const save = async () => {
    if (!SLUG_RE.test(s.slug)) { setMsg({ ok: false, text: 'The address takes 3–50 small letters, numbers and dashes.' }); return }
    setBusy(true); setMsg(null)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('business_sites').update({
      slug: s.slug, is_live: s.is_live, brand_color: s.brand_color, logo_url: s.logo_url, hero_image_url: s.hero_image_url,
      content: s.content, updated_at: new Date().toISOString(), updated_by: user?.id ?? null,
    }).eq('business_id', businessId)
    setBusy(false)
    if (error) setMsg({ ok: false, text: error.code === '23505' ? 'That address is taken. Try another.' : error.message })
    else { setMsg({ ok: true, text: 'Saved. Your website shows it now.' }); onSaved(s) }
  }

  const doc = c.doctor ?? { name: '' }
  const setDoc = (patch: Partial<NonNullable<SiteContent['doctor']>>) => setC({ doctor: { ...doc, ...patch } })
  const tech = c.technology ?? { items: [] }
  const ins = c.insurance ?? {}
  const visit = c.visit ?? {}
  const social = c.social ?? {}

  return (
    <div className="card shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-navy-700">Your website</h3>
          <p className="text-sm text-gray-500">
            Doctors, fees, hours, reviews, camps and WhatsApp booking come from Sehatsandhi by themselves. Here you add what only you can tell patients.
          </p>
        </div>
        <a href={siteUrl(site.slug)} target="_blank" rel="noreferrer" className="btn-outline text-sm inline-flex items-center gap-1.5">
          Open website <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <Section title="Address, colour and photos" open>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">{window.location.host}/s/</span>
          <input className="input-field max-w-xs" value={s.slug} onChange={e => setS({ ...s, slug: slugify(e.target.value) })} />
        </div>
        {s.custom_domain && <p className="text-sm text-gray-600">Also at <b>{s.custom_domain}</b> (own name plan).</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.is_live} onChange={e => setS({ ...s, is_live: e.target.checked })} />
          Website is on (untick to take it offline)
        </label>
        <div>
          <Label>Colour</Label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOURS.map(col => (
              <button key={col} type="button" onClick={() => setS({ ...s, brand_color: col })} aria-label={col}
                className={`w-8 h-8 rounded-full border-2 ${(s.brand_color ?? '#0f4c5c') === col ? 'border-gray-900' : 'border-white shadow'}`} style={{ background: col }} />
            ))}
            <input type="color" value={s.brand_color ?? '#0f4c5c'} onChange={e => setS({ ...s, brand_color: e.target.value })} className="w-10 h-8 cursor-pointer" />
          </div>
        </div>
        <FontPick value={c.font} onChange={k => setC({ font: k })} />
        <div className="grid sm:grid-cols-2 gap-4">
          <ImagePick businessId={businessId} label="Logo" name="logo" url={s.logo_url} onChange={u => setS({ ...s, logo_url: u })} />
          <ImagePick businessId={businessId} label="Main photo (top of the home page)" name="hero" url={s.hero_image_url} wide onChange={u => setS({ ...s, hero_image_url: u })} />
        </div>
      </Section>

      <Section title="Home page text" hint="The first thing patients read">
        <Bi label="Small line above the heading" value={c.kicker} onChange={v => setC({ kicker: v })} />
        <Bi label="Heading" value={c.tagline} onChange={v => setC({ tagline: v })} />
        <Bi label="Introduction" value={c.intro} rows={3} onChange={v => setC({ intro: v })} />
        <Label>Figures (e.g. 15+ / Years of practice)</Label>
        <Rows items={c.highlights ?? []} add="Add a figure" blank={() => ({ value: '', label: {} })} onChange={v => setC({ highlights: v })}
          render={(h, set) => (<>
            <Text label="Figure" value={h.value} onChange={x => set({ ...h, value: x })} placeholder="15+" />
            <Bi label="What it is" value={h.label} onChange={x => set({ ...h, label: x })} />
          </>)} />
      </Section>

      <Section title="Lead doctor" hint="The doctor the site is about. Fees and other doctors come from Doctors.">
        <Text label="Name" value={doc.name} onChange={v => setDoc({ name: v })} placeholder="Dr. …" />
        <Bi label="Role" value={doc.role} onChange={v => setDoc({ role: v })} />
        <Bi label="Qualifications" value={doc.qualification} onChange={v => setDoc({ qualification: v })} />
        <Bi label="Short introduction" value={doc.summary} rows={2} onChange={v => setDoc({ summary: v })} />
        <Bi label="Full background" value={doc.bio} rows={5} onChange={v => setDoc({ bio: v })} />
        <ImagePick businessId={businessId} label="Photo" name="doctor" url={doc.photo_url} onChange={u => setDoc({ photo_url: u ?? undefined, avatar_url: undefined })} />
        <Label>Training & fellowships</Label>
        <Rows items={doc.training ?? []} add="Add training" blank={() => ({ title: '', place: '' })} onChange={v => setDoc({ training: v })}
          render={(t, set) => (
            <div className="grid sm:grid-cols-2 gap-2">
              <Text label="What" value={t.title} onChange={x => set({ ...t, title: x })} placeholder="Glaucoma fellowship" />
              <Text label="Where" value={t.place} onChange={x => set({ ...t, place: x })} placeholder="Hospital, city" />
            </div>
          )} />
      </Section>

      <Section title="Treatments" hint="Featured ones show on the home page; all on Services">
        <Bi label="Section heading" value={c.treatments_title} onChange={v => setC({ treatments_title: v })} />
        <Bi label="Section introduction" value={c.treatments_intro} rows={2} onChange={v => setC({ treatments_intro: v })} />
        <Rows items={c.treatments ?? []} add="Add a treatment" blank={() => ({ slug: '', title: {}, featured: true })} onChange={v => setC({ treatments: v })}
          render={(t, set) => (<>
            <Bi label="Name" value={t.title} onChange={x => set({ ...t, title: x, slug: t.slug || slugify(x.en ?? '', 60) })} />
            <Bi label="One line" value={t.teaser} onChange={x => set({ ...t, teaser: x })} />
            <Bi label="More detail (Services page)" value={t.body} rows={3} onChange={x => set({ ...t, body: x })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!t.featured} onChange={e => set({ ...t, featured: e.target.checked })} /> Show on the home page</label>
          </>)} />
      </Section>

      <Section title="Equipment">
        <Bi label="Section heading" value={tech.title} onChange={v => setC({ technology: { ...tech, title: v } })} />
        <Bi label="Introduction" value={tech.intro} rows={2} onChange={v => setC({ technology: { ...tech, intro: v } })} />
        <Rows<NonNullable<SiteContent['technology']>['items'][number]> items={tech.items} add="Add equipment" blank={() => ({ name: {} })} onChange={v => setC({ technology: { ...tech, items: v } })}
          render={(it, set) => (<>
            <Bi label="Name" value={it.name} onChange={x => set({ ...it, name: x })} />
            <ImagePick businessId={businessId} label="Photo" name="equipment" url={it.image_url} wide onChange={u => set({ ...it, image_url: u ?? undefined })} />
          </>)} />
      </Section>

      <Section title="What patients say" hint="Shown with your Sehatsandhi reviews">
        <Rows<NonNullable<SiteContent['testimonials']>[number]> items={c.testimonials ?? []} add="Add a testimonial" blank={() => ({ text: '', name: '' })} onChange={v => setC({ testimonials: v })}
          render={(t, set) => (<>
            <label className="block"><Label>What they said</Label>
              <textarea className="input-field" rows={3} value={t.text} onChange={e => set({ ...t, text: e.target.value })} /></label>
            <div className="grid sm:grid-cols-3 gap-2">
              <Text label="Name" value={t.name} onChange={x => set({ ...t, name: x })} />
              <Text label="When" value={t.when} onChange={x => set({ ...t, when: x })} placeholder="March 2026" />
              <Text label="From" value={t.source} onChange={x => set({ ...t, source: x })} placeholder="Google" />
            </div>
          </>)} />
      </Section>

      <Section title="Insurance">
        <Bi label="Section heading" value={ins.title} onChange={v => setC({ insurance: { ...ins, title: v } })} />
        <Bi label="Introduction" value={ins.intro} rows={2} onChange={v => setC({ insurance: { ...ins, intro: v } })} />
        <label className="block"><Label>Insurers and TPAs, one per line</Label>
          <textarea className="input-field" rows={5} value={(ins.panel ?? []).join('\n')}
            onChange={e => setC({ insurance: { ...ins, panel: e.target.value.split('\n').map(x => x.trimStart()).filter((x, i, a) => x || i === a.length - 1) } })} /></label>
        <Bi label="Note below the list" value={ins.note} rows={2} onChange={v => setC({ insurance: { ...ins, note: v } })} />
      </Section>

      <Section title="Visit us and social links" hint="Phone and hours here replace the listing's on the website">
        <Text label="Phone" value={visit.phone} onChange={v => setC({ visit: { ...visit, phone: v } })} placeholder="+91 …" />
        <Bi label="Address" value={visit.address} rows={2} onChange={v => setC({ visit: { ...visit, address: v } })} />
        <Label>Hours, one line each</Label>
        <Rows items={visit.hours ?? []} add="Add a line" blank={() => ({})} onChange={v => setC({ visit: { ...visit, hours: v } })}
          render={(h, set) => <Bi label="" value={h} onChange={set} />} />
        <ImagePick businessId={businessId} label="Photo of the building" name="visit" url={visit.photo_url} wide onChange={u => setC({ visit: { ...visit, photo_url: u ?? undefined } })} />
        <div className="grid sm:grid-cols-2 gap-2">
          {(['google', 'facebook', 'instagram', 'youtube', 'justdial'] as const).map(k => (
            <Text key={k} label={k[0].toUpperCase() + k.slice(1) + ' link'} value={social[k]} placeholder="https://…"
              onChange={v => setC({ social: { ...social, [k]: v || undefined } })} />
          ))}
        </div>
      </Section>

      <div className="flex items-center gap-3 flex-wrap sticky bottom-0 bg-white py-2">
        <button onClick={save} disabled={busy || !dirty} className="btn-teal text-sm px-5 py-2 disabled:opacity-50">{busy ? 'Saving…' : 'Save website'}</button>
        {dirty && !busy && <button onClick={() => { setS(site); setMsg(null) }} className="text-sm text-gray-500">Undo changes</button>}
        {msg && <p className={`text-sm ${msg.ok ? 'text-teal-700' : 'text-red-600'}`}>{msg.text}</p>}
      </div>
    </div>
  )
}

// ── Articles ────────────────────────────────────────────────────────────────

function Articles({ businessId, articles, onChanged, siteUrl: base }: { businessId: string; articles: ArticleRow[]; onChanged: () => void; siteUrl: string }) {
  const [editing, setEditing] = useState<ArticleRow | null>(null)
  if (editing) return <ArticleEditor businessId={businessId} article={editing} siteUrl={base} onDone={() => { setEditing(null); onChanged() }} />
  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-navy-700">Articles</h3>
          <p className="text-sm text-gray-500">Health articles written by your doctors. They help patients find you on Google.</p>
        </div>
        <button onClick={() => setEditing({ slug: '', lang: 'en', title: '', summary: '', body: '', image_url: null, author: null, read_minutes: null, published_on: today(), is_published: true })}
          className="btn-teal text-sm px-4 py-2"><Plus className="w-4 h-4" /> New article</button>
      </div>
      {articles.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No articles yet.</p> : (
        <ul className="divide-y divide-gray-100">
          {articles.map(a => (
            <li key={a.id} className="py-2.5 flex items-center gap-3">
              {a.image_url ? <img src={a.image_url} alt="" className="w-14 h-10 object-cover rounded border" /> : <div className="w-14 h-10 rounded bg-gray-100" />}
              <button onClick={() => setEditing(a)} className="flex-1 min-w-0 text-left">
                <span className="block font-medium text-gray-800 truncate">{a.title}</span>
                <span className="block text-xs text-gray-500">
                  {a.published_on ?? 'No date'}{a.lang === 'hi' ? ' · हिंदी' : ''}{!a.is_published && <b className="text-amber-700"> · Hidden</b>}
                </span>
              </button>
              <button onClick={() => setEditing(a)} className="text-sm text-teal-700 font-semibold">Edit</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ArticleEditor({ businessId, article, siteUrl: base, onDone }: { businessId: string; article: ArticleRow; siteUrl: string; onDone: () => void }) {
  const [a, setA] = useState<ArticleRow>(article)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = !article.id

  const save = async () => {
    const slug = a.slug || slugify(a.title, 120)
    if (!a.title.trim()) { setErr('Give the article a title.'); return }
    if (slug.length < 2) { setErr('Write the web address in English letters (under the title).'); return }
    setBusy(true); setErr('')
    const words = a.body.trim().split(/\s+/).filter(Boolean).length
    const row = {
      business_id: businessId, slug, lang: a.lang, title: a.title.trim(), summary: a.summary?.trim() || null, body: a.body,
      image_url: a.image_url, author: a.author?.trim() || null, read_minutes: Math.min(120, Math.max(1, Math.round(words / 200))),
      published_on: a.published_on || null, is_published: a.is_published, updated_at: new Date().toISOString(),
    }
    const { error } = isNew
      ? await supabase.from('site_articles').insert(row)
      : await supabase.from('site_articles').update(row).eq('id', article.id!)
    setBusy(false)
    if (error) setErr(error.code === '23505' ? 'Another article has that web address. Change it.' : error.message); else onDone()
  }

  const remove = async () => {
    if (!article.id) return onDone()
    setBusy(true)
    const { error } = await supabase.from('site_articles').delete().eq('id', article.id)
    setBusy(false)
    if (error) setErr(error.message); else onDone()
  }
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-navy-700">{isNew ? 'New article' : 'Edit article'}</h3>
        {!isNew && <a href={`${base}/post/${article.slug}`} target="_blank" rel="noreferrer" className="text-sm text-teal-700 inline-flex items-center gap-1">View on the website <ExternalLink className="w-3.5 h-3.5" /></a>}
      </div>
      <Text label="Title" value={a.title} onChange={v => setA({ ...a, title: v, slug: isNew && (!a.slug || a.slug === slugify(a.title, 120)) ? slugify(v, 120) : a.slug })} />
      <div className="grid sm:grid-cols-3 gap-2">
        <Text label="Web address" value={a.slug} onChange={v => setA({ ...a, slug: slugify(v, 120) })} placeholder="what-is-glaucoma" />
        <label className="block"><Label>Language</Label>
          <select className="input-field" value={a.lang} onChange={e => setA({ ...a, lang: e.target.value as 'en' | 'hi' })}>
            <option value="en">English</option><option value="hi">हिंदी</option>
          </select></label>
        <label className="block"><Label>Date</Label>
          <input type="date" className="input-field" value={a.published_on ?? ''} onChange={e => setA({ ...a, published_on: e.target.value || null })} /></label>
      </div>
      <Text label="Written by" value={a.author ?? ''} onChange={v => setA({ ...a, author: v })} placeholder="Dr. …" />
      <label className="block"><Label>Summary (shown in the list and on Google)</Label>
        <textarea className="input-field" rows={2} value={a.summary ?? ''} onChange={e => setA({ ...a, summary: e.target.value })} /></label>
      <ImagePick businessId={businessId} label="Picture" name="article" url={a.image_url} wide onChange={u => setA({ ...a, image_url: u })} />
      <div>
        <div className="flex items-center justify-between">
          <Label>Article</Label>
          <button type="button" onClick={() => setPreview(p => !p)} className="text-xs text-teal-700 font-semibold">{preview ? 'Write' : 'Preview'}</button>
        </div>
        {preview
          ? <div className="border rounded-lg p-4 bg-[#f7f5f0] text-sm"><Markdown text={a.body} /></div>
          : <textarea className="input-field font-mono" rows={16} value={a.body} onChange={e => setA({ ...a, body: e.target.value })} />}
        <p className="text-xs text-gray-500 mt-1">
          Leave a blank line between paragraphs. <code>## </code> starts a heading, <code>- </code> a list item,
          <code> **words**</code> makes them bold, <code>[text](https://…)</code> makes a link.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={a.is_published} onChange={e => setA({ ...a, is_published: e.target.checked })} /> Show on the website
      </label>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={busy} className="btn-teal text-sm px-5 py-2">{busy ? 'Saving…' : 'Save article'}</button>
        <button onClick={onDone} disabled={busy} className="text-sm text-gray-500">Cancel</button>
        {!isNew && (confirmDelete
          ? <span className="text-sm">Delete for good? <button onClick={remove} className="text-red-600 font-semibold ml-1">Yes, delete</button> <button onClick={() => setConfirmDelete(false)} className="text-gray-500 ml-2">No</button></span>
          : <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-600 ml-auto">Delete</button>)}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}
