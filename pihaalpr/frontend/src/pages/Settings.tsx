import { useEffect, useRef, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { AppSettings, getAppSettings, updateAppSettings } from '../api/client'

interface MqttEvent {
  ts: string
  kind: 'connected' | 'error' | 'info' | 'publish'
  msg: string
  topic: string
  payload: string
}

function getLogKindMeta(kind: MqttEvent['kind']) {
  switch (kind) {
    case 'connected':
      return { label: 'OK', className: 'text-green-400' }
    case 'error':
      return { label: 'ERR', className: 'text-red-400' }
    case 'publish':
      return { label: 'PUB', className: 'text-slate-300' }
    default:
      return { label: 'INF', className: 'text-gray-400' }
  }
}

export default function Settings() {
  const [form, setForm] = useState<AppSettings>({
    lpr_api_url: 'https://api-alpr.app4isp.pl/',
    lpr_api_key: '',
    min_confidence: 80,
    min_chars: 5,
    min_width: 0,
    mqtt_topic: 'pihaalpr',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [mqttLog, setMqttLog] = useState<MqttEvent[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const apiKeyStored = form.lpr_api_key === '***'
  const apiKeyDraft = Boolean(form.lpr_api_key.trim()) && !apiKeyStored
  const apiKeyConfigured = apiKeyStored || apiKeyDraft

  useEffect(() => {
    const es = new EventSource('api/mqtt/events')
    es.onmessage = (e) => {
      const event: MqttEvent = JSON.parse(e.data)
      setMqttLog(prev => [...prev.slice(-199), event])
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [mqttLog])

  useEffect(() => {
    getAppSettings().then(setForm).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      await updateAppSettings(form)
      setMsg('Zapisano')
    } catch {
      setMsg('Blad zapisu')
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 3000)
    }
  }

  if (loading) return <p className="text-gray-400 text-sm">Ladowanie...</p>

  return (
    <div className="max-w-7xl space-y-4">
        <div className="bg-panel rounded-xl p-6 border border-white/5 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-300">API rozpoznawania tablic</h2>
              <p className="text-xs text-gray-500 mt-1">Ustawienia endpointu LPR i filtrowania wynikow.</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                <Save size={14} /> Zapisz
              </button>
              {msg && (
                <span className={`text-sm ${msg === 'Zapisano' ? 'text-green-400' : 'text-red-400'}`}>
                  {msg}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="text-xs text-gray-400 mb-1 block">URL endpointu LPR *</span>
              <input
                type="url"
                value={form.lpr_api_url}
                onChange={e => setForm(f => ({ ...f, lpr_api_url: e.target.value }))}
                placeholder="https://api-alpr.app4isp.pl/"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </label>

            <label className="block">
              <span className={`text-xs mb-1 block ${apiKeyConfigured ? 'text-gray-400' : 'text-red-300'}`}>
                Klucz API <span className="text-gray-600">(pole "key" w zadaniu)</span>
              </span>
              <input
                type="password"
                value={apiKeyStored ? '' : form.lpr_api_key}
                onChange={e => setForm(f => ({ ...f, lpr_api_key: e.target.value }))}
                placeholder={apiKeyStored ? 'Klucz API jest juz skonfigurowany' : 'Wpisz klucz API'}
                className={`w-full bg-white/5 border rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none ${
                  apiKeyConfigured ? 'border-white/10 focus:border-gray-500' : 'border-red-400/40 focus:border-red-400'
                }`}
              />
              {apiKeyStored && (
                <p className="mt-2 text-xs text-green-300">
                  Klucz API jest juz skonfigurowany. Wpisz nowy tylko wtedy, gdy chcesz go zmienic.
                </p>
              )}
              {apiKeyDraft && (
                <p className="mt-2 text-xs text-green-300">
                  Nowy klucz API jest wpisany i zostanie zapisany po kliknieciu `Zapisz`.
                </p>
              )}
              {!apiKeyConfigured && (
                <p className="mt-2 text-xs text-red-300">
                  Nie wiem, skontaktuj sie z tworca w celu uzyskania klucza API.
                </p>
              )}
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="block">
                <span className="text-xs text-gray-400 mb-1 block">Minimalna pewnosc (%)</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.min_confidence}
                  onChange={e => setForm(f => ({ ...f, min_confidence: Number(e.target.value) }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
                />
              </label>

              <label className="block">
                <span className="text-xs text-gray-400 mb-1 block">Min. ilosc znakow <span className="text-gray-600">(0 = wylaczone)</span></span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={form.min_chars}
                  onChange={e => setForm(f => ({ ...f, min_chars: Number(e.target.value) }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
                />
              </label>

              <label className="block">
                <span className="text-xs text-gray-400 mb-1 block">Min. szerokosc tablicy (px) <span className="text-gray-600">(0 = wylaczone)</span></span>
                <input
                  type="number"
                  min={0}
                  value={form.min_width}
                  onChange={e => setForm(f => ({ ...f, min_width: Number(e.target.value) }))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="bg-panel rounded-xl p-6 border border-white/5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">MQTT i logi</h2>
            <p className="text-xs text-gray-500 mt-1">Konfiguracja topiku MQTT oraz podglad zdarzen live.</p>
          </div>

          <label className="block">
            <span className="text-xs text-gray-400 mb-1 block">Topik MQTT <span className="text-gray-600">(prefiks, np. pihaalpr)</span></span>
            <input
              type="text"
              value={form.mqtt_topic}
              onChange={e => setForm(f => ({ ...f, mqtt_topic: e.target.value }))}
              placeholder="pihaalpr"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
            <p className="text-xs text-gray-600 mt-1">
              Wykrycia beda wysylane na: <span className="font-mono text-gray-500">{form.mqtt_topic || 'pihaalpr'}/detection</span>
            </p>
          </label>

          <div className="border-t border-white/10 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-300">Log MQTT <span className="text-xs font-normal text-gray-500">(live)</span></h3>
              <button onClick={() => setMqttLog([])} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors">
                <Trash2 size={12} /> Wyczysc
              </button>
            </div>

            <div
              ref={logRef}
              className="bg-black/40 rounded-lg p-3 h-[28rem] overflow-y-auto font-mono text-xs space-y-1"
            >
              {mqttLog.length === 0 && (
                <span className="text-gray-600">Oczekiwanie na zdarzenia MQTT...</span>
              )}
              {mqttLog.map((event, i) => {
                const kindMeta = getLogKindMeta(event.kind)
                return (
                  <div key={i} className="flex gap-2 leading-relaxed">
                    <span className="text-gray-600 shrink-0">{event.ts}</span>
                    <span className={`shrink-0 ${kindMeta.className}`}>{kindMeta.label}</span>
                    <span className="text-gray-300">{event.msg}</span>
                    {event.topic && (
                      <span className="text-gray-500 truncate">
                        {'-> '}<span className="text-slate-400">{event.topic}</span>
                        {event.payload && <span className="text-gray-600"> {event.payload}</span>}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
    </div>
  )
}
