// Writes the legal pages to static HTML after the client build.
//
// Run last in `npm run build`: `vite build` produces dist/index.html with the
// hashed asset links, `vite build --ssr` produces dist-ssr/prerender.js, and
// this stitches the two together — the rendered body goes inside the shell's
// empty #root, so the page still boots into the normal SPA when JavaScript is
// available and still reads as a full document when it is not.
//
// Vercel checks the filesystem before applying the rewrites in vercel.json, so
// dist/privacy/index.html is served for /privacy and the SPA catch-all never
// sees that path.
//
// Every failure here is thrown, not warned. A silent miss would publish the
// same empty shell we are trying to get rid of, and it would look like it had
// worked.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const ssrDir = join(root, 'dist-ssr')

/**
 * Vite names the SSR bundle after its entry, but the extension follows the
 * package type and has moved between versions — so find it rather than assume
 * it, and say what was actually there if it is missing.
 */
async function findSsrEntry() {
  let files
  try {
    files = await readdir(ssrDir)
  } catch {
    throw new Error(`prerender: ${ssrDir} does not exist — did "vite build --ssr" run?`)
  }
  const hit = files.find(f => /^prerender\.(js|mjs|cjs)$/.test(f))
  if (!hit) throw new Error(`prerender: no prerender.{js,mjs,cjs} in ${ssrDir} — found: ${files.join(', ') || '(empty)'}`)
  return join(ssrDir, hit)
}

const ROOT_DIV = '<div id="root"></div>'

// The long-form URLs App.tsx redirects from. Those redirects are React Router
// components, so without JavaScript they land on the same blank shell — which
// defeats the point of having the aliases at all, since they exist for a
// reviewer who types the long form. A meta refresh works either way.
const ALIASES = {
  '/contact-us': '/contact',
  '/privacy-policy': '/privacy',
  '/terms-and-conditions': '/terms',
  '/terms-of-service': '/terms',
  '/refund-policy': '/refund',
  '/cancellation-policy': '/refund',
}

const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Swap a single-attribute meta/title in the shell, insisting it was there.
 *
 * The replacement goes in through a function, not a string: rendered markup and
 * policy prose can both contain `$`, and String.replace reads `$&` and `$'` in
 * a string replacement as backreferences. A function replacement is taken
 * literally.
 */
function replaceOnce(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`prerender: ${label} not found in dist/index.html`)
  return html.replace(pattern, () => replacement)
}

const ssrEntry = await findSsrEntry()
const { PAGES, render } = await import(pathToFileURL(ssrEntry).href).catch(err => {
  throw new Error(`prerender: could not load ${ssrEntry}\n${err.message}`)
})

const template = await readFile(join(dist, 'index.html'), 'utf8')
if (!template.includes(ROOT_DIV)) {
  throw new Error(`prerender: "${ROOT_DIV}" not found in dist/index.html — the shell changed shape`)
}

for (const page of PAGES) {
  const body = render(page.path)
  if (typeof body !== 'string' || body.length < 200) {
    throw new Error(`prerender: ${page.path} rendered ${(body || '').length} chars — expected a full page`)
  }

  let html = template.replace(ROOT_DIV, () => `<div id="root">${body}</div>`)
  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeText(page.title)}</title>`, '<title>')
  html = replaceOnce(
    html,
    /<meta name="description" content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeAttr(page.description)}" />`,
    'description meta',
  )
  html = replaceOnce(
    html,
    /<meta property="og:title" content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escapeAttr(page.title)}" />`,
    'og:title meta',
  )
  html = replaceOnce(
    html,
    /<meta property="og:description" content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${escapeAttr(page.description)}" />`,
    'og:description meta',
  )

  const dir = join(dist, page.path)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'index.html'), html)
  console.log(`prerendered ${page.path}  (${(html.length / 1024).toFixed(1)} kB)`)
}

for (const [from, to] of Object.entries(ALIASES)) {
  const stub = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=${to}" />
    <link rel="canonical" href="${to}" />
    <meta name="robots" content="noindex" />
    <title>Redirecting to ${escapeText(to)}</title>
  </head>
  <body>
    <p>This page has moved to <a href="${to}">${escapeText(to)}</a>.</p>
  </body>
</html>
`
  const dir = join(dist, from)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'index.html'), stub)
  console.log(`prerendered ${from} → ${to}`)
}

console.log(`prerender: wrote ${PAGES.length} pages and ${Object.keys(ALIASES).length} redirects`)
