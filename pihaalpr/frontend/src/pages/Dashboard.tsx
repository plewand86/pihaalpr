import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'

import { AppSettingsTestResult, Camera, Detection, clearDetections, getCameras, getDetectionImageUrl, getDetections, getMotionFrameUrl, getSnapshotUrl, getWhitelist, testAppSettings } from '../api/client'

interface MotionEvent {
  cam_id: number
  cam_name: string
  pct: number
  status?: string
  message?: string
}

type PreviewState = 'loading' | 'ok' | 'error'

const CAMERAS_REFRESH_MS = 5000
const DETECTIONS_REFRESH_MS = 1000
const SNAPSHOT_REFRESH_MS = 5000
const LIVE_FRAME_POLL_MS = 500
const LIVE_FRAME_ERROR_AFTER_MS = 4000
const LICENSE_STATUS_LABEL: Record<AppSettingsTestResult['status'], string> = {
  ok: 'Aktywna',
  bad_key: 'Nieaktywna',
  missing_key: 'Nieaktywna',
  error: 'Nieaktywna',
}

function parseDetectionDate(value: string) {
  if (!value) return new Date(NaN)
  if (/([zZ]|[+-]\d{2}:\d{2})$/.test(value)) return new Date(value)
  return new Date(`${value}Z`)
}

function formatDetectionTime(value: string) {
  const date = parseDetectionDate(value)
  if (Number.isNaN(date.getTime())) return '-'
  return format(date, 'HH:mm:ss')
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
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
      reject(new Error('Nie udalo sie narysowac podgladu RTSP'))
    }
    img.src = url
  })
}

function SnapshotPreview({ cameraId, cameraName }: { cameraId: number; cameraName: string }) {
  const [refreshTs, setRefreshTs] = useState(Date.now())
  const [state, setState] = useState<PreviewState>('loading')

  useEffect(() => {
    setState('loading')
    const timer = window.setInterval(() => {
      setState('loading')
      setRefreshTs(Date.now())
    }, SNAPSHOT_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [cameraId])

  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-black/40 flex items-center justify-center min-h-40 relative overflow-hidden">
        {state === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-gray-600" />
          </div>
        )}
        {state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-600">
            <ImageOff size={28} />
            <span className="text-xs">Brak obrazu z tej kamery</span>
          </div>
        )}
        <img
          key={`${cameraId}-${refreshTs}`}
          src={`${getSnapshotUrl(cameraId)}?t=${refreshTs}`}
          alt={`snapshot ${cameraName}`}
          className={`max-w-full rounded-lg transition-opacity duration-200 ${state === 'ok' ? 'opacity-100' : 'opacity-0 absolute'}`}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      </div>
      <p className="text-[11px] text-gray-500">Snapshot odswiezany co {SNAPSHOT_REFRESH_MS / 1000}s bez wyzwalania analityki.</p>
    </div>
  )
}

function RtspPreview({ cameraId, runtime }: { cameraId: number; runtime?: MotionEvent }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [state, setState] = useState<PreviewState>('loading')

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    const startedAt = Date.now()

    setState('loading')
    clearCanvas(canvasRef.current)

    const poll = async () => {
      try {
        const response = await fetch(`${getMotionFrameUrl(cameraId)}?ts=${Date.now()}`, { cache: 'no-store' })
        if (response.ok) {
          const blob = await response.blob()
          const canvas = canvasRef.current
          if (!cancelled && canvas) {
            await drawBlobToCanvas(canvas, blob)
            setState('ok')
          }
        } else if (!cancelled && Date.now() - startedAt >= LIVE_FRAME_ERROR_AFTER_MS) {
          setState('error')
        }
      } catch {
        if (!cancelled && Date.now() - startedAt >= LIVE_FRAME_ERROR_AFTER_MS) {
          setState('error')
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(poll, LIVE_FRAME_POLL_MS)
        }
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      clearCanvas(canvasRef.current)
    }
  }, [cameraId])

  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-black/40 flex items-center justify-center min-h-40 relative overflow-hidden">
        {state === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-gray-600" />
          </div>
        )}
        {state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-gray-600">
            <ImageOff size={28} />
            <span className="text-xs">Brak aktualnej klatki RTSP. Strumien moze byc jeszcze zestawiany.</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-cover ${state === 'ok' ? 'opacity-100' : 'opacity-0 absolute'}`}
        />
      </div>
      <p className="text-[11px] text-gray-500">{runtime?.message || 'Podglad live z aktualnie przetwarzanego strumienia RTSP.'}</p>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [cameras, setCameras] = useState<Camera[]>([])
  const [detections, setDetections] = useState<Detection[]>([])
  const [motion, setMotion] = useState<Record<number, MotionEvent>>({})
  const [whitelistPlates, setWhitelistPlates] = useState<Record<string, boolean>>({})
  const [licenseStatus, setLicenseStatus] = useState<AppSettingsTestResult | null>(null)
  const [licenseLoading, setLicenseLoading] = useState(true)
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null)
  const [detectionImageState, setDetectionImageState] = useState<PreviewState>('loading')

  const dashboardCameras = cameras.filter(cam => cam.enabled)

  const loadCameras = useCallback(() => {
    getCameras().then(setCameras).catch(() => {})
  }, [])

  const loadDetections = useCallback(() => {
    getDetections().then(setDetections).catch(() => {})
  }, [])

  const loadWhitelist = useCallback(() => {
    getWhitelist()
      .then(entries => {
        const activePlates = Object.fromEntries(
          entries
            .filter(entry => entry.enabled)
            .map(entry => [entry.plate.trim().toUpperCase(), true]),
        )
        setWhitelistPlates(activePlates)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadCameras()
    const timer = window.setInterval(loadCameras, CAMERAS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loadCameras])

  useEffect(() => {
    loadDetections()
    const timer = window.setInterval(loadDetections, DETECTIONS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loadDetections])

  useEffect(() => {
    loadWhitelist()
    const timer = window.setInterval(loadWhitelist, CAMERAS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loadWhitelist])

  useEffect(() => {
    let active = true

    const runLicenseTest = async () => {
      setLicenseLoading(true)
      try {
        const result = await testAppSettings({ lpr_api_url: '', lpr_api_key: '' })
        if (active) setLicenseStatus(result)
      } catch {
        if (active) {
          setLicenseStatus({
            status: 'error',
            detail: 'Nie udalo sie sprawdzic statusu licencji przy otwieraniu dashboardu.',
          })
        }
      } finally {
        if (active) setLicenseLoading(false)
      }
    }

    void runLicenseTest()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const es = new EventSource('api/motion/events')
    es.onmessage = (e) => {
      const ev: MotionEvent = JSON.parse(e.data)
      if (ev.cam_name) setMotion(current => ({ ...current, [ev.cam_id]: ev }))
    }
    return () => es.close()
  }, [])

  useEffect(() => {
    if (!selectedDetection) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedDetection(null)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedDetection])

  const licenseOk = licenseStatus?.status === 'ok'

  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${
          licenseLoading
            ? 'bg-slate-500/10 border-slate-400/20'
            : licenseOk
              ? 'bg-green-500/10 border-green-400/30'
              : 'bg-red-500/10 border-red-400/25'
        }`}
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-300">Status licencji LPR</p>
          <p className={`mt-1 text-sm ${licenseLoading ? 'text-gray-300' : licenseOk ? 'text-green-200' : 'text-red-200'}`}>
            {licenseLoading ? 'Trwa jednorazowe sprawdzenie licencji...' : licenseStatus?.detail || 'Brak danych o licencji.'}
          </p>
        </div>
        <div
          className={`shrink-0 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
            licenseLoading
              ? 'bg-white/10 text-gray-200'
              : licenseOk
                ? 'bg-green-500/15 text-green-300'
                : 'bg-red-500/15 text-red-300'
          }`}
        >
          {licenseLoading && <Loader2 size={14} className="animate-spin" />}
          {licenseLoading ? 'Sprawdzanie...' : LICENSE_STATUS_LABEL[licenseStatus?.status || 'error']}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] gap-6 items-start">
      <div className="bg-panel rounded-xl p-4 border border-white/5 flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          Kamery <span className="ml-1 bg-slate-600 text-white rounded-full px-2 py-0.5 text-xs">{dashboardCameras.length}</span>
        </h2>

        {dashboardCameras.length === 0 ? (
          <div className="rounded-lg border border-white/5 bg-black/20 min-h-40 flex items-center justify-center">
            <p className="text-sm text-gray-500">Brak aktywnych kamer</p>
          </div>
        ) : (
          <div className="space-y-4">
            {dashboardCameras.map(cam => {
              const motionEvent = motion[cam.id]
              const motionPct = motionEvent?.status === 'stopped' ? 0 : (motionEvent?.pct ?? 0)

              return (
                <div key={cam.id} className="rounded-xl border border-white/5 bg-black/20 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-200">{cam.name}</p>
                      <p className="text-[11px] text-gray-500 font-mono truncate">{cam.rtsp_url || cam.snapshot_url}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] text-gray-400">
                      {cam.rtsp_url ? 'RTSP Live' : 'HTTP Live'}
                    </span>
                  </div>

                  {cam.rtsp_url ? (
                    <>
                      <RtspPreview cameraId={cam.id} runtime={motionEvent} />
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span>Ruch RTSP</span>
                          <span>{motionPct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-200 ${motionPct > 20 ? 'bg-red-500' : motionPct > 5 ? 'bg-yellow-500' : 'bg-slate-500'}`}
                            style={{ width: `${Math.min(motionPct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <SnapshotPreview cameraId={cam.id} cameraName={cam.name} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="bg-panel rounded-xl p-4 border border-white/5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            Wykrycia <span className="ml-1 bg-slate-600 text-white rounded-full px-2 py-0.5 text-xs">{detections.length}</span>
          </h2>
          <button
            onClick={() => { clearDetections().catch(() => {}); setDetections([]) }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} /> Wyczysc
          </button>
        </div>

        {detections.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">Brak wykryc - nasluchiwanie...</p>
        ) : (
          <div className="overflow-auto max-h-[36rem] pr-1 space-y-3">
            {detections.map(d => {
              const isWhitelisted = Boolean(whitelistPlates[d.plate.trim().toUpperCase()])

              return (
                <div
                  key={d.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    isWhitelisted
                      ? 'border-green-500/30 bg-green-500/5'
                      : 'border-red-500/15 bg-red-500/[0.04]'
                  }`}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-mono font-bold tracking-widest px-2.5 py-1 rounded-lg text-sm border ${
                            isWhitelisted
                              ? 'bg-green-500/15 border-green-400/30 text-green-200'
                              : 'bg-red-500/10 border-red-400/20 text-red-100'
                          }`}
                        >
                          {d.plate}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isWhitelisted
                              ? 'bg-green-500/15 text-green-300'
                              : 'bg-red-500/10 text-red-300'
                          }`}
                        >
                          {isWhitelisted ? 'Biala lista' : 'Poza biala lista'}
                        </span>
                        <span className="text-xs text-gray-500">{formatDetectionTime(d.detected_at)}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-400">
                        <span>Kamera: <span className="text-gray-300">{d.camera_name || '-'}</span></span>
                        <div className="flex items-center gap-2">
                          <span>Pewnosc</span>
                          <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isWhitelisted ? 'bg-green-400' : 'bg-slate-400'}`}
                              style={{ width: `${d.confidence}%` }}
                            />
                          </div>
                          <span className="text-gray-300">{d.confidence}%</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {d.has_image ? (
                        <button
                          onClick={() => {
                            setSelectedDetection(d)
                            setDetectionImageState('loading')
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 text-xs text-slate-200 hover:bg-white/20 transition-colors"
                        >
                          <Search size={12} /> Zdjecie
                        </button>
                      ) : (
                        <span className="px-2.5 py-1.5 rounded-lg bg-black/20 text-xs text-gray-500">Brak zdjecia</span>
                      )}

                      {isWhitelisted ? (
                        <span className="px-2.5 py-1.5 rounded-lg bg-green-500/15 text-xs text-green-300">
                          Na bialej liscie
                        </span>
                      ) : (
                        <button
                          onClick={() => navigate(`/whitelist?plate=${encodeURIComponent(d.plate.trim().toUpperCase())}`)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600/80 text-xs text-white hover:bg-green-500 transition-colors"
                        >
                          <Plus size={12} /> Dodaj do bialej listy
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedDetection && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedDetection(null)}
        >
          <div
            className="w-full max-w-5xl bg-panel border border-white/10 rounded-xl overflow-hidden shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-200">Wykrycie {selectedDetection.plate}</h3>
                <p className="text-xs text-gray-500 mt-1">
                  {selectedDetection.camera_name || '-'} - {formatDetectionTime(selectedDetection.detected_at)} - {selectedDetection.confidence}%
                </p>
              </div>
              <button
                onClick={() => setSelectedDetection(null)}
                className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                title="Zamknij"
              >
                <X size={16} />
              </button>
            </div>

            <div className="bg-black/60 min-h-[20rem] max-h-[75vh] flex items-center justify-center relative">
              {detectionImageState === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={28} className="animate-spin text-gray-500" />
                </div>
              )}
              {detectionImageState === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500">
                  <ImageOff size={30} />
                  <span className="text-sm">Nie udalo sie pobrac zdjecia dla tego wykrycia.</span>
                </div>
              )}
              <img
                src={`${getDetectionImageUrl(selectedDetection.id)}?t=${encodeURIComponent(selectedDetection.detected_at)}`}
                alt={`Wykrycie ${selectedDetection.plate}`}
                className={`max-w-full max-h-[75vh] ${detectionImageState === 'ok' ? 'opacity-100' : 'opacity-0 absolute'}`}
                onLoad={() => setDetectionImageState('ok')}
                onError={() => setDetectionImageState('error')}
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
