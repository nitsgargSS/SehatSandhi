import { useEffect, useState } from 'react'
import { Download, Share2, Copy, RefreshCw, EyeOff, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { activeConfig } from '../../lib/env'
import { isoDate, shortDate } from '../../lib/format'

// The business's daily social media post (0292, stage 1 of the build plan).
// The social-posts function makes tomorrow's post every afternoon; here the
// owner sees it, copies the caption and downloads or shares the image. Posting
// to Facebook and Instagram by itself comes in stage 3, once Meta approves.
// The owner's alone, like Website: RLS lets only the owner skip a post or
// change the settings.

interface Post {
  id: string; post_date: string; topic: string; template: string; badge: string | null
  caption: string | null; hashtags: string[]; image_url: string | null; story_url: string | null
  status: 'planned' | 'ready' | 'failed' | 'skipped'; error: string | null; written_by: 'claude' | 'fallback' | null
}
interface Settings { paused: boolean; languages: 'en' | 'hi' | 'both' }

const tomorrow = () => isoDate(new Date(Date.now() + 864e5))

async function makePost(businessId: string, date: string): Promise<void> {
  const { url, anon } = activeConfig()
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${url}/functions/v1/social-posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? anon}`, apikey: anon },
    body: JSON.stringify({ action: 'make', businessId, date }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `failed: ${res.status}`)
  if (body?.status === 'failed') throw new Error(body.error || 'The post could not be made.')
}

async function imageFile(url: string, name: string): Promise<File> {
  const blob = await (await fetch(url)).blob()
  return new File([blob], name, { type: 'image/png' })
}

export default function SocialPostsPanel({ businessId }: { businessId: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = async () => {
    const [{ data: p, error: e1 }, { data: s, error: e2 }] = await Promise.all([
      supabase.from('social_posts')
        .select('id, post_date, topic, template, badge, caption, hashtags, image_url, story_url, status, error, written_by')
        .eq('business_id', businessId).order('post_date', { ascending: false }).limit(30),
      supabase.from('social_settings').select('paused, languages').eq('business_id', businessId).maybeSingle(),
    ])
    if (e1 || e2) setErr((e1 ?? e2)!.message)
    setPosts((p as Post[]) ?? [])
    setSettings((s as Settings) ?? null)
  }
  useEffect(() => { load() }, [businessId])

  const saveSettings = async (patch: Partial<Settings>) => {
    setErr('')
    const { error } = await supabase.from('social_settings')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('business_id', businessId)
    if (error) { setErr(error.message); return }
    setSettings(s => s && { ...s, ...patch })
  }

  const remake = async (date: string) => {
    setBusy(date); setErr('')
    try { await makePost(businessId, date) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy(null); load()
  }

  const skip = async (p: Post) => {
    const { error } = await supabase.from('social_posts')
      .update({ status: p.status === 'skipped' ? 'ready' : 'skipped', updated_at: new Date().toISOString() }).eq('id', p.id)
    if (error) setErr(error.message); else load()
  }

  if (posts === null) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
  const haveTomorrow = posts.some(p => p.post_date === tomorrow())

  return (
    <div className="space-y-4">
      <div className="card shadow-sm space-y-3">
        <div>
          <h3 className="font-bold text-navy-700">Social posts</h3>
          <p className="text-sm text-gray-500">
            A post for Facebook and Instagram is made for you every afternoon for the next day — your logo, colours
            and photos, with words checked against medical advertising rules. For now, download it or share it from
            here; posting by itself to your pages comes soon.
          </p>
        </div>
        {settings && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!settings.paused} onChange={e => saveSettings({ paused: !e.target.checked })} />
              Make a post every day
            </label>
            <label className="flex items-center gap-2">
              Language
              <select className="input-field py-1 w-auto" value={settings.languages}
                onChange={e => saveSettings({ languages: e.target.value as Settings['languages'] })}>
                <option value="both">English and Hindi</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </label>
            {!haveTomorrow && (
              <button onClick={() => remake(tomorrow())} disabled={!!busy} className="btn-teal text-sm px-4 py-1.5">
                {busy === tomorrow() ? 'Making… (about a minute)' : "Make tomorrow's post now"}
              </button>
            )}
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>

      {posts.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-6">No posts yet. The first one is made this afternoon.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {posts.map(p => <PostCard key={p.id} p={p} busy={busy === p.post_date} canChange={p.post_date >= isoDate()}
          onRemake={() => remake(p.post_date)} onSkip={() => skip(p)} />)}
      </div>
    </div>
  )
}

function PostCard({ p, busy, canChange, onRemake, onSkip }: {
  p: Post; busy: boolean; canChange: boolean; onRemake: () => void; onSkip: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [shareErr, setShareErr] = useState('')
  const day = p.post_date === isoDate() ? 'Today' : p.post_date === tomorrow() ? 'Tomorrow' : shortDate(p.post_date)
  const text = [p.caption, p.hashtags.join(' ')].filter(Boolean).join('\n\n')

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  const download = async (url: string, size: string) => {
    const f = await imageFile(url, `post-${p.post_date}-${size}.png`)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(f); a.download = f.name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  // On a phone this opens the share sheet straight into Instagram, Facebook or WhatsApp.
  const share = async () => {
    setShareErr('')
    try {
      const f = await imageFile(p.image_url!, `post-${p.post_date}.png`)
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text })
      else setShareErr('Sharing works from a phone. On a computer, download the image and copy the caption.')
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setShareErr('Could not share. Download it instead.')
    }
  }

  return (
    <div className={`card shadow-sm space-y-3 ${p.status === 'skipped' ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-teal-700">{day}</p>
          <p className="font-semibold text-navy-700 truncate">{p.topic}</p>
        </div>
        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
          p.status === 'ready' ? 'bg-green-50 text-green-800 border-green-200'
          : p.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200'
          : p.status === 'skipped' ? 'bg-gray-50 text-gray-600 border-gray-200'
          : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
          {p.status === 'ready' ? 'Ready' : p.status === 'failed' ? 'Not made' : p.status === 'skipped' ? 'Skipped' : 'Being made'}
        </span>
      </div>

      {p.image_url && p.status !== 'failed' && (
        <img src={p.image_url} alt={p.topic} className="w-full aspect-square object-cover rounded-lg border border-gray-100" loading="lazy" />
      )}
      {p.status === 'failed' && <p className="text-sm text-red-600">{p.error ?? 'Something went wrong.'}</p>}
      {p.written_by === 'fallback' && (
        <p className="text-xs text-gray-500">The usual words did not pass the medical advertising check, so a simple post was used.</p>
      )}

      {p.caption && p.status !== 'failed' && (
        <div className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 rounded-lg p-3 max-h-40 overflow-auto">{text}</div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {p.image_url && p.status !== 'failed' && <>
          <button onClick={share} className="btn-teal px-3 py-1.5 inline-flex items-center gap-1"><Share2 className="w-4 h-4" /> Share</button>
          <button onClick={copy} className="btn-outline px-3 py-1.5 inline-flex items-center gap-1">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy caption'}
          </button>
          <button onClick={() => download(p.image_url!, 'square')} className="btn-outline px-3 py-1.5 inline-flex items-center gap-1"><Download className="w-4 h-4" /> Post</button>
          {p.story_url && <button onClick={() => download(p.story_url!, 'story')} className="btn-outline px-3 py-1.5 inline-flex items-center gap-1"><Download className="w-4 h-4" /> Story</button>}
        </>}
        {canChange && <>
          <button onClick={onRemake} disabled={busy} className="btn-outline px-3 py-1.5 inline-flex items-center gap-1">
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Making…' : 'Make again'}
          </button>
          {p.status !== 'failed' && p.status !== 'planned' && (
            <button onClick={onSkip} className="btn-outline px-3 py-1.5 inline-flex items-center gap-1">
              <EyeOff className="w-4 h-4" /> {p.status === 'skipped' ? 'Use it' : 'Skip'}
            </button>
          )}
        </>}
      </div>
      {shareErr && <p className="text-xs text-gray-500">{shareErr}</p>}
    </div>
  )
}
