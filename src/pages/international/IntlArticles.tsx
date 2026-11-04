import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clock, Compass, Stethoscope, HeartPulse, ArrowRight, BadgeCheck } from 'lucide-react'
import IntlLayout, { C, Wrap, Card, CtaButton, HelpAside, useTitle } from './IntlLayout'
import { BottomCta } from './IntlStatic'
import Markdown from '../../site/Markdown'
import { loadArticles, loadArticle, type ArticleCard, type Article } from '../../lib/intlApi'

// 0315: articles for patients from abroad — planning guides, treatments and
// health. A banner carousel of featured ones, and columns of cards. What is
// shown first rotates every day, so a returning visitor meets something new.

export const CATS: Record<ArticleCard['category'], { name: string; icon: typeof Compass; from: string; to: string; soft: string }> = {
  planning: { name: 'Planning your trip', icon: Compass, from: '#0E9F6E', to: '#0b6e8a', soft: '#E7F4EC' },
  treatment: { name: 'Treatments', icon: Stethoscope, from: '#1E66B0', to: '#5b3fb0', soft: '#E9EFFA' },
  health: { name: 'Health', icon: HeartPulse, from: '#C2410C', to: '#b0306a', soft: '#FBEDE6' },
}

/** Today's order: the list turned by the day of the year. */
export function rotate<T>(list: T[]): T[] {
  if (list.length < 2) return list
  const day = Math.floor(Date.now() / 86_400_000)
  const k = day % list.length
  return [...list.slice(k), ...list.slice(0, k)]
}

const minutes = (n: number) => `${Math.max(1, n)} min read`

function Art({ a, className = '' }: { a: Pick<ArticleCard, 'category' | 'image_url'>; className?: string }) {
  const c = CATS[a.category]
  // Keep faces in view when a wide banner crops the picture.
  if (a.image_url) return <img src={a.image_url} alt="" className={`object-cover ${className}`} style={{ objectPosition: 'center 30%' }} />
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }} aria-hidden>
      <c.icon className="absolute -right-6 -bottom-6 w-40 h-40 opacity-20 text-white" strokeWidth={1.2} />
      <c.icon className="absolute left-5 top-5 w-9 h-9 text-white/90" />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 20% 120%, rgba(255,255,255,.25), transparent 55%)' }} />
    </div>
  )
}

/** The banner carousel — featured articles first, in today's order. */
export function ArticleBanner({ articles, title = 'Guides for your journey' }: { articles: ArticleCard[]; title?: string }) {
  const slides = useMemo(() => {
    const f = articles.filter(a => a.featured)
    return rotate(f.length >= 2 ? f : articles).slice(0, 6)
  }, [articles])
  const [i, setI] = useState(0)
  const paused = useRef(false)
  useEffect(() => {
    if (slides.length < 2) return
    const t = setInterval(() => { if (!paused.current) setI(x => (x + 1) % slides.length) }, 6000)
    return () => clearInterval(t)
  }, [slides.length])
  if (!slides.length) return null
  const a = slides[i % slides.length]
  const c = CATS[a.category]
  const go = (d: number) => setI(x => (x + d + slides.length) % slides.length)
  return (
    <section aria-roledescription="carousel" aria-label={title}
      onMouseEnter={() => { paused.current = true }} onMouseLeave={() => { paused.current = false }}>
      <div className="relative rounded-3xl overflow-hidden shadow-sm" style={{ border: `1px solid ${C.border}` }}>
        <div className="grid md:grid-cols-[1.1fr_1fr] min-h-[300px]">
          <Link to={`/international/articles/${a.slug}`} className="relative block min-h-[170px] md:min-h-full">
            <Art a={a} className="absolute inset-0 w-full h-full" />
            <span className="absolute left-5 bottom-5 rounded-full bg-white/95 px-3 py-1 text-sm font-semibold" style={{ color: c.from }}>{c.name}</span>
          </Link>
          <div className="bg-white p-6 sm:p-8 flex flex-col">
            <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: C.green }}>{title}</p>
            <Link to={`/international/articles/${a.slug}`} className="mt-2 text-2xl sm:text-3xl font-bold leading-tight hover:underline">{a.title}</Link>
            <p className="mt-3 text-lg leading-relaxed" style={{ color: C.muted }}>{a.summary}</p>
            <div className="mt-auto pt-5 flex items-center gap-4 flex-wrap">
              <Link to={`/international/articles/${a.slug}`} className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-semibold text-white" style={{ background: C.green }}>
                Read article <ArrowRight className="w-4 h-4" /></Link>
              <span className="text-sm inline-flex items-center gap-1" style={{ color: C.muted }}><Clock className="w-4 h-4" /> {minutes(a.read_minutes)}</span>
              {slides.length > 1 && (
                <span className="ml-auto flex gap-2">
                  <button onClick={() => go(-1)} aria-label="Previous article" className="w-10 h-10 rounded-full flex items-center justify-center" style={{ border: `1px solid ${C.border}` }}><ChevronLeft className="w-5 h-5" /></button>
                  <button onClick={() => go(1)} aria-label="Next article" className="w-10 h-10 rounded-full flex items-center justify-center" style={{ border: `1px solid ${C.border}` }}><ChevronRight className="w-5 h-5" /></button>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {slides.length > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {slides.map((s, n) => (
            <button key={s.slug} onClick={() => setI(n)} aria-label={`Article ${n + 1}: ${s.title}`}
              className="h-2.5 rounded-full transition-all" style={{ width: n === i ? 28 : 10, background: n === i ? C.green : '#d6cfc0' }} />
          ))}
        </div>
      )}
    </section>
  )
}

export function ArticleTile({ a }: { a: ArticleCard }) {
  const c = CATS[a.category]
  return (
    <Link to={`/international/articles/${a.slug}`} className="group flex flex-col rounded-2xl bg-white overflow-hidden hover:shadow-md transition" style={{ border: `1px solid ${C.border}` }}>
      <Art a={a} className="h-36 w-full" />
      <div className="p-5 flex flex-col flex-1">
        <span className="self-start rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: c.soft, color: c.from }}>{c.name}</span>
        <p className="mt-2 font-bold text-lg leading-snug group-hover:underline">{a.title}</p>
        <p className="mt-2 text-[15px] leading-relaxed flex-1" style={{ color: C.muted }}>{a.summary}</p>
        <p className="mt-3 text-sm inline-flex items-center gap-1" style={{ color: C.muted }}><Clock className="w-4 h-4" /> {minutes(a.read_minutes)}</p>
      </div>
    </Link>
  )
}

/** For the International home: the banner and three cards, in today's order. */
export function HomeArticles() {
  const [list, setList] = useState<ArticleCard[]>([])
  useEffect(() => { loadArticles().then(setList, () => setList([])) }, [])
  if (!list.length) return null
  const bannerSlugs = new Set(rotate(list.filter(a => a.featured)).slice(0, 6).map(a => a.slug))
  const cards = rotate(list.filter(a => !bannerSlugs.has(a.slug))).slice(0, 3)
  return (
    <Wrap className="py-14">
      <div className="flex items-end justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold">Read before you travel</h2>
          <p style={{ color: C.muted }}>Health guides and practical advice for patients coming to India.</p>
        </div>
        <Link to="/international/articles" className="font-semibold inline-flex items-center gap-1" style={{ color: C.green }}>All articles <ArrowRight className="w-4 h-4" /></Link>
      </div>
      <ArticleBanner articles={list} />
      {cards.length > 0 && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 mt-8">{cards.map(a => <ArticleTile key={a.slug} a={a} />)}</div>}
    </Wrap>
  )
}

export function IntlArticles() {
  useTitle('Articles')
  const [list, setList] = useState<ArticleCard[] | null>(null)
  const [err, setErr] = useState('')
  const [cat, setCat] = useState<'' | ArticleCard['category']>('')
  useEffect(() => { loadArticles().then(setList, e => setErr(e.message)) }, [])
  const shown = rotate((list ?? []).filter(a => !cat || a.category === cat))
  return (
    <IntlLayout>
      <div style={{ background: C.sand }}>
        <Wrap className="py-10">
          <p className="text-sm font-semibold uppercase tracking-wide mb-2" style={{ color: C.green }}>Articles</p>
          <h1 className="text-3xl sm:text-4xl font-bold">Health guides for your journey</h1>
          <p className="mt-3 text-lg max-w-2xl" style={{ color: C.muted }}>Clear, practical reading on treatments, health and planning your trip. General information — your own doctor’s advice comes first.</p>
          {list && list.length > 0 && <div className="mt-8"><ArticleBanner articles={list} title="Featured" /></div>}
        </Wrap>
      </div>
      <Wrap className="py-10">
        {err && <p className="text-red-700">{err}</p>}
        {!list && !err && <p style={{ color: C.muted }}>Loading…</p>}
        {list && (
          <>
            <div className="flex flex-wrap gap-2 mb-6">
              {([['', 'All'], ...Object.entries(CATS).map(([k, v]) => [k, v.name])] as [string, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setCat(k as typeof cat)} className="rounded-full px-4 py-2 text-sm font-semibold"
                  style={cat === k ? { background: C.green, color: '#fff' } : { background: '#fff', border: `1px solid ${C.border}` }}>{l}</button>
              ))}
            </div>
            {shown.length === 0 && <p style={{ color: C.muted }}>New articles are on the way.</p>}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{shown.map(a => <ArticleTile key={a.slug} a={a} />)}</div>
          </>
        )}
      </Wrap>
      <BottomCta />
    </IntlLayout>
  )
}

export function IntlArticle() {
  const { slug = '' } = useParams()
  const [a, setA] = useState<Article | null | undefined>(undefined)
  const [more, setMore] = useState<ArticleCard[]>([])
  useTitle(a?.title ?? 'Article')
  useEffect(() => {
    setA(undefined)
    loadArticle(slug).then(setA, () => setA(null))
    loadArticles().then(l => setMore(l), () => {})
  }, [slug])
  if (a === undefined) return <IntlLayout><Wrap className="py-16"><p style={{ color: C.muted }}>Loading…</p></Wrap></IntlLayout>
  if (a === null) return <IntlLayout><Wrap className="py-16"><p>This article is not available. <Link to="/international/articles" className="underline">See all articles</Link></p></Wrap></IntlLayout>
  const c = CATS[a.category]
  const related = rotate(more.filter(x => x.slug !== a.slug)).sort((x, y) => Number(y.category === a.category) - Number(x.category === a.category)).slice(0, 3)
  return (
    <IntlLayout>
      <div className="relative">
        <Art a={a} className="h-56 sm:h-80 lg:h-[440px] w-full" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.45))' }} />
        <div className="absolute inset-x-0 bottom-0 pb-6 text-white">
          <Wrap narrow>
          <span className="rounded-full bg-white/95 px-3 py-1 text-sm font-semibold" style={{ color: c.from }}>{c.name}</span>
          <h1 className="mt-3 text-3xl sm:text-4xl font-bold leading-tight drop-shadow">{a.title}</h1>
          </Wrap>
        </div>
      </div>
      <Wrap className="py-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 max-w-3xl">
        <p className="text-xl leading-relaxed" style={{ color: C.muted }}>{a.summary}</p>
        <p className="mt-3 text-sm flex flex-wrap gap-x-4 gap-y-1" style={{ color: C.muted }}>
          <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4" /> {minutes(a.read_minutes)}</span>
          {a.reviewed_by
            ? <span className="inline-flex items-center gap-1"><BadgeCheck className="w-4 h-4" style={{ color: C.green }} /> Medically reviewed by {a.reviewed_by}{a.reviewed_at ? `, ${new Date(a.reviewed_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''}</span>
            : <span>Prepared by the Sehatsandhi team · General information, not medical advice</span>}
          <span>Updated {new Date(a.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </p>
        <article className="intl-prose mt-8" style={{ ['--site-brand' as string]: C.green }}>
          <Markdown text={a.body} />
        </article>
        <style>{`.intl-prose .site-prose{font-size:18px;line-height:1.75;color:${C.ink}}.intl-prose h2{font-size:24px;font-weight:800;margin:32px 0 10px}.intl-prose h3{font-size:20px;font-weight:700;margin:24px 0 8px}.intl-prose p{margin:0 0 16px}.intl-prose ul{list-style:disc;padding-left:22px;margin:0 0 16px}.intl-prose ol{list-style:decimal;padding-left:22px;margin:0 0 16px}.intl-prose li{margin:4px 0}`}</style>
        <Card className="mt-8">
          <p className="text-sm leading-relaxed" style={{ color: C.muted }}>This article is general information, not medical advice. Your own doctor and your treating doctor in India decide what is right for you.</p>
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            {a.procedure_code ? <CtaButton to={`/international/compare?t=${a.procedure_code}`}>Compare hospitals for this</CtaButton> : <CtaButton to="/international/compare">Compare hospitals</CtaButton>}
            <CtaButton to="/international/quote" light>Ask us a question</CtaButton>
          </div>
        </Card>
        </div>
        <HelpAside>
          {a.procedure_code && (
            <div className="rounded-2xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
              <p className="font-semibold">About this treatment</p>
              <p className="text-[15px] mt-1" style={{ color: C.muted }}>Costs, stay, preparation, life after and the machines used.</p>
              <div className="mt-3 flex flex-col gap-2">
                <Link to={`/international/treatments/${a.procedure_code}`} className="font-semibold" style={{ color: C.green }}>Read the treatment guide →</Link>
                <Link to={`/international/compare?t=${a.procedure_code}`} className="font-semibold" style={{ color: C.green }}>Compare hospitals →</Link>
              </div>
            </div>
          )}
          {more.length > 1 && (
            <div className="rounded-2xl bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
              <p className="font-semibold mb-3">More to read</p>
              <ul className="flex flex-col gap-3">
                {rotate(more.filter(x => x.slug !== a.slug)).slice(0, 4).map(x => (
                  <li key={x.slug}>
                    <Link to={`/international/articles/${x.slug}`} className="flex gap-3 items-center group">
                      <Art a={x} className="w-20 h-14 rounded-lg shrink-0" />
                      <span className="text-[15px] font-medium leading-snug group-hover:underline">{x.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </HelpAside>
      </Wrap>
      {related.length > 0 && (
        <Wrap className="pb-6">
          <h2 className="text-2xl font-bold mb-5">Keep reading</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{related.map(x => <ArticleTile key={x.slug} a={x} />)}</div>
        </Wrap>
      )}
    </IntlLayout>
  )
}
