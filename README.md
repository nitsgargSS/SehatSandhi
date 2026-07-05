# Sehatsandhi — sehatsandhi.com

> स्वास्थ्य की नई साझेदारी — Health's New Partnership

WhatsApp-first health aggregator for Yamuna Nagar district.

## Quick Setup (15 minutes)

### 1. Install dependencies
```bash
npm install
```

### 2. Set up Supabase
- Go to supabase.com → New Project → "sehatsandhi" → Singapore region
- Go to SQL Editor → paste the contents of `supabase/schema.sql` → Run
- Go to Settings → API → copy Project URL and anon key

### 3. Set up environment variables
```bash
cp .env.example .env
# Edit .env and fill in your Supabase URL and anon key
```

### 4. Add your logo
Copy your logo PNG to `public/logo.png`

### 5. Update your WhatsApp number
Edit `src/types/index.ts` → change `WA_NUMBER` to your actual number

### 6. Run locally
```bash
npm run dev
# Opens at http://localhost:5173
```

## Deploy to Vercel (free)

1. Push this repo to GitHub
2. Go to vercel.com → New Project → Import your GitHub repo
3. Add environment variables (same as .env)
4. Deploy → get a free .vercel.app URL
5. Add custom domain: sehatsandhi.com in Vercel settings

## Pages

| Route | Description |
|---|---|
| `/` | Public landing page |
| `/doctor` | Doctor registration (4-step wizard) |
| `/doctor/login` | Doctor login |
| `/doctor/dashboard` | Doctor dashboard |
| `/admin` | Admin login |
| `/admin/dashboard` | Admin panel (approve doctors, view revenue) |

## Admin Login
Default: `admin@sehatsandhi.com` / `admin@SS2026`
**Change this in .env before going live!**

## Tech Stack
React + TypeScript + Vite + Tailwind CSS + Supabase + React Router

## Need help?
- Supabase docs: supabase.com/docs
- Tailwind docs: tailwindcss.com
- Vercel docs: vercel.com/docs
