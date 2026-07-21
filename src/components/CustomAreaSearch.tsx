import { useState, useEffect, useRef } from 'react'
import { Search, Plus, X, Loader2, MapPin, AlertCircle } from 'lucide-react'

export interface CustomArea {
  pin_code: string
  area_name: string
  district: string
  state: string
  branch_type: string
}

interface PostOffice {
  Name: string
  District: string
  State: string
  BranchType: string
  Pincode: string
}

interface Props {
  existingPins?: string[]       // PINs already shown in the main grid above —
                                 // prevents duplicate-adding the same area twice
  onAreasChange: (areas: CustomArea[]) => void
  label?: string
}

const MAX_RESULTS_SHOWN = 15

export default function CustomAreaSearch({ existingPins = [], onAreasChange, label }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PostOffice[]>([])
  const [added, setAdded] = useState<CustomArea[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [totalFound, setTotalFound] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const q = query.trim()
    if (q.length < 3) {
      setResults([])
      setError('')
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const isPin = /^\d{6}$/.test(q)
        const url = isPin
          ? `https://api.postalpincode.in/pincode/${q}`
          : `https://api.postalpincode.in/postoffice/${encodeURIComponent(q)}`

        const res = await fetch(url)
        const data = await res.json()
        const first = data?.[0]

        if (first?.Status === 'Success' && first.PostOffice?.length) {
          setTotalFound(first.PostOffice.length)
          setResults(first.PostOffice.slice(0, MAX_RESULTS_SHOWN))
        } else {
          setResults([])
          setTotalFound(0)
          setError(
            isPin
              ? 'Yeh PIN code nahi mila. Sahi 6-digit PIN check karein.'
              : `"${q}" ke liye koi area nahi mila. Poora ya sahi naam try karein.`
          )
        }
      } catch {
        setError('Search mein problem aa rahi hai. Dobara try karein.')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const isAlreadyKnown = (pin: string) => existingPins.includes(pin)
  const isAlreadyAdded = (pin: string) => added.some(a => a.pin_code === pin)

  const addArea = (po: PostOffice) => {
    if (isAlreadyAdded(po.Pincode) || isAlreadyKnown(po.Pincode)) return
    const next: CustomArea[] = [
      ...added,
      {
        pin_code: po.Pincode,
        area_name: po.Name,
        district: po.District,
        state: po.State,
        branch_type: po.BranchType,
      },
    ]
    setAdded(next)
    onAreasChange(next)
  }

  const removeArea = (pin: string) => {
    const next = added.filter(a => a.pin_code !== pin)
    setAdded(next)
    onAreasChange(next)
  }

  return (
    <div>
      <label className="text-sm font-semibold text-gray-700 mb-1 block">
        {label || 'Aapka area list mein nahi hai?'}
      </label>
      <p className="text-xs text-gray-500 leading-relaxed mb-2">
        Is box mein <strong className="text-gray-600">city ka naam</strong>,{' '}
        <strong className="text-gray-600">district ka naam</strong>, ya{' '}
        <strong className="text-gray-600">seedha PIN code</strong> likh sakte hain.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">🏙️ City — e.g. Saharanpur</span>
        <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">🗺️ District — e.g. Sirmaur</span>
        <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">🔢 PIN — e.g. 135001</span>
      </div>

      {/* Search input */}
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="input-field pl-9"
          placeholder="City, district ya PIN likhein — Saharanpur / Ambala / 135001"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-teal-500 animate-spin" />
        )}
      </div>

      {error && (
        <p className="text-xs text-amber-600 flex items-center gap-1 mb-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </p>
      )}

      {/* Live results */}
      {results.length > 0 && (
        <div className="border border-gray-200 rounded-xl mb-3 max-h-64 overflow-y-auto divide-y divide-gray-100">
          {results.map(po => {
            const already = isAlreadyAdded(po.Pincode) || isAlreadyKnown(po.Pincode)
            return (
              <div key={`${po.Pincode}-${po.Name}`}
                className="flex items-center justify-between p-3 hover:bg-gray-50 transition">
                <div className="flex items-start gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-teal-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {po.Name} <span className="text-gray-400 font-normal">— {po.Pincode}</span>
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {po.District}, {po.State} · {po.BranchType}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => addArea(po)}
                  disabled={already}
                  className={`shrink-0 flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                    already
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                  }`}
                >
                  {already ? '✓ Added' : <><Plus className="w-3.5 h-3.5" /> Add</>}
                </button>
              </div>
            )
          })}
          {totalFound > MAX_RESULTS_SHOWN && (
            <p className="text-xs text-gray-400 text-center py-2 px-3">
              {totalFound - MAX_RESULTS_SHOWN} aur results mile — search ko
              zyada specific karein (jaise poora area/PIN)
            </p>
          )}
        </div>
      )}

      {/* Added custom areas */}
      {added.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">
            Naye areas jo aapne add kiye ({added.length}):
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {added.map(a => (
              <span key={a.pin_code}
                className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-1.5 rounded-full">
                {a.area_name} — {a.pin_code}
                <button onClick={() => removeArea(a.pin_code)} className="hover:text-amber-900">
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-700">
              ⚠️ Yeh naye areas hain jo abhi hamari list mein nahi hain.
              Registration submit karne ke baad hamari team{' '}
              <strong>24 ghante mein pricing confirm</strong> karke aapko
              WhatsApp par bata degi. Baaki selected areas ki pricing
              upar turant dikh rahi hai.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
