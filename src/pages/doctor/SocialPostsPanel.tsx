import { useEffect, useState } from 'react'
import { Download, Share2, Copy, RefreshCw, EyeOff, Check, Send, ThumbsUp, Facebook } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { activeConfig } from '../../lib/env'
import { isoDate, shortDate } from '../../lib/format'
import { facebookLogin, loadFacebookSdk, SOCIAL_CONFIG_ID } from '../../lib/facebookLogin'

// The business's daily social media post (0292, 0295).
// The social-posts function makes tomorrow's post every afternoon; at 7 PM the
// owner gets a preview on WhatsApp (OK / Change / Skip), and at 10 AM it goes
// to their Facebook Page and Instagram once they have connected them here.
// Without a connected Page, they download or share it by hand.
// The owner's alone, like Website: RLS lets only the owner skip a post or
// change the settings.

interface Post {
  id: string; post_date: string; topic: string; template: string; badge: string | null
  caption: string | null; hashtags: string[]; image_url: string | null; story_url: string | null
  status: 'planned' | 'ready' | 'failed' | 'skipped' | 'published'; error: string | null; written_by: 'claude' | 'fallback' | null
  approval: 'ok' | 'change' | null; preview_sent_at: string | null; preview_error: string | null
  fb_post_id: string | null; ig_media_id: string | null; publish_error: string | null
}
interface Settings { paused: boolean; languages: 'en' | 'hi' | 'both'; approval: 'preview' | 'ask' | 'auto'; preview_phone: string | null }
interface Account { page_id: string; page_name: string; ig_username: string | null; last_error?: string | null }

const tomorrow = () => isoDate(new Date(Date.now() + 864e5))

async function call(fn: string, payload: Record<string, unknown>) {
  const { url, anon } = activeConfig()
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? anon}`, apikey: anon },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok && !body?.message) throw new Error(body?.error || `failed: ${res.status}`)
  return body
}

async function makePost(businessId: string, date: string): Promise<void> {
  const body = await call('social-posts', { action: 'make', businessId, date })
  if (body?.status === 'failed') throw new Error(body.error || 'The post could not be made.')
}

async function imageFile(url: string, name: string): Promise<File> {
  const blob = await (await fetch(url)).blob()
  return new File([blob], name, { type: 'image/png' })
}

export default function SocialPostsPanel({ businessId }: { businessId: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const load = async () => {
    const [{ data: p, error: e1 }, { data: s, error: e2 }, { data: a }] = await Promise.all([
      supabase.from('social_posts')
        .select('id, post_date, topic, template, badge, caption, hashtags, image_url, story_url, status, error, written_by, approval, preview_sent_at, preview_error, fb_post_id, ig_media_id, publish_error')
        .eq('business_id', businessId).order('post_date', { ascending: false }).limit(30),
      supabase.from('social_settings').select('paused, languages, approval, preview_phone').eq('business_id', businessId).maybeSingle(),
      supabase.from('social_accounts').select('page_id, page_name, ig_username, last_error').eq('business_id', businessId).maybeSingle(),
    ])
    if (e1 || e2) setErr((e1 ?? e2)!.message)
    setPosts((p as Post[]) ?? [])
    setSettings((s as Settings) ?? null)
    setAccount((a as Account) ?? null)
  }

  const answer = async (p: Post, a: 'ok' | 'post') => {
    setBusy(p.post_date); setErr(''); setNote('')
    try {
      const r = await call('social-posts', { action: 'decide', postId: p.id, answer: a })
      if (r?.ok === false) setErr(r.message); else setNote(r?.message ?? '')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy(null); load()
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
            and photos, with words checked against medical advertising rules. At 7 PM you get a preview on WhatsApp
            (OK, Change or Skip); it goes to your Page at 10 AM and to Instagram at 7:30 PM, Stories included.
          </p>
        </div>
        <ConnectFacebook businessId={businessId} account={account} onChange={load} />
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
            <label className="flex items-center gap-2">
              Before posting
              <select className="input-field py-1 w-auto" value={settings.approval}
                onChange={e => saveSettings({ approval: e.target.value as Settings['approval'] })}>
                <option value="preview">Preview; post if I don't answer (first 7 need OK)</option>
                <option value="ask">Ask me every time</option>
                <option value="auto">Just post</option>
              </select>
            </label>
            {settings.approval !== 'auto' && (
              <label className="flex items-center gap-2">
                Preview to
                <input className="input-field py-1 w-36" inputMode="numeric" placeholder="Your login phone"
                  defaultValue={settings.preview_phone ?? ''}
                  onBlur={e => { const v = e.target.value.replace(/\D/g, '').slice(-10); if (v !== (settings.preview_phone ?? '')) saveSettings({ preview_phone: v || null }) }} />
              </label>
            )}
            {!haveTomorrow && (
              <button onClick={() => remake(tomorrow())} disabled={!!busy} className="btn-teal text-sm px-4 py-1.5">
                {busy === tomorrow() ? 'Making… (about a minute)' : "Make tomorrow's post now"}
              </button>
            )}
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        {note && <p className="text-sm text-green-700">{note}</p>}
      </div>

      {posts.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-6">No posts yet. The first one is made this afternoon.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {posts.map(p => <PostCard key={p.id} p={p} busy={busy === p.post_date} canChange={p.post_date >= isoDate() && p.status !== 'published'}
          connected={!!account} onRemake={() => remake(p.post_date)} onSkip={() => skip(p)} onAnswer={a => answer(p, a)} />)}
      </div>
    </div>
  )
}

function ConnectFacebook({ businessId, account, onChange }: { businessId: string; account: Account | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pages, setPages] = useState<Account[] | null>(null)
  useEffect(() => { if (!account && SOCIAL_CONFIG_ID) loadFacebookSdk().catch(e => setErr(e.message)) }, [account])

  const run = async (payload: Record<string, unknown>) => {
    const r = await call('social-connect', { businessId, ...payload })
    if (r?.ok === false) throw new Error(r.message)
    if (r?.pages) setPages(r.pages); else { setPages(null); onChange() }
  }
  const go = async (f: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await f() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  if (account) return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-navy-700">
          <Facebook className="w-4 h-4 text-blue-600" /> Posting to <b>{account.page_name}</b>
          {account.ig_username ? <> and Instagram <b>@{account.ig_username}</b></> : <span className="text-gray-500">(no Instagram linked to this Page)</span>}
        </span>
        <button disabled={busy} onClick={() => go(() => run({ action: 'disconnect' }))} className="btn-outline text-xs px-3 py-1">Disconnect</button>
      </div>
      {account.last_error && <p className="text-xs text-red-600">Last problem: {account.last_error}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm space-y-2">
      {pages ? <>
        <p className="text-navy-700">Which Page should the posts go to?</p>
        <div className="flex flex-wrap gap-2">
          {pages.map(pg => (
            <button key={pg.page_id} disabled={busy} onClick={() => go(() => run({ action: 'pick', pageId: pg.page_id }))} className="btn-outline px-3 py-1.5">
              {pg.page_name}{pg.ig_username ? ` · @${pg.ig_username}` : ''}
            </button>
          ))}
        </div>
      </> : <>
        <p className="text-navy-700">Connect your Facebook Page once, and posts go out by themselves. Instagram comes along when it is linked to the Page.</p>
        <button disabled={busy || !SOCIAL_CONFIG_ID} onClick={() => go(async () => run({ action: 'connect', code: await facebookLogin() }))}
          className="btn-teal px-4 py-1.5 inline-flex items-center gap-2">
          <Facebook className="w-4 h-4" /> {busy ? 'Connecting…' : SOCIAL_CONFIG_ID ? 'Connect Facebook & Instagram' : 'Connecting Facebook comes soon'}
        </button>
      </>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}

function PostCard({ p, busy, canChange, connected, onRemake, onSkip, onAnswer }: {
  p: Post; busy: boolean; canChange: boolean; connected: boolean
  onRemake: () => void; onSkip: () => void; onAnswer: (a: 'ok' | 'post') => void
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
          p.status === 'ready' || p.status === 'published' ? 'bg-green-50 text-green-800 border-green-200'
          : p.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200'
          : p.status === 'skipped' ? 'bg-gray-50 text-gray-600 border-gray-200'
          : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
          {p.status === 'published' ? 'Posted' : p.status === 'ready' ? (p.approval === 'ok' ? 'OK, will post' : 'Ready')
            : p.status === 'failed' ? 'Not made' : p.status === 'skipped' ? 'Skipped' : 'Being made'}
        </span>
      </div>

      {p.image_url && p.status !== 'failed' && (
        <img src={p.image_url} alt={p.topic} className="w-full aspect-square object-cover rounded-lg border border-gray-100" loading="lazy" />
      )}
      {p.status === 'failed' && <p className="text-sm text-red-600">{p.error ?? 'Something went wrong.'}</p>}
      {p.status === 'published' && (
        <p className="text-xs text-gray-600">
          {p.fb_post_id && <a className="text-teal-700 underline" href={`https://www.facebook.com/${p.fb_post_id}`} target="_blank" rel="noreferrer">See it on Facebook</a>}
          {p.fb_post_id && p.ig_media_id && ' · '}{p.ig_media_id && 'On Instagram'}
        </p>
      )}
      {p.publish_error && p.status !== 'skipped' && <p className="text-xs text-red-600">{
        p.publish_error === 'Waiting for your OK' ? 'Not posted — waiting for your OK.'
        : p.status === 'published' ? `Partly posted: ${p.publish_error}` : `Not posted: ${p.publish_error}`}</p>}
      {p.preview_error && p.status === 'ready' && <p className="text-xs text-gray-500">The WhatsApp preview could not be sent: {p.preview_error}</p>}
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
        {canChange && connected && (p.status === 'ready' || p.status === 'skipped') && <>
          {p.approval !== 'ok' && p.post_date !== isoDate() && (
            <button onClick={() => onAnswer('ok')} disabled={busy} className="btn-teal px-3 py-1.5 inline-flex items-center gap-1"><ThumbsUp className="w-4 h-4" /> OK</button>
          )}
          {p.post_date === isoDate() && (
            <button onClick={() => onAnswer('post')} disabled={busy} className="btn-teal px-3 py-1.5 inline-flex items-center gap-1"><Send className="w-4 h-4" /> Post now</button>
          )}
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
