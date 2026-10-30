import type { Dataset, Job, ModelVersion, Project } from '../types'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const TOKEN_KEY = 'neurolab.access-token'

export interface AuthUser {
  id: number
  email: string
  display_name: string
  role: string
  status: string
}

export interface ApiArchitecture {
  id: number
  project_id: number
  name: string
  family: 'CNN'
  version: number
  config: CnnArchitecture
}
export interface SavedArchitecture {
  id: number
  projectId: string
  name: string
  config: CnnArchitecture
}

export interface CnnLayerConfig {
  type: 'Conv2D' | 'MaxPooling2D' | 'Flatten' | 'Dense' | 'Dropout'
  filters?: number | null
  units?: number | null
  kernel_size?: number | null
  activation?: 'relu' | 'softmax' | 'sigmoid' | 'tanh' | 'linear'
  rate?: number | null
}

export interface CnnArchitecture {
  name: string
  input_height: number
  input_width: number
  input_channels: 1 | 3 | 4
  layers: CnnLayerConfig[]
}

export interface ApiDataset {
  id: number
  project_id: number
  name: string
  filename: string
  version: number
  status: string
  metadata: { classes: string[]; class_count: number; images: number }
}
export interface TrainingMetric {
  epoch: number
  name: string
  value: number
  recorded_at: string
}
export interface ApiMember { id: number; user_id: number; display_name: string; email: string; role: string; is_owner?: boolean }
export interface ApiAdminUser { id: number; email: string; display_name: string; role: string; status: string }
export interface AdminSettings { max_active_jobs: number; max_upload_mb: number; retention_days: number }
export interface AdminHealth { api: string; database: string; worker: string; ml_engine: string }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null) as { detail?: string } | null
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem(TOKEN_KEY)
    throw new Error(body?.detail || `La API respondió con el estado ${response.status}.`)
  }
  return body as T
}

export const api = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
  async login(email: string, password: string) {
    return request<{ access_token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },
  async register(email: string, display_name: string, password: string) {
    return request<{ access_token: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, display_name, password }),
    })
  },
  me: () => request<AuthUser>('/auth/me'),
  listProjects: () => request<Project[]>('/projects'),
  createProject: (body: { name: string; description: string; family: 'CNN' }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: { name: string; description: string; family: 'CNN' }) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listMembers: (projectId: string) => request<ApiMember[]>(`/projects/${projectId}/members`),
  addMember: (projectId: string, email: string, role: string) =>
    request<ApiMember>(`/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  removeMember: (projectId: string, userId: number) =>
    request<void>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
  listJobs: () => request<Job[]>('/training-jobs'),
  listDatasets: (projectId: string) => request<ApiDataset[]>(`/projects/${projectId}/datasets`),
  listArchitectures: (projectId: string) => request<ApiArchitecture[]>(`/projects/${projectId}/architectures`),
  listModels: (projectId: string) => request<ModelVersion[]>(`/projects/${projectId}/models`),
  listMetrics: (jobId: string) => request<TrainingMetric[]>(`/training-jobs/${jobId}/metrics`),
  uploadDataset: (projectId: string, name: string, file: File) => {
    const body = new FormData()
    body.set('name', name)
    body.set('file', file)
    return request<ApiDataset>(`/projects/${projectId}/datasets`, { method: 'POST', body })
  },
  deleteDataset: (id: string) => request<void>(`/datasets/${id}`, { method: 'DELETE' }),
  saveArchitecture: (projectId: string, body: CnnArchitecture) =>
    request<ApiArchitecture>(`/projects/${projectId}/architectures`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  startTraining: (projectId: string, body: {
    architecture_id: number
    dataset_id: number
    epochs: number
    batch_size: number
    optimizer: string
  }) => request<Job>(`/projects/${projectId}/training-jobs`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  cancelTraining: (id: string) =>
    request<Job>(`/training-jobs/${id}/cancel`, { method: 'POST' }),
  setModelStatus: (id: string, status: ModelVersion['status']) =>
    request<{ id: string; status: ModelVersion['status'] }>(
      `/models/${id}/status?status=${encodeURIComponent(status)}`,
      { method: 'PATCH' },
    ),
  createModelVersion: (jobId: string) =>
    request<{ id: string; version: number; checksum: string; status: string }>(
      `/training-jobs/${jobId}/models`,
      { method: 'POST' },
    ),
  async downloadModel(id: string) {
    const token = localStorage.getItem(TOKEN_KEY)
    const response = await fetch(`${API_BASE}/models/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(body?.detail || 'No se pudo descargar el artefacto.')
    }
    return response.blob()
  },
  async downloadProjectReport(projectId: string) {
    const token = localStorage.getItem(TOKEN_KEY)
    const response = await fetch(`${API_BASE}/projects/${projectId}/report.pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(body?.detail || 'No se pudo generar el PDF.')
    }
    return response.blob()
  },
  listAdminUsers: () => request<ApiAdminUser[]>('/admin/users'),
  listAdminAudit: () => request<Array<{ id: number; actor_id: number; project_id: number | null; action: string; created_at: string }>>('/admin/audit-events'),
  getAdminSettings: () => request<AdminSettings>('/admin/settings'),
  saveAdminSettings: (settings: AdminSettings) => request<AdminSettings>('/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  }),
  adminHealth: () => request<AdminHealth>('/admin/health'),
  updateUserRole: (id: number, role: string) =>
    request<ApiAdminUser>(`/admin/users/${id}/role?role=${encodeURIComponent(role)}`, { method: 'PATCH' }),
  updateUserStatus: (id: number, status: string) =>
    request<ApiAdminUser>(`/admin/users/${id}/status?status=${encodeURIComponent(status)}`, { method: 'PATCH' }),
}

export function mapDataset(dataset: ApiDataset): Dataset {
  return {
    id: String(dataset.id),
    projectId: String(dataset.project_id),
    name: dataset.name,
    rows: String(dataset.metadata.images),
    features: dataset.metadata.class_count,
    format: 'Imágenes',
    status: dataset.status,
    updated: `v${dataset.version}`,
  }
}

export function mapArchitecture(architecture: ApiArchitecture) {
  return {
    id: architecture.id,
    projectId: String(architecture.project_id),
    name: architecture.name,
    config: architecture.config,
  }
}

export async function watchTraining(
  jobId: string,
  onUpdate: (job: Job) => void,
  signal: AbortSignal,
) {
  const token = localStorage.getItem(TOKEN_KEY)
  const response = await fetch(`${API_BASE}/training-jobs/${jobId}/events`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  })
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || 'No se pudo conectar al seguimiento del entrenamiento.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() || ''
    for (const event of events) {
      const data = event.split('\n').find(line => line.startsWith('data: '))?.slice(6)
      if (data) onUpdate(JSON.parse(data) as Job)
    }
  }
}
