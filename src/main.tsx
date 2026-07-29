import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// No env resolution here any more. The backend is fixed at build time by this
// deployment's VITE_SUPABASE_* pair, so there is nothing to read from the URL
// and nothing that could change after the Supabase client is constructed.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
