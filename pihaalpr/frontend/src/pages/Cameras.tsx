import { useEffect, useRef, useState } from 'react'
import { Camera as CameraIcon, Check, Clock, Edit2, Loader2, Plus, Trash2, ToggleLeft, ToggleRight, X } from 'lucide-react'
import { Camera, CameraCreate, MotionRuntimeEvent, createCamera, deleteCamera, getCameras, getMotionFrameUrl, getMotionStreamUrl, startCameraRtsp, stopCameraRtsp, testRtsp, testSnapshot, updateCamera } from '../api/client'

const EMPTY_FORM: CameraCreate = {
  name: '',
  snapshot_url: '',
  username: '',
  password: '',
  enabled: true,
  auto_capture: false,
  capture_interval: 30,
  rtsp_url: '',
  rtsp_auto_start: true,
  rtsp_use_snapshot: false,
  motion_threshold: 10,
}

type TestState = 'idle' | 'loading' | 'ok' | 'error'
type LiveFrameState = 'idle' | 'loading' | 'ok' | 'error'
type LivePreviewMode = 'stream' | 'frame'

const LIVE_FRAME_POLL_MS = 250
const LIVE_STREAM_FALLBACK_MS = 3000

async function getApiErrorDetail(err: any, fallback: string, notFoundMessage?: string) {
  if (err?.response?.status === 404 && notFoundMessage) return notFoundMessage

  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const text = await data.text()
      const parsed = JSON.parse(text)
      if (typeof parsed?.detail === 'string' && parsed.detail.trim()) return parsed.detail
      if (text.trim()) return text
    } catch {
      // Ignore blob parsing failures and fall back below.
    }
  }

  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail
  return fallback
}

function getRtspStatusMeta(status?: string) {
  switch (status) {
    case 'connected':
      return { label: 'Polaczono', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20' }
    case 'connecting':
      return { label: 'Laczenie', className: 'bg-sky-500/15 text-sky-300 border-sky-400/20' }
    case 'reconnecting':
      return { label: 'Reconnect', className: 'bg-amber-500/15 text-amber-300 border-amber-400/20' }
    case 'error':
      return { label: 'Blad', className: 'bg-red-500/15 text-red-300 border-red-400/20' }
    case 'stopped':
      return { label: 'Zatrzymany', className: 'bg-white/10 text-gray-300 border-white/10' }
    default:
      return { label: 'Oczekiwanie', className: 'bg-white/10 text-gray-300 border-white/10' }
  }
}

function prefersFramePreviewMode() {
  if (typeof window === 'undefined') return false
  return /hassio_ingress|\/ingress\//i.test(window.location.pathname)
}

function clearLiveCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

async function drawBlobToCanvas(canvas: HTMLCanvasElement, blob: Blob) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    try {
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width
        canvas.height = bitmap.height
      }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      return
    } finally {
      bitmap.close()
    }
  }

  await new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      try {
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve()
      } catch (err) {
        reject(err)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Nie udalo sie narysowac klatki live'))
    }
    img.src = url
  })
}

export default function Cameras() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<CameraCreate>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')

  const [testState, setTestState] = useState<TestState>('idle')
  const [testError, setTestError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const prevPreview = useRef<string | null>(null)

  const [rtspTestState, setRtspTestState] = useState<TestState>('idle')
  const [rtspTestError, setRtspTestError] = useState('')
  const [rtspPreviewUrl, setRtspPreviewUrl] = useState<string | null>(null)
  const prevRtspPreview = useRef<string | null>(null)
  const [rtspControlState, setRtspControlState] = useState<'idle' | 'starting' | 'stopping'>('idle')
  const [rtspControlError, setRtspControlError] = useState('')

  const [motionState, setMotionState] = useState<Record<number, MotionRuntimeEvent>>({})
  const [liveFrameState, setLiveFrameState] = useState<LiveFrameState>('idle')
  const [livePreviewMode, setLivePreviewMode] = useState<LivePreviewMode>(() => prefersFramePreviewMode() ? 'frame' : 'stream')
  const [livePreviewHint, setLivePreviewHint] = useState('')
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const liveFrameLoadedRef = useRef(false)

  const load = () => getCameras().then(setCameras).catch(() => {}).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  useEffect(() => {
    const es = new EventSource('api/motion/events')
    es.onmessage = (e) => {
      const ev: MotionRuntimeEvent = JSON.parse(e.data)
      setMotionState(current => ({ ...current, [ev.cam_id]: ev }))
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    if (!saveNotice) return
    const timer = window.setTimeout(() => setSaveNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [saveNotice])

  const editingCamera = editId !== null ? cameras.find(cam => cam.id === editId) ?? null : null
  const liveRuntime = editId !== null ? motionState[editId] : undefined
  const liveStatus = liveRuntime?.status ?? (editingCamera?.enabled && editingCamera?.rtsp_url && editingCamera?.rtsp_auto_start ? 'connecting' : 'stopped')
  const liveStatusMeta = getRtspStatusMeta(liveStatus)
  const livePreviewAvailable = Boolean(showForm && editId !== null && editingCamera?.enabled && editingCamera?.rtsp_url)
  const hasPendingRtspChanges = Boolean(
    editingCamera && (
      form.rtsp_url !== editingCamera.rtsp_url ||
      form.username !== editingCamera.username ||
      Boolean(form.password?.trim()) ||
      (form.rtsp_use_snapshot && form.snapshot_url !== editingCamera.snapshot_url) ||
      form.rtsp_auto_start !== editingCamera.rtsp_auto_start ||
      form.rtsp_use_snapshot !== editingCamera.rtsp_use_snapshot ||
      form.motion_threshold !== editingCamera.motion_threshold ||
      form.enabled !== editingCamera.enabled
    )
  )

  useEffect(() => {
    if (!livePreviewAvailable) {
      setLiveFrameState('idle')
      setLivePreviewHint('')
      liveFrameLoadedRef.current = false
      clearLiveCanvas(liveCanvasRef.current)
      return
    }

    setLivePreviewMode(prefersFramePreviewMode() ? 'frame' : 'stream')
    setLivePreviewHint(prefersFramePreviewMode() ? 'Podglad klatka po klatce dla zgodnosci z Home Assistant ingress.' : '')
    liveFrameLoadedRef.current = false
    clearLiveCanvas(liveCanvasRef.current)
    setLiveFrameState('loading')
  }, [livePreviewAvailable, editId, editingCamera?.rtsp_url, editingCamera?.enabled, editingCamera?.motion_threshold])

  useEffect(() => {
    if (!livePreviewAvailable || livePreviewMode !== 'stream' || liveFrameState !== 'loading') return

    const timer = window.setTimeout(() => {
      if (liveFrameLoadedRef.current) return
      setLivePreviewMode('frame')
      setLivePreviewHint('Przelaczono podglad na pojedyncze klatki, bo stream MJPEG nie odpowiedzial.')
      setLiveFrameState('loading')
    }, LIVE_STREAM_FALLBACK_MS)

    return () => window.clearTimeout(timer)
  }, [livePreviewAvailable, livePreviewMode, liveFrameState, editId])

  useEffect(() => {
    if (!livePreviewAvailable || editId === null || livePreviewMode !== 'frame') return

    let cancelled = false
    let inFlight = false
    let timer: number | null = null

    const poll = async () => {
      if (cancelled || inFlight) return
      inFlight = true

      try {
        const response = await fetch(`${getMotionFrameUrl(editId)}?ts=${Date.now()}`, { cache: 'no-store' })
        if (response.ok) {
          const blob = await response.blob()
          const canvas = liveCanvasRef.current
          if (!cancelled && canvas) {
            await drawBlobToCanvas(canvas, blob)
            liveFrameLoadedRef.current = true
            setLiveFrameState('ok')
          }
        } else if (response.status !== 404 && !liveFrameLoadedRef.current) {
          setLiveFrameState('error')
        }
      } catch {
        if (!cancelled && !liveFrameLoadedRef.current) {
          setLiveFrameState('error')
        }
      } finally {
        inFlight = false
        if (!cancelled) {
          timer = window.setTimeout(poll, LIVE_FRAME_POLL_MS)
        }
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [livePreviewAvailable, editId, livePreviewMode, editingCamera?.rtsp_url, editingCamera?.enabled, editingCamera?.motion_threshold])

  const resetTest = () => {
    if (prevPreview.current) { URL.revokeObjectURL(prevPreview.current); prevPreview.current = null }
    setPreviewUrl(null)
    setTestState('idle')
    setTestError('')
  }

  const resetRtspTest = () => {
    if (prevRtspPreview.current) { URL.revokeObjectURL(prevRtspPreview.current); prevRtspPreview.current = null }
    setRtspPreviewUrl(null)
    setRtspTestState('idle')
    setRtspTestError('')
    setRtspControlError('')
    setRtspControlState('idle')
  }

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setEditId(null)
    setError('')
    setSaveNotice('')
    resetTest()
    resetRtspTest()
    setShowForm(true)
  }

  const openEdit = (cam: Camera) => {
    setForm({
      name: cam.name,
      snapshot_url: cam.snapshot_url,
      username: cam.username,
      password: '',
      enabled: cam.enabled,
      auto_capture: cam.auto_capture,
      capture_interval: cam.capture_interval,
      rtsp_url: cam.rtsp_url,
      rtsp_auto_start: cam.rtsp_auto_start,
      rtsp_use_snapshot: cam.rtsp_use_snapshot,
      motion_threshold: cam.motion_threshold,
    })
    setEditId(cam.id)
    setError('')
    setSaveNotice('')
    resetTest()
    resetRtspTest()
    setShowForm(true)
  }

  const handleTest = async () => {
    if (!form.snapshot_url.trim()) { setTestError('Wpisz URL snapshotu'); return }
    resetTest()
    setTestState('loading')
    try {
      const blob = await testSnapshot(form.snapshot_url, form.username ?? '', form.password ?? '', editId ?? undefined)
      const url = URL.createObjectURL(blob)
      prevPreview.current = url
      setPreviewUrl(url)
      setTestState('ok')
    } catch (err: any) {
      const detail = await getApiErrorDetail(err, 'Nie udalo sie pobrac obrazu')
      setTestError(detail)
      setTestState('error')
    }
  }

  const handleRtspTest = async () => {
    if (!form.rtsp_url?.trim()) { setRtspTestError('Wpisz URL RTSP'); return }
    if (editId === null && (!form.username?.trim() || !form.password?.trim())) {
      setRtspTestError('Uzytkownik i haslo sa wymagane do testu RTSP')
      return
    }
    resetRtspTest()
    setRtspTestState('loading')
    try {
      const blob = await testRtsp(form.rtsp_url, form.username ?? '', form.password ?? '', editId ?? undefined)
      const url = URL.createObjectURL(blob)
      prevRtspPreview.current = url
      setRtspPreviewUrl(url)
      setRtspTestState('ok')
    } catch (err: any) {
      const detail = await getApiErrorDetail(
        err,
        'Nie udalo sie pobrac klatki RTSP',
        'Backend add-onu nie ma jeszcze endpointu testu RTSP. Zaktualizuj lub przebuduj add-on.',
      )
      setRtspTestError(detail)
      setRtspTestState('error')
    }
  }

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.snapshot_url.trim()) { setError('Nazwa i URL snapshotu sa wymagane'); return }
    if (editId === null && (!form.username?.trim() || !form.password?.trim())) {
      setError('Uzytkownik i haslo sa wymagane przy dodawaniu kamery')
      return
    }
    setSaving(true)
    setError('')
    setSaveNotice('')
    try {
      let savedCamera: Camera
      if (editId !== null) {
        savedCamera = await updateCamera(editId, form)
        setCameras(current => current.map(cam => cam.id === savedCamera.id ? savedCamera : cam))
        setSaveNotice('Zmiany zapisane poprawnie')
      } else {
        savedCamera = await createCamera(form)
        setCameras(current => [...current, savedCamera])
        setSaveNotice('Kamera dodana poprawnie')
      }
      setEditId(savedCamera.id)
      setForm({
        name: savedCamera.name,
        snapshot_url: savedCamera.snapshot_url,
        username: savedCamera.username,
        password: '',
        enabled: savedCamera.enabled,
        auto_capture: savedCamera.auto_capture,
        capture_interval: savedCamera.capture_interval,
        rtsp_url: savedCamera.rtsp_url,
        rtsp_auto_start: savedCamera.rtsp_auto_start,
        rtsp_use_snapshot: savedCamera.rtsp_use_snapshot,
        motion_threshold: savedCamera.motion_threshold,
      })
      resetTest()
      resetRtspTest()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Blad zapisu'
      setError(detail)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Usunac kamere?')) return
    await deleteCamera(id)
    load()
  }

  const handleToggle = async (cam: Camera) => {
    await updateCamera(cam.id, { enabled: !cam.enabled })
    load()
  }

  const handleStartRtsp = async () => {
    if (editId === null || !editingCamera) return
    setRtspControlState('starting')
    setRtspControlError('')
    try {
      await startCameraRtsp(editId)
      setMotionState(current => ({
        ...current,
        [editId]: {
          cam_id: editId,
          cam_name: editingCamera.name,
          pct: current[editId]?.pct ?? 0,
          status: 'connecting',
          message: 'Nawiazywanie polaczenia RTSP',
          updated_at: Date.now() / 1000,
        },
      }))
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Nie udalo sie uruchomic RTSP'
      setRtspControlError(detail)
    } finally {
      setRtspControlState('idle')
    }
  }

  const handleStopRtsp = async () => {
    if (editId === null || !editingCamera) return
    setRtspControlState('stopping')
    setRtspControlError('')
    try {
      await stopCameraRtsp(editId)
      setMotionState(current => ({
        ...current,
        [editId]: {
          cam_id: editId,
          cam_name: editingCamera.name,
          pct: 0,
          status: 'stopped',
          message: 'RTSP zatrzymany recznie',
          updated_at: Date.now() / 1000,
        },
      }))
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Nie udalo sie zatrzymac RTSP'
      setRtspControlError(detail)
    } finally {
      setRtspControlState('idle')
    }
  }

  const closeForm = () => {
    setShowForm(false)
    setSaveNotice('')
    setError('')
    resetTest()
    resetRtspTest()
  }

  if (loading) return <p className="text-gray-400 text-sm">Ladowanie...</p>

  return (
    <div className={`space-y-4 ${showForm ? 'max-w-7xl' : 'max-w-3xl'}`}>
      {showForm ? (
        <>
          <div className="bg-panel rounded-xl p-5 border border-white/10 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">{editId !== null ? 'Edytuj kamere' : 'Nowa kamera'}</h2>
              <p className="text-xs text-gray-500 mt-1">Lista kamer jest ukryta, dopoki pracujesz na formularzu tej kamery.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                <Check size={14} /> {editId !== null ? 'Zapisz zmiany' : 'Dodaj'}
              </button>
              <button onClick={closeForm} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors">
                Anuluj
              </button>
              <button onClick={closeForm} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10" title="Zamknij">
                <X size={16} />
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {saveNotice && (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {saveNotice}
            </div>
          )}

          <div className="space-y-4">
            <div className="bg-panel rounded-xl p-5 border border-white/10 space-y-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ogolne</p>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs text-gray-400 mb-1 block">Nazwa *</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="np. Brama wjazdowa"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-gray-400 mb-1 block">Uzytkownik {editId === null ? '*' : ''}</span>
                  <input
                    type="text"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    placeholder={editId === null ? 'wymagany' : 'wymagany dla RTSP i snapshotu'}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-gray-400 mb-1 block">Haslo {editId === null ? '*' : ''}</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder={editId !== null ? 'Zostaw puste = bez zmian' : 'wymagane'}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
                  />
                </label>

                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="rounded" />
                  <span className="text-sm text-gray-300">Aktywna</span>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-panel rounded-xl p-5 border border-white/10 space-y-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">HTTP Snapshot</p>

                <label className="block">
                  <span className="text-xs text-gray-400 mb-1 block">URL snapshotu *</span>
                  <input
                    type="url"
                    value={form.snapshot_url}
                    onChange={e => { setForm(f => ({ ...f, snapshot_url: e.target.value })); resetTest() }}
                    placeholder="http://192.168.1.x/snapshot.jpg"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.auto_capture ?? false} onChange={e => setForm(f => ({ ...f, auto_capture: e.target.checked }))} className="rounded" />
                    <span className="text-sm text-gray-300">Auto-przechwytywanie</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Co</span>
                    <input
                      type="number"
                      min={1}
                      max={3600}
                      value={form.capture_interval ?? 30}
                      onChange={e => setForm(f => ({ ...f, capture_interval: Math.max(1, Number(e.target.value)) }))}
                      disabled={!form.auto_capture}
                      className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                    <span className="text-sm text-gray-400">sekund</span>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTest}
                    disabled={testState === 'loading'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                  >
                    {testState === 'loading'
                      ? <><Loader2 size={14} className="animate-spin" /> Pobieranie...</>
                      : <><CameraIcon size={14} /> Testuj polaczenie</>
                    }
                  </button>
                  {testState === 'ok' && <span className="text-xs text-green-400 flex items-center gap-1"><Check size={12} /> Obraz pobrany</span>}
                  {testState === 'error' && <span className="text-xs text-red-400">{testError}</span>}
                </div>

                {previewUrl && (
                  <div className="rounded-lg overflow-hidden bg-black/40">
                    <img src={previewUrl} alt="Podglad HTTP" className="w-full rounded-lg" />
                  </div>
                )}
              </div>

              <div className="bg-panel rounded-xl p-5 border border-white/10 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    RTSP <span className="text-gray-600 normal-case font-normal">(opcjonalne - detekcja ruchu, rownolegle z HTTP)</span>
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-3 min-w-0">
                    <label className="block">
                      <span className="text-xs text-gray-400 mb-1 block">URL strumienia RTSP</span>
                      <input
                        type="text"
                        value={form.rtsp_url ?? ''}
                        onChange={e => { setForm(f => ({ ...f, rtsp_url: e.target.value })); resetRtspTest() }}
                        placeholder="rtsp://192.168.1.x:554/stream"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500"
                      />
                    </label>
                    <p className="text-[11px] text-gray-500">Nie wpisuj loginu i hasla do URL RTSP. Worker i test RTSP biora dane logowania z pol Uzytkownik i Haslo.</p>

                    <label className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 whitespace-nowrap">Prog ruchu (%)</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={form.motion_threshold ?? 10}
                        onChange={e => setForm(f => ({ ...f, motion_threshold: Number(e.target.value) }))}
                        className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
                      />
                      <span className="text-xs text-gray-600">zmiana klatek powyzej tej wartosci wyzwala analize</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.rtsp_auto_start ?? true}
                        onChange={e => setForm(f => ({ ...f, rtsp_auto_start: e.target.checked }))}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-300">Uruchamiaj RTSP automatycznie</span>
                    </label>

                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.rtsp_use_snapshot ?? false}
                        onChange={e => setForm(f => ({ ...f, rtsp_use_snapshot: e.target.checked }))}
                        className="rounded mt-0.5"
                      />
                      <span className="text-sm text-gray-300">
                        Wysylaj do analizy przez snapshot
                        <span className="block text-xs text-gray-500 mt-1">
                          RTSP sluzy wtedy tylko do detekcji ruchu. Po przekroczeniu progu aplikacja pobiera HTTP snapshot z ustawien powyzej i ten obraz wysyla do LPR.
                        </span>
                      </span>
                    </label>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleRtspTest}
                        disabled={rtspTestState === 'loading' || !form.rtsp_url?.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                      >
                        {rtspTestState === 'loading'
                          ? <><Loader2 size={14} className="animate-spin" /> Pobieranie...</>
                          : <><CameraIcon size={14} /> Testuj RTSP</>
                        }
                      </button>
                      {rtspTestState === 'ok' && <span className="text-xs text-green-400 flex items-center gap-1"><Check size={12} /> Klatka pobrana</span>}
                      {rtspTestState === 'error' && <span className="text-xs text-red-400">{rtspTestError}</span>}
                    </div>

                    {rtspPreviewUrl && (
                      <div className="rounded-lg overflow-hidden bg-black/40">
                        <img src={rtspPreviewUrl} alt="Podglad RTSP" className="w-full rounded-lg" />
                      </div>
                    )}
                  </div>

                  <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-3 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Podglad live RTSP</p>
                        <p className="text-xs text-gray-500 mt-1">Tu widzisz stan aktualnie uruchomionego worker-a RTSP dla zapisanej kamery.</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${liveStatusMeta.className}`}>
                        {liveStatusMeta.label}
                      </span>
                    </div>

                    {editId === null && (
                      <p className="text-xs text-gray-500">Podglad live pojawi sie po zapisaniu kamery z RTSP.</p>
                    )}

                    {editId !== null && !editingCamera?.rtsp_url && (
                      <p className="text-xs text-gray-500">Ta kamera nie ma jeszcze zapisanego URL RTSP. Zapisz konfiguracje, aby uruchomic worker.</p>
                    )}

                    {editId !== null && editingCamera?.rtsp_url && !editingCamera.enabled && (
                      <p className="text-xs text-gray-500">Kamera jest aktualnie wylaczona. Zapisz ja jako aktywna, aby uruchomic podglad i detekcje ruchu.</p>
                    )}

                    {editId !== null && editingCamera?.rtsp_url && !editingCamera.rtsp_auto_start && (
                      <p className="text-xs text-gray-500">Autostart RTSP jest wylaczony. Uzyj przycisku Start, jesli chcesz uruchomic worker recznie.</p>
                    )}

                    {livePreviewAvailable && editId !== null && (
                      <>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleStartRtsp}
                            disabled={rtspControlState !== 'idle' || hasPendingRtspChanges || !editingCamera?.enabled || !editingCamera?.rtsp_url}
                            className="px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                          >
                            {rtspControlState === 'starting' ? 'Start...' : 'Start'}
                          </button>
                          <button
                            onClick={handleStopRtsp}
                            disabled={rtspControlState !== 'idle' || !editingCamera?.rtsp_url}
                            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                          >
                            {rtspControlState === 'stopping' ? 'Stop...' : 'Stop'}
                          </button>
                        </div>

                        <div className="rounded-lg bg-black/50 border border-white/5 min-h-52 overflow-hidden relative flex items-center justify-center">
                          {liveFrameState === 'loading' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Loader2 size={24} className="animate-spin text-gray-500" />
                            </div>
                          )}
                          {liveFrameState === 'error' && (
                            <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-gray-500">
                              Brak aktualnej klatki live. Strumien moze byc jeszcze zestawiany albo restartowany.
                            </div>
                          )}
                          {livePreviewMode === 'stream' ? (
                            <img
                              key={`${editId}-${editingCamera?.rtsp_url}-${editingCamera?.enabled}-${editingCamera?.motion_threshold}`}
                              src={`${getMotionStreamUrl(editId)}?v=${encodeURIComponent(`${editingCamera?.rtsp_url ?? ''}|${editingCamera?.enabled ?? false}|${editingCamera?.motion_threshold ?? 0}`)}`}
                              alt="Live RTSP"
                              className={`w-full h-full object-cover ${liveFrameState === 'ok' ? 'opacity-100' : 'opacity-0 absolute'}`}
                              onLoad={() => {
                                liveFrameLoadedRef.current = true
                                setLiveFrameState('ok')
                              }}
                              onError={() => {
                                liveFrameLoadedRef.current = false
                                setLivePreviewMode('frame')
                                setLivePreviewHint('Przelaczono podglad na pojedyncze klatki, bo stream MJPEG nie mogl zostac wyswietlony.')
                                setLiveFrameState('loading')
                              }}
                            />
                          ) : (
                            <canvas
                              ref={liveCanvasRef}
                              className={`w-full h-full object-cover ${liveFrameState === 'ok' ? 'opacity-100' : 'opacity-0 absolute'}`}
                            />
                          )}
                        </div>

                        {livePreviewHint && (
                          <p className="text-[11px] text-gray-500">{livePreviewHint}</p>
                        )}

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-gray-400">
                            <span>Detekcja ruchu</span>
                            <span>{(liveRuntime?.pct ?? 0).toFixed(1)}%</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden bg-white/10">
                            <div
                              className={`h-full rounded-full transition-all duration-200 ${(liveRuntime?.pct ?? 0) > 20 ? 'bg-red-500' : (liveRuntime?.pct ?? 0) > 5 ? 'bg-yellow-500' : 'bg-slate-500'}`}
                              style={{ width: `${Math.min(liveRuntime?.pct ?? 0, 100)}%` }}
                            />
                          </div>
                        </div>

                        <div className="rounded-lg bg-white/5 border border-white/5 px-3 py-2">
                          <p className="text-xs text-gray-300">{liveRuntime?.message || 'Oczekiwanie na pierwsze dane ze strumienia RTSP.'}</p>
                        </div>

                        {rtspControlError && (
                          <p className="text-xs text-red-400">{rtspControlError}</p>
                        )}

                        {hasPendingRtspChanges && (
                          <p className="text-xs text-amber-300">
                            Masz niezapisane zmiany RTSP lub danych logowania. Test jednej klatki uzywa formularza, ale worker live nadal dziala na ostatnio zapisanej konfiguracji.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">
              Kamery <span className="ml-1 bg-slate-600 text-white rounded-full px-2 py-0.5 text-xs">{cameras.length}</span>
            </h2>
            <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded-lg text-sm font-medium transition-colors">
              <Plus size={14} /> Dodaj kamere
            </button>
          </div>

          {cameras.length === 0 ? (
            <div className="bg-panel rounded-xl p-8 border border-white/5 text-center text-gray-500 text-sm">
              Brak kamer. Dodaj pierwsza kamere przyciskiem powyzej.
            </div>
          ) : (
            <div className="bg-panel rounded-xl border border-white/5 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-gray-500">
                    <th className="px-4 py-3">Nazwa</th>
                    <th className="px-4 py-3">URL snapshotu</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.map(cam => (
                    <tr key={cam.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium text-gray-200">
                        {cam.name}
                        {cam.rtsp_url && <span className="ml-1.5 text-xs text-slate-400 font-normal">RTSP</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs max-w-xs truncate">{cam.snapshot_url}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button onClick={() => handleToggle(cam)} className="flex items-center gap-1 text-xs">
                            {cam.enabled
                              ? <><ToggleRight size={18} className="text-green-400" /><span className="text-green-400">Aktywna</span></>
                              : <><ToggleLeft size={18} className="text-gray-500" /><span className="text-gray-500">Wylaczona</span></>}
                          </button>
                          {cam.auto_capture && (
                            <span className="flex items-center gap-1 text-xs text-gray-400">
                              <Clock size={12} /> co {cam.capture_interval}s
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => openEdit(cam)} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors" title="Edytuj">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => handleDelete(cam.id)} className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors" title="Usun">
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
        </>
      )}
    </div>
  )
}
