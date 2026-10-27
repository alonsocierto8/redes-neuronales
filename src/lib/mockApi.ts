import type { Dataset, Job, ModelVersion, Project } from '../types'

export const demoProjects: Project[] = [
  { id: 'PRJ-001', name: 'Predicción de abandono', description: 'Identificación temprana de clientes con riesgo de abandono.', family: 'Feedforward', status: 'Activo', owner: 'Ana Torres', updated: 'Hoy, 09:42', progress: 82 },
  { id: 'PRJ-002', name: 'Clasificación de imágenes', description: 'Clasificación de imágenes de productos mediante visión artificial.', family: 'CNN', status: 'Activo', owner: 'Carlos Ruiz', updated: 'Ayer, 16:18', progress: 100 },
  { id: 'PRJ-003', name: 'Demanda temporal', description: 'Estimación de demanda usando secuencias temporales.', family: 'RNN', status: 'Borrador', owner: 'María León', updated: '20 oct, 11:05', progress: 35 },
  { id: 'PRJ-004', name: 'Generación sintética', description: 'Exploración de generación de datos sintéticos.', family: 'GAN', status: 'Activo', owner: 'Diego Pérez', updated: '19 oct, 14:26', progress: 67 },
]
export const demoDatasets: Dataset[] = [
  { id: 'DS-001', name: 'Customer Churn Demo', rows: '7,043', features: 20, format: 'CSV', status: 'Validado', updated: 'Hoy, 09:30' },
  { id: 'DS-002', name: 'Product Images 64×64', rows: '12,000', features: 3, format: 'Imágenes', status: 'Validado', updated: 'Ayer, 16:02' },
  { id: 'DS-003', name: 'Monthly Demand', rows: '2,400', features: 8, format: 'CSV', status: 'Pendiente', updated: '20 oct, 10:50' },
]
export const demoJobs: Job[] = [
  { id: 'JOB-1048', project: 'Predicción de abandono', family: 'Feedforward', status: 'Ejecutando', progress: 68, epoch: 34, epochs: 50, loss: 0.284, accuracy: 0.914, duration: '00:04:21', date: 'Hoy, 09:42', dataset: 'Customer Churn Demo' },
  { id: 'JOB-1047', project: 'Clasificación de imágenes', family: 'CNN', status: 'Completado', progress: 100, epoch: 40, epochs: 40, loss: 0.112, accuracy: 0.962, duration: '00:08:13', date: 'Ayer, 16:18', dataset: 'Product Images 64×64' },
  { id: 'JOB-1046', project: 'Demanda temporal', family: 'RNN', status: 'En cola', progress: 0, epoch: 0, epochs: 60, loss: 0.892, accuracy: 0.781, duration: '—', date: '20 oct, 11:05', dataset: 'Monthly Demand' },
  { id: 'JOB-1045', project: 'Generación sintética', family: 'GAN', status: 'Fallido', progress: 43, epoch: 13, epochs: 30, loss: 0.526, accuracy: 0.721, duration: '00:02:10', date: '19 oct, 14:26', dataset: 'Customer Churn Demo' },
]
export const demoModels: ModelVersion[] = [
  { id: 'MDL-201', name: 'Churn Classifier', version: 'v1.3.0', family: 'Feedforward', status: 'Aprobado', accuracy: 91.4, date: 'Hoy, 09:48', jobId: 'JOB-1048' },
  { id: 'MDL-198', name: 'Product Vision', version: 'v1.1.0', family: 'CNN', status: 'Revisado', accuracy: 96.2, date: 'Ayer, 16:32', jobId: 'JOB-1047' },
  { id: 'MDL-176', name: 'Demand Forecaster', version: 'v0.9.0', family: 'RNN', status: 'Borrador', accuracy: 78.1, date: '20 oct, 12:01', jobId: 'JOB-1046' },
]
export const wait = (ms = 500) => new Promise(resolve => setTimeout(resolve, ms))
