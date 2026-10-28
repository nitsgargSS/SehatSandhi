import { Fragment, type ReactNode } from 'react'

// The little Markdown a site article uses: ## headings, paragraphs, - lists,
// [links](url) and **bold**. Text only — never HTML from the article — so an
// article cannot inject anything into the page.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(m[1]
      ? <a key={`${key}-${i++}`} href={m[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--site-brand)', fontWeight: 600 }}>{m[1]}</a>
      : <strong key={`${key}-${i++}`}>{m[3]}</strong>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  return (
    <div className="site-prose">
      {blocks.map((b, i) => {
        if (b.startsWith('### ')) return <h3 key={i}>{inline(b.slice(4), `h${i}`)}</h3>
        if (b.startsWith('## ')) return <h2 key={i}>{inline(b.slice(3), `h${i}`)}</h2>
        const lines = b.split('\n')
        if (lines.every(l => l.startsWith('- '))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2), `l${i}-${j}`)}</li>)}</ul>
        }
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `p${i}-${j}`)}</Fragment>)}</p>
      })}
    </div>
  )
}
