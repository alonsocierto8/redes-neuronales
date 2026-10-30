export type PageKey = 'dashboard' | 'projects' | 'fundamentals' | 'architectures' | 'datasets' | 'training' | 'evaluation' | 'models' | 'reports' | 'admin'
export type Family = 'CNN'
export type JobStatus = 'Completado' | 'Ejecutando' | 'Preparando' | 'En cola' | 'Fallido' | 'Cancelado'
export interface Project { id: string; name: string; description: string; family: Family; status: 'Activo' | 'Borrador' | 'Archivado'; owner: string; updated: string; progress: number }
export interface Layer { id: string; type: 'Conv2D' | 'MaxPooling2D' | 'Flatten' | 'Dense' | 'Dropout'; units: number; activation: string; shape: string; filters?: number; kernelSize?: number; rate?: number }
export interface Dataset { id: string; projectId: string; name: string; rows: string; features: number; format: string; status: string; updated: string }
export interface Job { id: string; project: string; family: Family; status: JobStatus; progress: number; epoch: number; epochs: number; loss: number; accuracy: number; duration: string; date: string; dataset: string; error?: string | null }
export interface ModelVersion { id: string; name: string; version: string; family: Family; status: 'Borrador' | 'Revisado' | 'Aprobado' | 'Retirado'; accuracy: number; date: string; jobId: string; checksum?: string }
