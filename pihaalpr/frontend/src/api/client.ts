import axios from 'axios'

const api = axios.create({ baseURL: 'api' })

export interface Detection {
  id: number
  plate: string
  confidence: number
  camera_name: string
  detected_at: string
  has_image: boolean
}

export interface AppSettings {
  lpr_api_url: string
  lpr_api_key: string
  min_confidence: number
  min_chars: number
  min_width: number
  mqtt_topic: string
}

export interface AppSettingsTestResult {
  status: 'ok' | 'bad_key' | 'missing_key' | 'error'
  detail: string
}

export interface Camera {
  id: number
  name: string
  snapshot_url: string
  username: string
  enabled: boolean
  auto_capture: boolean
  capture_interval: number
  rtsp_url: string
  rtsp_auto_start: boolean
  rtsp_use_snapshot: boolean
  motion_threshold: number
  created_at: string
}

export interface CameraCreate {
  name: string
  snapshot_url: string
  username?: string
  password?: string
  enabled?: boolean
  auto_capture?: boolean
  capture_interval?: number
  rtsp_url?: string
  rtsp_auto_start?: boolean
  rtsp_use_snapshot?: boolean
  motion_threshold?: number
}

export interface CameraUpdate {
  name?: string
  snapshot_url?: string
  username?: string
  password?: string
  enabled?: boolean
  auto_capture?: boolean
  capture_interval?: number
  rtsp_url?: string
  rtsp_auto_start?: boolean
  rtsp_use_snapshot?: boolean
  motion_threshold?: number
}

export interface MotionRuntimeEvent {
  cam_id: number
  cam_name: string
  pct: number
  status: string
  message: string
  updated_at: number
}

export const getAppSettings = () => api.get<AppSettings>('/settings').then(r => r.data)
export const updateAppSettings = (data: AppSettings) => api.put('/settings', data).then(r => r.data)
export const testAppSettings = (data: Pick<AppSettings, 'lpr_api_url' | 'lpr_api_key'>) =>
  api.post<AppSettingsTestResult>('/settings/test', data).then(r => r.data)

export const testSnapshot = (snapshot_url: string, username: string, password: string, camera_id?: number) =>
  api.post('capture/test', { snapshot_url, username, password, camera_id }, { responseType: 'blob' }).then(r => r.data as Blob)

export const testRtsp = (rtsp_url: string, username: string, password: string, camera_id?: number) =>
  api.post('capture/rtsp_test', { rtsp_url, username, password, camera_id }, { responseType: 'blob' }).then(r => r.data as Blob)

export const getCameras = () => api.get<Camera[]>('/cameras').then(r => r.data)
export const createCamera = (data: CameraCreate) => api.post<Camera>('/cameras', data).then(r => r.data)
export const updateCamera = (id: number, data: CameraUpdate) => api.put<Camera>(`/cameras/${id}`, data).then(r => r.data)
export const deleteCamera = (id: number) => api.delete(`/cameras/${id}`).then(r => r.data)
export const startCameraRtsp = (id: number) => api.post(`/cameras/${id}/rtsp/start`).then(r => r.data)
export const stopCameraRtsp = (id: number) => api.post(`/cameras/${id}/rtsp/stop`).then(r => r.data)

export interface WhitelistEntry {
  id: number
  plate: string
  description: string
  ha_domain: string
  ha_service: string
  entity_id: string
  service_data: string
  enabled: boolean
  created_at: string
}

export interface WhitelistEntryCreate {
  plate: string
  description?: string
  ha_domain?: string
  ha_service?: string
  entity_id?: string
  service_data?: string
  enabled?: boolean
}

export interface WhitelistEntryUpdate {
  plate?: string
  description?: string
  ha_domain?: string
  ha_service?: string
  entity_id?: string
  service_data?: string
  enabled?: boolean
}

export interface HAEntity {
  entity_id: string
  friendly_name: string
  state: string
  domain: string
}

export const getHAEntities = (domain = '', search = '') =>
  api.get<HAEntity[]>(`/ha/entities?domain=${domain}&search=${search}`).then(r => r.data)

export const getWhitelist = () => api.get<WhitelistEntry[]>('/whitelist').then(r => r.data)
export const createWhitelistEntry = (data: WhitelistEntryCreate) => api.post<WhitelistEntry>('/whitelist', data).then(r => r.data)
export const updateWhitelistEntry = (id: number, data: WhitelistEntryUpdate) => api.put<WhitelistEntry>(`/whitelist/${id}`, data).then(r => r.data)
export const deleteWhitelistEntry = (id: number) => api.delete(`/whitelist/${id}`).then(r => r.data)
export const testWhitelistEntry = (id: number) => api.post(`/whitelist/${id}/test`).then(r => r.data)

export const getDetections = (limit = 100) => api.get<Detection[]>(`/detections?limit=${limit}`).then(r => r.data)
export const getDetectionImageUrl = (detectionId: number) => `api/detections/${detectionId}/image`
export const clearDetections = () => api.delete('/detections').then(r => r.data)
export const triggerCapture = () => api.post('/capture/trigger').then(r => r.data)
export const getSnapshotUrl = (cameraId?: number) =>
  cameraId ? `api/capture/snapshot/${cameraId}` : 'api/capture/snapshot'
export const getMotionFrameUrl = (cameraId: number) => `api/motion/frame/${cameraId}`
export const getMotionStreamUrl = (cameraId: number) => `api/motion/stream/${cameraId}`
