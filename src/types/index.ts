export type PageKey = 'dashboard' | 'projects' | 'fundamentals' | 'architectures' | 'datasets' | 'training' | 'evaluation' | 'models' | 'reports' | 'admin'
export type Family = 'Feedforward' | 'RNN' | 'CNN' | 'GAN'
export type JobStatus = 'Completado' | 'Ejecutando' | 'En cola' | 'Fallido' | 'Cancelado'
export interface Project { id: string; name: string; description: string; family: Family; status: 'Activo' | 'Borrador' | 'Archivado'; owner: string; updated: string; progress: number }
export interface Layer { id: string; type: string; units: number; activation: string; shape: string }
export interface Dataset { id: string; name: string; rows: string; features: number; format: string; status: string; updated: string }
export interface Job { id: string; project: string; family: Family; status: JobStatus; progress: number; epoch: number; epochs: number; loss: number; accuracy: number; duration: string; date: string; dataset: string }
export interface ModelVersion { id: string; name: string; version: string; family: Family; status: 'Borrador' | 'Revisado' | 'Aprobado' | 'Retirado'; accuracy: number; date: string; jobId: string }
