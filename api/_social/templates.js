// The designs a social post is drawn from (0292, 0293). Each template is an
// HTML page at the post's exact pixel size; render.js loads it in headless
// Chrome and takes the screenshot. Plain JS so the Vercel function and the
// local preview script (scripts/social-preview.mjs) import the same file.
//
// Picture first: every design is built around one picture — an AI picture for
// the topic, or the business's own photo — with the words laid over or beside
// it. The picture never carries text: AI models misspell, Hindi most of all,
// so every word, the logo and the call button are drawn here.
//
// What goes on the image is the business's own: logo, colour, photo, name,
// phone, website — and the words Claude wrote. Never anything about a patient
// (build plan, "ABDM and privacy rules"). One language per image; Poppins draws
// Latin and Devanagari, so Hindi conjuncts are correct.

import { ICONS } from './icons.js'

export const SIZES = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
}

export const TEMPLATES = ['photo', 'tips', 'question', 'fact', 'day', 'greeting']
export const MOTIFS = ['lights', 'colours', 'flag', 'stars']
export const ICON_NAMES = Object.keys(ICONS)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const HEX = /^#[0-9a-fA-F]{6}$/

function icon(name, size, color = 'currentColor', stroke = 2) {
  const nodes = ICONS[name] ?? ICONS.sparkles
  const inner = nodes.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('')
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}

// The headline with its key words marked, e.g. "Diabetes can harm your [eyes]".
function headline(d) {
  const h = esc(d.headline)
  const mark = d.highlight && String(d.highlight).trim()
  if (!mark) return h
  const m = esc(mark)
  const at = h.toLowerCase().indexOf(m.toLowerCase())
  if (at < 0) return h
  return `${h.slice(0, at)}<span class="hl">${h.slice(at, at + m.length)}</span>${h.slice(at + m.length)}`
}

/**
 * @param {string} template one of TEMPLATES
 * @param {'square'|'story'} size
 * @param {{
 *   brand?: string, accent?: string, logo?: string, photo?: string, clinic: string,
 *   phone?: string, website?: string, lang?: 'en'|'hi',
 *   badge?: string, icon?: string, headline: string, highlight?: string, body?: string,
 *   points?: {icon?: string, text: string}[], myth?: string, fact?: string,
 *   dateDay?: string, dateMonth?: string, motif?: string
 * }} d
 */
/**
 * `reel` (0299): the story design, moving. The picture zooms slowly and the
 * parts appear one after another; the renderer steps through it frame by
 * frame with window.__seek(seconds), so nothing depends on real time.
 */
export function postHtml(template, size, d, reel = null) {
  if (!TEMPLATES.includes(template)) throw new Error(`unknown template ${template}`)
  const px = SIZES[size]
  if (!px) throw new Error(`unknown size ${size}`)
  const brand = HEX.test(d.brand ?? '') ? d.brand : '#0f4c5c'
  const accent = HEX.test(d.accent ?? '') ? d.accent : '#ffb020'
  const story = size === 'story'
  const hi = d.lang === 'hi'
  return `<!doctype html><html lang="${hi ? 'hi' : 'en'}"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=block" rel="stylesheet">
<style>
:root{--brand:${brand};--accent:${accent};--ink:#0b1f2a;--muted:#46565f;
  --brand-dark:color-mix(in srgb,var(--brand) 60%,#000);--brand-soft:color-mix(in srgb,var(--brand) 10%,#fff)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${px.width}px;height:${px.height}px;overflow:hidden}
body{font-family:Poppins,sans-serif;color:var(--ink);background:var(--brand-dark);-webkit-font-smoothing:antialiased}
.page{position:relative;width:100%;height:100%;overflow:hidden}
.abs{position:absolute}
.pic{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.nopic{position:absolute;inset:0;background:radial-gradient(circle at 70% 30%,color-mix(in srgb,var(--brand) 80%,#fff) 0%,var(--brand) 40%,var(--brand-dark) 100%)}
.fit{overflow:hidden;min-height:0}
.h1{font-weight:800;line-height:${hi ? 1.3 : 1.05};letter-spacing:${hi ? 0 : -1.2}px}
.dark .hl{color:var(--accent)}
.light .hl{color:var(--brand);background:linear-gradient(transparent 66%,color-mix(in srgb,var(--accent) 35%,#fff) 66% 92%,transparent 92%)}
.body{font-weight:400;line-height:${hi ? 1.5 : 1.36}}
.badge{display:inline-flex;align-items:center;gap:10px;padding:10px 24px 10px 16px;border-radius:999px;font-weight:600;font-size:${story ? 30 : 26}px;background:var(--accent);color:#1a1300}
.logo{height:${story ? 92 : 74}px;max-width:300px;object-fit:contain;display:block}
.logo-card{background:#fff;border-radius:20px;padding:10px 16px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.call{display:inline-flex;align-items:center;gap:12px;font-weight:700;font-size:${story ? 36 : 30}px;padding:16px 30px 16px 22px;border-radius:999px;white-space:nowrap}
.call.on-dark{background:#fff;color:var(--brand-dark)}
.call.on-light{background:var(--brand);color:#fff;box-shadow:0 10px 24px color-mix(in srgb,var(--brand) 35%,transparent)}
.web{font-size:${story ? 26 : 22}px;line-height:1.3;text-align:right;max-width:430px}
.web b{display:block;font-size:${story ? 30 : 26}px;font-weight:700}
.foot{display:flex;align-items:center;justify-content:space-between;gap:20px}
.shadow-text{text-shadow:0 2px 18px rgba(0,0,0,.35)}
</style></head><body><div class="page t-${template}${reel ? ' reel' : ''}">${BODIES[template](d, story, hi)}</div>
<script>
// Shrink each .fit box's text until it fits, then tell the renderer. Glyphs
// overhang a tight line box a little, so overflow under a third of a line is fine.
function fit(el){let s=parseFloat(getComputedStyle(el).fontSize);while((el.scrollHeight>el.clientHeight+s*0.3||el.scrollWidth>el.clientWidth+1)&&s>18){s-=2;el.style.fontSize=s+'px'}}
Promise.all([document.fonts.ready,...[...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))])
  .then(()=>{document.querySelectorAll('.fit').forEach(fit);${reel ? `reel(${Number(reel.duration) || 12})` : ''};window.__ready=true})
${reel ? REEL_SCRIPT : ''}</script></body></html>`
}

// The Reel's motion: the picture zooms in over the whole clip; logo, badge,
// headline, body, each tip or card and the call button rise in, one by one,
// over the first ~55% of it, then everything holds so it can be read.
const REEL_SCRIPT = `
function reel(D){
  const anims=[];
  const pic=document.querySelector('.pic');
  if(pic)anims.push(pic.animate([{transform:'scale(1)'},{transform:'scale(1.12)'}],{duration:D*1000,fill:'both',easing:'linear'}));
  const parts=[...document.querySelectorAll('.logo-card,.badge,.h1,.body,.step,.foot')];
  const span=D*0.55, gap=parts.length>1?(span-0.6)/(parts.length-1):0;
  parts.forEach((el,i)=>anims.push(el.animate([{opacity:0,transform:'translateY(36px)'},{opacity:1,transform:'none'}],
    {duration:600,delay:(0.3+i*gap)*1000,fill:'both',easing:'cubic-bezier(.2,.8,.2,1)'})));
  anims.forEach(a=>a.pause());
  window.__seek=(t)=>anims.forEach(a=>{a.currentTime=t*1000});
  window.__seek(0);
}`

const pad = (story) => (story ? 64 : 52)
const picture = (d, style = '') => d.photo ? `<img class="pic" src="${esc(d.photo)}" style="${style}">` : '<div class="nopic"></div>'
const logo = (d, style = '') => d.logo ? `<div class="logo-card abs" style="${style}"><img class="logo" src="${esc(d.logo)}"></div>` : ''
const badge = (d, story) => d.badge ? `<span class="badge">${icon(d.icon || 'sparkles', story ? 32 : 28, '#1a1300', 2.4)}${esc(d.badge)}</span>` : ''
const callLabel = (hi) => (hi ? 'कॉल करें' : 'Call')

function foot(d, hi, onDark, style) {
  return `<div class="foot abs" style="${style}">
    ${d.phone ? `<div class="call ${onDark ? 'on-dark' : 'on-light'}">${icon('phone', 32, onDark ? 'var(--brand-dark)' : '#fff', 2.4)}${callLabel(hi)} ${esc(d.phone)}</div>` : '<div></div>'}
    <div class="web" style="color:${onDark ? 'rgba(255,255,255,.85)' : 'var(--muted)'}"><b style="color:${onDark ? '#fff' : 'var(--ink)'}">${esc(d.clinic)}</b>${esc(d.website ?? '')}</div>
  </div>`
}

const BODIES = {
  // The picture fills the post; the message sits on a dark fade at the bottom.
  photo: (d, story, hi) => {
    const p = pad(story)
    return `${picture(d)}
    <div class="abs" style="inset:0;background:linear-gradient(to top,rgba(4,16,22,.94) 0%,rgba(4,16,22,.78) ${story ? 34 : 40}%,rgba(4,16,22,0) ${story ? 62 : 72}%)"></div>
    <div class="abs" style="left:0;right:0;top:0;height:220px;background:linear-gradient(to bottom,rgba(0,0,0,.28),transparent)"></div>
    ${logo(d, `left:${p}px;top:${p}px`)}
    <div class="abs dark" style="left:${p}px;right:${p}px;bottom:${story ? 260 : 170}px;color:#fff">
      ${d.badge ? `<div style="margin-bottom:${story ? 30 : 22}px">${badge(d, story)}</div>` : ''}
      <div class="fit shadow-text" style="max-height:${story ? 640 : 380}px;font-size:${story ? 92 : 72}px">
        <div class="h1" style="font-size:1em">${headline(d)}</div>
        ${d.body ? `<div class="body" style="font-size:0.42em;margin-top:18px;color:rgba(255,255,255,.9)">${esc(d.body)}</div>` : ''}
      </div>
    </div>
    ${foot(d, hi, true, `left:${p}px;right:${p}px;bottom:${story ? 90 : 48}px`)}`
  },

  // Picture on top; a white card rises over it with the headline and three tips.
  tips: (d, story, hi) => {
    const p = pad(story)
    const picH = story ? 900 : 540
    const points = (d.points ?? []).slice(0, 3)
    return `<div class="abs" style="left:0;right:0;top:0;height:${picH + 60}px;overflow:hidden">${picture(d)}
      <div class="abs" style="left:0;right:0;top:0;height:200px;background:linear-gradient(to bottom,rgba(0,0,0,.25),transparent)"></div></div>
    ${logo(d, `left:${p}px;top:${p}px`)}
    <div class="abs light" style="left:0;right:0;top:${picH}px;bottom:0;background:#fff;border-radius:44px 44px 0 0;padding:${story ? 56 : 34}px ${p}px 0;display:flex;flex-direction:column">
      <div style="position:absolute;top:-30px;left:${p}px">${badge(d, story)}</div>
      <div class="fit h1" style="font-size:${story ? 80 : 54}px;max-height:${story ? 210 : 130}px;margin-top:${d.badge ? 14 : 0}px">${headline(d)}</div>
      <div style="display:flex;gap:${story ? 22 : 16}px;margin-top:${story ? 40 : 22}px;flex-direction:${story ? 'column' : 'row'}">
        ${points.map((t) => `<div class="step" style="flex:1;display:flex;${story ? 'align-items:center;gap:24px' : 'flex-direction:column;gap:12px'};background:var(--brand-soft);border-radius:24px;padding:${story ? '26px 28px' : '20px 20px 24px'}">
          <div style="flex:none;width:${story ? 84 : 60}px;height:${story ? 84 : 60}px;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center">${icon(t.icon || d.icon || 'check', story ? 44 : 32, '#fff', 2.3)}</div>
          <div style="font-size:${story ? 38 : 28}px;font-weight:600;line-height:${hi ? 1.4 : 1.22}">${esc(t.text)}</div></div>`).join('')}
      </div>
    </div>
    ${foot(d, hi, false, `left:${p}px;right:${p}px;bottom:${story ? 90 : 40}px`)}`
  },

  // A question people ask, over the picture; the answer in a white card.
  question: (d, story, hi) => {
    const p = pad(story)
    return `${picture(d)}
    <div class="abs" style="inset:0;background:linear-gradient(to bottom,rgba(4,16,22,.82) 0%,rgba(4,16,22,.55) 45%,rgba(4,16,22,.85) 100%)"></div>
    ${logo(d, `left:${p}px;top:${p}px`)}
    <div class="abs dark" style="left:${p}px;right:${p}px;top:${story ? 300 : 175}px;color:#fff">
      ${d.badge ? `<div style="margin-bottom:${story ? 30 : 20}px">${badge(d, story)}</div>` : ''}
      <div class="fit h1 shadow-text" style="font-size:${story ? 96 : 72}px;max-height:${story ? 560 : 330}px">${headline(d)}</div>
    </div>
    ${d.body ? `<div class="abs" style="left:${p}px;right:${p}px;bottom:${story ? 240 : 160}px;display:flex;gap:20px;align-items:center;background:#fff;border-radius:28px;padding:${story ? '32px 34px' : '24px 26px'};box-shadow:0 14px 40px rgba(0,0,0,.3)">
      <div style="flex:none;width:${story ? 76 : 62}px;height:${story ? 76 : 62}px;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center">${icon('check', story ? 42 : 34, '#fff', 3)}</div>
      <div class="fit body" style="font-size:${story ? 40 : 30}px;font-weight:600;color:var(--ink);max-height:${story ? 300 : 150}px">${esc(d.body)}</div></div>` : ''}
    ${foot(d, hi, true, `left:${p}px;right:${p}px;bottom:${story ? 90 : 48}px`)}`
  },

  // A common belief and what is true, under the picture.
  fact: (d, story, hi) => {
    const p = pad(story)
    const picH = story ? 760 : 400
    const card = (kind, text) => {
      const myth = kind === 'myth'
      const c = myth ? '#dc2626' : '#16a34a'
      return `<div class="step" style="flex:1;display:flex;gap:18px;align-items:flex-start;background:${myth ? '#fef2f2' : '#f0fdf4'};border-radius:26px;padding:${story ? '30px 28px' : '20px 22px'};border:2px solid ${myth ? '#fecaca' : '#bbf7d0'}">
        <div style="flex:none;width:${story ? 70 : 54}px;height:${story ? 70 : 54}px;border-radius:50%;background:${c};display:flex;align-items:center;justify-content:center">${icon(myth ? 'x' : 'check', story ? 38 : 30, '#fff', 3)}</div>
        <div><div style="font-size:${story ? 26 : 20}px;font-weight:800;letter-spacing:3px;color:${c};text-transform:uppercase">${myth ? (hi ? 'भ्रम' : 'Myth') : (hi ? 'सच' : 'Fact')}</div>
        <div class="fit" style="font-size:${story ? 38 : 27}px;font-weight:600;line-height:${hi ? 1.4 : 1.22};margin-top:4px;max-height:${story ? 260 : 120}px">${esc(text)}</div></div></div>`
    }
    return `<div class="abs" style="left:0;right:0;top:0;height:${picH + 60}px;overflow:hidden">${picture(d)}
      <div class="abs" style="left:0;right:0;top:0;height:200px;background:linear-gradient(to bottom,rgba(0,0,0,.25),transparent)"></div></div>
    ${logo(d, `left:${p}px;top:${p}px`)}
    <div class="abs light" style="left:0;right:0;top:${picH}px;bottom:0;background:#fff;border-radius:44px 44px 0 0;padding:${story ? 56 : 32}px ${p}px 0">
      <div style="position:absolute;top:-30px;left:${p}px">${badge(d, story)}</div>
      <div class="fit h1" style="font-size:${story ? 72 : 46}px;max-height:${story ? 200 : 66}px;margin-top:${d.badge ? 12 : 0}px">${headline(d)}</div>
      <div style="display:flex;flex-direction:${story ? 'column' : 'row'};gap:${story ? 22 : 16}px;margin-top:${story ? 34 : 18}px">${card('myth', d.myth ?? '')}${card('fact', d.fact ?? '')}</div>
    </div>
    ${foot(d, hi, false, `left:${p}px;right:${p}px;bottom:${story ? 90 : 36}px`)}`
  },

  // A health day: the brand colour sweeps over the picture; date, name, message.
  day: (d, story, hi) => {
    const p = pad(story)
    return `${picture(d, story ? '' : 'left:30%;width:70%')}
    <div class="abs" style="inset:0;background:${story
      ? 'linear-gradient(to top,var(--brand-dark) 0%,color-mix(in srgb,var(--brand) 92%,transparent) 48%,color-mix(in srgb,var(--brand) 10%,transparent) 75%)'
      : 'linear-gradient(to right,var(--brand-dark) 0%,var(--brand) 40%,color-mix(in srgb,var(--brand) 55%,transparent) 62%,transparent 80%)'}"></div>
    ${logo(d, `left:${p}px;top:${p}px`)}
    <div class="abs dark" style="left:${p}px;${story ? `right:${p}px;bottom:260px` : 'width:600px;top:200px;bottom:170px'};color:#fff;display:flex;flex-direction:column;justify-content:${story ? 'flex-end' : 'center'}">
      <div style="display:flex;align-items:center;gap:24px">
        ${d.dateDay ? `<div style="background:#fff;border-radius:24px;padding:12px 22px 10px;text-align:center;box-shadow:0 12px 30px rgba(0,0,0,.25)">
          <div style="font-size:${story ? 92 : 72}px;font-weight:800;line-height:1;color:var(--brand)">${esc(d.dateDay)}</div>
          <div style="font-size:${story ? 28 : 22}px;font-weight:700;letter-spacing:2px;color:#b45309;text-transform:uppercase">${esc(d.dateMonth)}</div></div>` : ''}
        <div style="font-size:${story ? 46 : 36}px;font-weight:700;line-height:1.15;color:var(--accent)">${esc(d.badge || '')}</div>
      </div>
      <div class="fit" style="font-size:${story ? 86 : 60}px;margin-top:${story ? 40 : 28}px;max-height:${story ? 560 : 420}px">
        <div class="h1" style="font-size:1em">${esc(d.headline)}</div>
        ${d.body ? `<div class="body" style="font-size:0.46em;margin-top:16px;color:rgba(255,255,255,.9)">${esc(d.body)}</div>` : ''}
      </div>
    </div>
    ${foot(d, hi, true, `left:${p}px;right:${p}px;bottom:${story ? 90 : 48}px`)}`
  },

  // Festival wishes over a festive picture, signed by the clinic.
  greeting: (d, story, hi) => {
    const p = pad(story)
    const motif = MOTIFS.includes(d.motif) ? d.motif : 'stars'
    const glow = { lights: '#ffd166', colours: '#ffffff', flag: '#ffffff', stars: '#ffe08a' }[motif]
    return `${picture(d)}
    <div class="abs" style="inset:0;background:radial-gradient(ellipse at 50% ${story ? 42 : 45}%,rgba(0,0,0,.35) 0%,rgba(0,0,0,.3) 50%,rgba(0,0,0,.7) 100%)"></div>
    ${logo(d, `left:50%;transform:translateX(-50%);top:${story ? 140 : 60}px`)}
    <div class="abs dark" style="left:${p}px;right:${p}px;top:${story ? 420 : 210}px;bottom:${story ? 300 : 170}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff">
      <div class="fit" style="font-size:${story ? 130 : 104}px;max-height:100%">
        <div class="h1" style="font-size:1em;color:${glow};text-shadow:0 0 40px rgba(255,200,80,.55),0 4px 20px rgba(0,0,0,.5)">${esc(d.headline)}</div>
        ${d.body ? `<div class="body shadow-text" style="font-size:0.32em;margin:22px auto 0;max-width:860px;color:rgba(255,255,255,.95)">${esc(d.body)}</div>` : ''}
        <div style="font-size:0.26em;font-weight:600;margin-top:24px;color:#fff">— ${esc(d.clinic)}</div>
      </div>
    </div>
    ${foot(d, hi, true, `left:${p}px;right:${p}px;bottom:${story ? 90 : 48}px`)}`
  },
}
