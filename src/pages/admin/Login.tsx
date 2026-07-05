import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const ADMIN_EMAIL = (import.meta as any).env.VITE_ADMIN_EMAIL || 'nits.garg@gmail.com'
const ADMIN_PASS  = (import.meta as any).env.VITE_ADMIN_PASS  || 'Ganesha@123'

export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
      sessionStorage.setItem('admin_auth', 'true')
      navigate('/admin/dashboard')
    } else {
      setError('Invalid credentials')
    }
  }

  return (
    <div className="min-h-screen bg-navy-700 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <img src="/logo.png" alt="Sehatsandhi" className="h-12 mx-auto mb-6" />
        <h2 className="text-xl font-bold text-navy-700 text-center mb-6">Admin Access</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
            <input className="input-field" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Password</label>
            <input className="input-field" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button type="submit" className="btn-teal w-full justify-center py-3">Login →</button>
        </form>
        <p className="text-xs text-gray-400 text-center mt-4">Restricted access — Sehatsandhi admin only</p>
      </div>
    </div>
  )
}
