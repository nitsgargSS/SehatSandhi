import React from 'react'
import ReactDOM from 'react-dom/client'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import Maintenance from './Maintenance'
import { siteKeyFromHost } from './site/siteData'
import './index.css'

const SiteApp = lazy(() => import('./site/SiteApp'))

// No env resolution here any more. The backend is fixed at build time by this
// deployment's VITE_SUPABASE_* pair, so there is nothing to read from the URL
// and nothing that could change after the Supabase client is constructed.
//
// VITE_MAINTENANCE=true (set in Vercel, then redeploy) replaces every page with
// the maintenance notice, and the app never starts — so nothing reads or
// writes the database while it is being moved.
// 0282: on <slug>.sehatsandhi.com or a clinic's own domain the page is that
// clinic's website, not Sehatsandhi. Our own hosts never are (siteKeyFromHost).
const siteKey = siteKeyFromHost()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{import.meta.env.VITE_MAINTENANCE === 'true' ? <Maintenance />
    : siteKey ? (
      <BrowserRouter><Suspense fallback={null}><Routes><Route path="/*" element={<SiteApp siteKey={siteKey} base="" />} /></Routes></Suspense></BrowserRouter>
    ) : <App />}</React.StrictMode>
)
