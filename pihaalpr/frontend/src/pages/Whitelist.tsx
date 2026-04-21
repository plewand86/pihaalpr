import { useEffect, useState } from 'react'
import { Check, Edit2, Play, Plus, Trash2, X } from 'lucide-react'
import EntityPicker from '../components/EntityPicker'
import {
  WhitelistEntry,
  WhitelistEntryCreate,
  createWhitelistEntry,
  deleteWhitelistEntry,
  getWhitelist,
  testWhitelistEntry,
  updateWhitelistEntry,
} from '../api/client'

// ── akcje per domena ────────────────────────────────────────────────────────
interface Action { label: string; service: string }

const PULSE: Action = { label: 'Kliknij (2s)', service: 'pulse' }

const DOMAIN_ACTIONS: Record<string, Action[]> = {
  cover:         [{ label: 'Otwórz', service: 'open_cover' }, { label: 'Zamknij', service: 'close_cover' }, { label: 'Zatrzymaj', service: 'stop_cover' }, { label: 'Przełącz', service: 'toggle' }],
  switch:        [{ label: 'Włącz', service: 'turn_on' }, { label: 'Wyłącz', service: 'turn_off' }, { label: 'Przełącz', service: 'toggle' }, PULSE],
  light:         [{ label: 'Włącz', service: 'turn_on' }, { label: 'Wyłącz', service: 'turn_off' }, { label: 'Przełącz', service: 'toggle' }, PULSE],
  fan:           [{ label: 'Włącz', service: 'turn_on' }, { label: 'Wyłącz', service: 'turn_off' }, { label: 'Przełącz', service: 'toggle' }, PULSE],
  input_boolean: [{ label: 'Włącz', service: 'turn_on' }, { label: 'Wyłącz', service: 'turn_off' }, { label: 'Przełącz', service: 'toggle' }, PULSE],
  siren:         [{ label: 'Włącz', service: 'turn_on' }, { label: 'Wyłącz', service: 'turn_off' }, PULSE],
  script:        [{ label: 'Uruchom', service: 'turn_on' }],
  scene:         [{ label: 'Aktywuj', service: 'turn_on' }],
  automation:    [{ label: 'Wyzwól', service: 'trigger' }, { label: 'Włącz', service: 'turn_on' }, { label: 'Wyłącz', service: 'turn_off' }],
  lock:          [{ label: 'Zablokuj', service: 'lock' }, { label: 'Odblokuj', service: 'unlock' }],
  media_player:  [{ label: 'Play', service: 'media_play' }, { label: 'Pauza', service: 'media_pause' }, { label: 'Stop', service: 'media_stop' }],
  climate:       [{ label: 'Włącz', service: 'turn_on' }, { label: 'Wyłącz', service: 'turn_off' }],
  vacuum:        [{ label: 'Uruchom', service: 'start' }, { label: 'Zatrzymaj', service: 'stop' }, { label: 'Wróć do bazy', service: 'return_to_base' }],
}

const DEFAULT_ACTIONS: Action[] = [
  { label: 'Włącz', service: 'turn_on' },
  { label: 'Wyłącz', service: 'turn_off' },
  { label: 'Przełącz', service: 'toggle' },
  PULSE,
]

function getActions(domain: string): Action[] {
  return DOMAIN_ACTIONS[domain] ?? DEFAULT_ACTIONS
}

function getDomain(entityId: string): string {
  return entityId.includes('.') ? entityId.split('.')[0] : ''
}

function actionLabel(domain: string, service: string): string {
  const actions = getActions(domain)
  return actions.find(a => a.service === service)?.label ?? service
}

// ── form ────────────────────────────────────────────────────────────────────
const EMPTY_FORM: WhitelistEntryCreate = {
  plate: '', description: '', ha_domain: '', ha_service: '', entity_id: '', service_data: '', enabled: true,
}

export default function Whitelist() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<WhitelistEntryCreate>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<Record<number, 'ok' | 'err'>>({})

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      await testWhitelistEntry(id)
      setTestResult(r => ({ ...r, [id]: 'ok' }))
      setTimeout(() => setTestResult(r => { const n = { ...r }; delete n[id]; return n }), 2000)
    } catch {
      setTestResult(r => ({ ...r, [id]: 'err' }))
      setTimeout(() => setTestResult(r => { const n = { ...r }; delete n[id]; return n }), 2000)
    } finally {
      setTestingId(null)
    }
  }

  const load = () => getWhitelist().then(setEntries).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setError(''); setShowForm(true) }

  const openEdit = (e: WhitelistEntry) => {
    setForm({ plate: e.plate, description: e.description, ha_domain: e.ha_domain, ha_service: e.ha_service, entity_id: e.entity_id, service_data: e.service_data, enabled: e.enabled })
    setEditId(e.id); setError(''); setShowForm(true)
  }

  const handleEntityChange = (entityId: string) => {
    const domain = getDomain(entityId)
    const actions = getActions(domain)
    setForm(f => ({ ...f, entity_id: entityId, ha_domain: domain, ha_service: actions[0]?.service ?? '' }))
  }

  const handleSubmit = async () => {
    if (!form.plate.trim()) { setError('Numer rejestracyjny jest wymagany'); return }
    setSaving(true); setError('')
    try {
      editId !== null ? await updateWhitelistEntry(editId, form) : await createWhitelistEntry(form)
      setShowForm(false); load()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Błąd zapisu')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Usunąć wpis z białej listy?')) return
    await deleteWhitelistEntry(id); load()
  }

  const handleToggle = async (e: WhitelistEntry) => {
    await updateWhitelistEntry(e.id, { enabled: !e.enabled }); load()
  }

  const currentDomain = getDomain(form.entity_id ?? '')
  const availableActions = getActions(currentDomain)

  if (loading) return <p className="text-gray-400 text-sm">Ładowanie...</p>

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">
          Biała lista{' '}
          <span className="ml-1 bg-green-700 text-white rounded-full px-2 py-0.5 text-xs">{entries.length}</span>
        </h2>
        <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded-lg text-sm font-medium transition-colors">
          <Plus size={14} /> Dodaj tablicę
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Gdy zostanie rozpoznana tablica z tej listy, wywoływana jest przypisana akcja Home Assistant.
      </p>

      {/* Form */}
      {showForm && (
        <div className="bg-panel rounded-xl p-5 border border-green-500/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200">{editId !== null ? 'Edytuj wpis' : 'Nowy wpis'}</h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X size={16} /></button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-400 mb-1 block">Numer rejestracyjny *</span>
              <input
                type="text"
                value={form.plate}
                onChange={e => setForm(f => ({ ...f, plate: e.target.value.toUpperCase() }))}
                placeholder="np. WA12345"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-500"
              />
            </label>

            <label className="block">
              <span className="text-xs text-gray-400 mb-1 block">Opis</span>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="np. Auto właściciela"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-500"
              />
            </label>
          </div>

          {/* Entity + action */}
          <div className="border-t border-white/10 pt-4 space-y-3">
            <p className="text-xs text-gray-400 font-medium">Akcja Home Assistant po rozpoznaniu</p>

            <label className="block">
              <span className="text-xs text-gray-400 mb-1 block">Urządzenie / encja</span>
              <EntityPicker
                value={form.entity_id ?? ''}
                onChange={handleEntityChange}
                placeholder="Wybierz urządzenie z Home Assistant..."
              />
            </label>

            {form.entity_id && (
              <label className="block">
                <span className="text-xs text-gray-400 mb-1 block">Akcja</span>
                <div className="flex flex-wrap gap-2">
                  {availableActions.map(a => (
                    <button
                      key={a.service}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, ha_service: a.service }))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        form.ha_service === a.service
                          ? 'bg-green-600 text-white'
                          : 'bg-white/10 hover:bg-white/20 text-gray-300'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </label>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="rounded" />
            <span className="text-sm text-gray-300">Aktywny</span>
          </label>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
              <Check size={14} /> {editId !== null ? 'Zapisz zmiany' : 'Dodaj'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors">
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {entries.length === 0 && !showForm ? (
        <div className="bg-panel rounded-xl p-8 border border-white/5 text-center text-gray-500 text-sm">
          Brak wpisów. Dodaj pierwszy numer rejestracyjny przyciskiem powyżej.
        </div>
      ) : (
        <div className="bg-panel rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                <th className="px-4 py-3">Tablica</th>
                <th className="px-4 py-3">Opis</th>
                <th className="px-4 py-3">Urządzenie → Akcja</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-bold bg-green-900/40 text-green-300 px-2 py-1 rounded">{e.plate}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{e.description || '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {e.entity_id ? (
                      <div>
                        <span className="font-mono text-gray-300">{e.entity_id}</span>
                        {e.ha_service && (
                          <span className="ml-2 px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded text-xs">
                            {actionLabel(e.ha_domain, e.ha_service)}
                          </span>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(e)} className="text-xs">
                      {e.enabled ? <span className="text-green-400">Aktywny</span> : <span className="text-gray-500">Wyłączony</span>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => handleTest(e.id)}
                        disabled={testingId === e.id}
                        className={`p-1.5 rounded hover:bg-white/10 transition-colors ${
                          testResult[e.id] === 'ok' ? 'text-green-400' :
                          testResult[e.id] === 'err' ? 'text-red-400' :
                          'text-gray-400 hover:text-yellow-400'
                        }`}
                        title="Testuj"
                      >
                        <Play size={14} />
                      </button>
                      <button onClick={() => openEdit(e)} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors" title="Edytuj">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleDelete(e.id)} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors" title="Usuń">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
