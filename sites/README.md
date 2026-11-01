# Clinic websites (Complete package)

One Next.js app that serves every Complete-package clinic website on its own
domain. The design is the one first built for SN Eye Hospital; everything on
a page comes from Sehatsandhi:

- the clinic's **Website tab** (`business_sites.content`): doctor, training,
  highlights, treatments, equipment, testimonials, insurance, visit details,
  social links, brand colour and logo;
- live data: Sehatsandhi ratings, social posts and reels, articles, and
  WhatsApp booking into the clinic's own queue.

Only sites switched to the **full** tier (admin → Website) are served here;
free sites stay on Sehatsandhi's one-page site.

## How a request finds its clinic

`src/middleware.ts` reads the hostname (`www.clinic.in` or
`<slug>.sehatsandhi.com`) and rewrites to `/site/<key>/<en|hi>/<path>`.
Sehatsandhi's `sehat_site_business` resolves either form. Pages are cached
per clinic and refreshed hourly.

## Run locally

```
cp .env.example .env.local     # sandbox URL + key, DEV_SITE_KEY=<slug>
npm install
npm run dev                    # http://localhost:3100  (?site=<slug> switches clinic)
```

## Hosting

A separate Vercel project with **Root Directory = `sites`**. Add each
clinic's domain to that project; the clinic points its DNS at Vercel. No
code change per clinic.

SN Eye-only pages (international patients, Ask the doctor, lens guide,
vision check) are not part of this template; they live in the SN Eye repo
and can be added for a clinic on request.
