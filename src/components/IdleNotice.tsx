// Shown on a login page reached from IdleLogout (?reason=idle&m=30).
export default function IdleNotice() {
  const q = new URLSearchParams(window.location.search)
  if (q.get('reason') !== 'idle') return null
  const m = Number(q.get('m')) || null
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 mb-4">
      You were signed out after {m ? `${m} minutes` : 'a while'} with no activity, to keep patient records safe. Sign in again to carry on.
    </div>
  )
}
