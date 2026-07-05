import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, LogOut, Users, Clock, TrendingUp, Calendar } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Doctor } from '../../types'

export default function AdminDashboard() {
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [search, setSearch] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('doctors').select('*').order('created_at', { ascending: false })
    setDoctors(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const approve = async (id: string, name: string) => {
    const { error } = await supabase.from('doctors').update({ status: 'active' }).eq('id', id)
    if (!error) { setActionMsg(`✓ ${name} approved — listing is now live!`); load(); setTimeout(() => setActionMsg(''), 3000) }
  }

  const reject = async (id: string, name: string) => {
    const reason = window.prompt(`Reason for rejecting ${name}?`)
    if (!reason) return
    await supabase.from('doctors').update({ status: 'suspended' }).eq('id', id)
    setActionMsg(`✗ ${name} rejected.`); load(); setTimeout(() => setActionMsg(''), 3000)
  }

  const logout = () => { sessionStorage.removeItem('admin_auth'); window.location.href = '/admin' }

  const pending = doctors.filter(d => d.status === 'pending')
  const active  = doctors.filter(d => d.status === 'active')
  const totalRevenue = active.reduce((s, d) => s + (d.pin_codes?.length || 0) * 5000, 0)
  const filtered = doctors.filter(d => {
    const matchTab = tab === 'pending' ? d.status === 'pending' : true
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.phone.includes(search)
    return matchTab && matchSearch
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar + main */}
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-56 bg-navy-700 min-h-screen fixed left-0 top-0 flex flex-col pt-6">
          <div className="px-5 mb-8">
            <img src="/logo.png" alt="Sehatsandhi" className="h-10 brightness-0 invert" />
            <p className="text-white/40 text-xs mt-2">Admin Panel</p>
          </div>
          <nav className="flex-1 px-3 space-y-1">
            {[
              { id: 'pending', label: `Pending (${pending.length})`, badge: pending.length > 0 },
              { id: 'all', label: 'All Doctors' },
            ].map(n => (
              <button key={n.id} onClick={() => setTab(n.id as any)}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition flex items-center justify-between ${tab === n.id ? 'bg-teal-600 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>
                {n.label}
                {n.badge && <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pending.length}</span>}
              </button>
            ))}
          </nav>
          <button onClick={logout} className="flex items-center gap-2 px-5 py-4 text-white/40 hover:text-white text-sm transition border-t border-white/10 mt-auto">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </aside>

        {/* Main content */}
        <main className="ml-56 flex-1 p-8">
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Doctors', value: doctors.length, icon: <Users className="w-5 h-5 text-navy-600" /> },
              { label: 'Pending Approval', value: pending.length, icon: <Clock className="w-5 h-5 text-amber-500" />, warn: pending.length > 0 },
              { label: 'Active & Listed', value: active.length, icon: <CheckCircle2 className="w-5 h-5 text-teal-500" /> },
              { label: 'Monthly Revenue', value: `₹${totalRevenue.toLocaleString('en-IN')}`, icon: <TrendingUp className="w-5 h-5 text-teal-500" /> },
            ].map(s => (
              <div key={s.label} className={`card shadow-sm ${s.warn ? 'border-2 border-amber-300' : ''}`}>
                <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-gray-500">{s.label}</span></div>
                <p className="text-2xl font-bold text-navy-700">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Action message */}
          {actionMsg && <div className="mb-4 bg-teal-50 border border-teal-200 text-teal-700 px-4 py-3 rounded-xl text-sm">{actionMsg}</div>}

          {/* Table */}
          <div className="card shadow-sm">
            <div className="flex items-center gap-4 mb-5">
              <h2 className="font-bold text-navy-700 text-lg flex-1">
                {tab === 'pending' ? '⏳ Pending Verification' : '📋 All Doctors'}
              </h2>
              <input className="input-field w-56" placeholder="Search name or phone..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {loading ? <p className="text-gray-400 text-sm py-8 text-center">Loading...</p> :
              filtered.length === 0 ? <p className="text-gray-400 text-sm py-12 text-center">No doctors found.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 text-gray-400 text-xs">
                    <th className="text-left py-3 px-2">Doctor</th>
                    <th className="text-left py-3 px-2">Speciality</th>
                    <th className="text-left py-3 px-2">Reg. No.</th>
                    <th className="text-left py-3 px-2">PINs</th>
                    <th className="text-right py-3 px-2">Fee/mo</th>
                    <th className="text-left py-3 px-2">Status</th>
                    <th className="py-3 px-2">Actions</th>
                  </tr></thead>
                  <tbody>{filtered.map(d => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="py-3 px-2">
                        <p className="font-medium text-gray-800">{d.name}</p>
                        <p className="text-xs text-gray-400">{d.qualification} · {d.phone}</p>
                      </td>
                      <td className="py-3 px-2 text-gray-600">{d.speciality}</td>
                      <td className="py-3 px-2">
                        <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{d.reg_number}</span>
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-xs text-gray-600">{d.pin_codes?.join(', ')}</span>
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-navy-700">
                        ₹{((d.pin_codes?.length || 0) * 5000).toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-2">
                        <span className={d.status === 'active' ? 'badge-active' : d.status === 'suspended' ? 'badge-suspended' : 'badge-pending'}>
                          {d.status}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex gap-1 justify-center">
                          {d.status === 'pending' && <>
                            <button onClick={() => approve(d.id, d.name)} title="Approve"
                              className="p-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition">
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => reject(d.id, d.name)} title="Reject"
                              className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition">
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>}
                          {d.status === 'active' && (
                            <button onClick={() => reject(d.id, d.name)} title="Suspend"
                              className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition">
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {d.status === 'suspended' && (
                            <button onClick={() => approve(d.id, d.name)} title="Reactivate"
                              className="p-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition">
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
