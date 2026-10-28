import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Maintenance from './Maintenance'
import './index.css'

// No env resolution here any more. The backend is fixed at build time by this
// deployment's VITE_SUPABASE_* pair, so there is nothing to read from the URL
// and nothing that could change after the Supabase client is constructed.
//
// VITE_MAINTENANCE=true (set in Vercel, then redeploy) replaces every page with
// the maintenance notice, and the app never starts — so nothing reads or
// writes the database while it is being moved.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{import.meta.env.VITE_MAINTENANCE === 'true' ? <Maintenance /> : <App />}</React.StrictMode>
)
