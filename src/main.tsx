import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyEnvFromUrl } from './lib/env'
import './index.css'

// Honour ?env=sandbox before anything renders. It has to run here, ahead of the
// first import of ./lib/supabase, because that module builds its client from
// whichever backend is active at module-eval time — switching afterwards would
// leave a client pointed at the old project.
//
// Returns true when it has triggered a reload; rendering into a page that is
// about to be replaced just wastes a frame and can flash the wrong backend's UI.
if (!applyEnvFromUrl()) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>
  )
}
