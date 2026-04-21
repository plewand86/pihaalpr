import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import axios from 'axios'

const api = axios.create({ baseURL: 'api' })

interface HAEntity {
  entity_id: string
  friendly_name: string
  state: string
  domain: string
}

interface Props {
  value: string
  onChange: (entityId: string) => void
  type?: 'all' | 'valves' | 'sensors' | 'weather'
  placeholder?: string
  disabled?: boolean
}

function stateBadgeClass(state: string): string {
  if (state === 'on' || state === 'open' || state === 'unlocked' || state === 'playing')
    return 'bg-green-900/60 text-green-400'
  if (state === 'off' || state === 'closed' || state === 'locked' || state === 'idle')
    return 'bg-white/5 text-gray-500'
  if (state === 'unavailable' || state === 'unknown')
    return 'bg-red-900/40 text-red-400'
  return 'bg-yellow-900/40 text-yellow-400'
}

export default function EntityPicker({ value, onChange, type = 'all', placeholder = 'Wybierz encję...', disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [entities, setEntities] = useState<HAEntity[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = entities.find(e => e.entity_id === value)

  // Pobierz encje przy każdym otwarciu dropdowna
  useEffect(() => {
    if (!open) return
    setLoading(true)
    const url = type === 'valves' ? '/ha/entities/valves'
      : type === 'sensors' ? '/ha/entities/sensors'
      : type === 'weather' ? '/ha/entities/weather'
      : '/ha/entities'
    api.get<HAEntity[]>(url)
      .then(r => setEntities(r.data))
      .catch(() => setEntities([]))
      .finally(() => setLoading(false))
  }, [open, type])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = entities.filter(e =>
    e.entity_id.toLowerCase().includes(search.toLowerCase()) ||
    (e.friendly_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-left hover:border-white/20 focus:outline-none focus:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <span className="flex-1 truncate min-w-0">
          {selected ? (
            <span className="flex flex-col min-w-0">
              <span className="text-gray-100 truncate">{selected.friendly_name || selected.entity_id}</span>
              {selected.friendly_name && (
                <span className="text-gray-500 text-xs truncate font-mono">{selected.entity_id}</span>
              )}
            </span>
          ) : value ? (
            <span className="text-gray-300 truncate font-mono text-xs">{value}</span>
          ) : (
            <span className="text-gray-600">{placeholder}</span>
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {value && (
            <span
              role="button"
              onClick={e => { e.stopPropagation(); onChange(''); setSearch('') }}
              className="p-0.5 text-gray-500 hover:text-red-400 rounded cursor-pointer"
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown size={14} className={`text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[#161b27] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-white/10">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Szukaj..."
                className="w-full bg-white/5 border border-white/10 rounded pl-7 pr-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-56 overflow-y-auto">
            {loading && (
              <div className="py-6 text-center text-gray-500 text-sm">Ładowanie encji...</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="py-6 text-center text-gray-500 text-sm">
                {entities.length === 0 ? 'Brak encji lub błąd połączenia z HA' : 'Brak wyników'}
              </div>
            )}
            {!loading && filtered.map(e => (
              <button
                key={e.entity_id}
                type="button"
                onClick={() => { onChange(e.entity_id); setOpen(false); setSearch('') }}
                className={`w-full text-left px-3 py-2 hover:bg-white/10 flex items-center justify-between gap-3 transition-colors ${
                  e.entity_id === value ? 'bg-white/10' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-100 truncate">{e.friendly_name || e.entity_id}</div>
                  {e.friendly_name && (
                    <div className="text-xs text-gray-500 truncate font-mono">{e.entity_id}</div>
                  )}
                </div>
                <span className={`text-xs shrink-0 px-1.5 py-0.5 rounded font-medium ${stateBadgeClass(e.state)}`}>
                  {e.state}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
