import { useState } from 'react'
import { Download, FileBarChart, FileText, History, ShieldCheck } from 'lucide-react'
import { PageHeader, Card, CardTitle, Button, Badge } from '../components/Primitives'
import type { Job, ModelVersion, Project } from '../types'
import { api } from '../lib/api'

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function Reports({ projects, jobs, models }: { projects: Project[]; jobs: Job[]; models: ModelVersion[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '')
  const [error, setError] = useState('')
  async function exportPdf() {
    if (!projectId) return
    try {
      const blob = await api.downloadProjectReport(projectId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `neurolab-project-${projectId}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo exportar el informe PDF.')
    }
  }
  const exportJobs = () => downloadCsv('neurolab-entrenamientos-cnn.csv', [
    ['ID', 'Proyecto', 'Familia', 'Estado', 'Progreso', 'Epoca', 'Epocas', 'Loss', 'Accuracy', 'Dataset'],
    ...jobs.map(job => [job.id, job.project, 'CNN', job.status, String(job.progress), String(job.epoch), String(job.epochs), String(job.loss), String(job.accuracy), job.dataset]),
  ])
  const exportModels = () => downloadCsv('neurolab-modelos-cnn.csv', [
    ['ID', 'Nombre', 'Version', 'Familia', 'Estado', 'Accuracy', 'Fecha', 'Job', 'SHA256'],
    ...models.map(model => [model.id, model.name, model.version, 'CNN', model.status, String(model.accuracy), model.date, model.jobId, model.checksum || '']),
  ])
  const exportProjects = () => downloadCsv('neurolab-proyectos-cnn.csv', [
    ['ID', 'Nombre', 'Descripcion', 'Familia', 'Estado', 'Responsable'],
    ...projects.map(project => [project.id, project.name, project.description, 'CNN', project.status, project.owner]),
  ])

  return <div className="page-wrap">
    <PageHeader eyebrow="M09 · CNN REPORTING" title="Reportes" description="Exporta el historial CNN persistido y la ficha de cada proyecto."/>
    <div className="report-hero"><div className="report-hero-icon"><FileBarChart size={26}/></div><div><Badge tone="purple">CENTRO DE REPORTES CNN</Badge><h2>Resultados trazables, exportables y autorizados.</h2><p>Los CSV se generan desde los datos de sesión; el PDF reúne proyecto, arquitectura e historial desde el backend.</p></div></div>
    <div className="report-grid">
      <Card className="report-card"><div className="report-icon"><FileText size={20}/></div><Badge tone="blue">CSV · EJECUCIONES</Badge><h3>Historial de entrenamientos CNN</h3><p>Estado, época, pérdida, exactitud y dataset asociados a cada ejecución.</p><div className="report-meta"><span>{jobs.length} registros</span><span>CSV UTF-8</span></div><Button variant="secondary" onClick={exportJobs} icon={<Download size={15}/>}>Exportar entrenamientos</Button></Card>
      <Card className="report-card"><div className="report-icon green"><ShieldCheck size={20}/></div><Badge tone="green">CSV · VERSIONES</Badge><h3>Registro de modelos CNN</h3><p>Versiones inmutables, revisión, métricas y checksum SHA-256.</p><div className="report-meta"><span>{models.length} registros</span><span>SHA-256</span></div><Button variant="secondary" onClick={exportModels} icon={<Download size={15}/>}>Exportar modelos</Button></Card>
      <Card className="report-card"><div className="report-icon amber"><History size={20}/></div><Badge tone="amber">CSV · PROYECTOS</Badge><h3>Ficha de proyectos CNN</h3><p>Proyectos autorizados, descripción, responsable y estado.</p><div className="report-meta"><span>{projects.length} registros</span><span>CSV UTF-8</span></div><Button variant="secondary" onClick={exportProjects} icon={<Download size={15}/>}>Exportar proyectos</Button></Card>
    </div>
    <Card className="report-checklist"><CardTitle title="Informe de proyecto" subtitle="PDF generado en el servidor con auditoría de la exportación"/>
      <div className="properties-form"><label>Proyecto<select value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><Button disabled={!projectId} onClick={exportPdf} icon={<Download size={15}/>}>Descargar PDF</Button>{error&&<p className="auth-error" role="alert">{error}</p>}</div>
      <div className="checklist-grid">{[['Ficha de proyecto','PDF'],['Resumen de arquitectura CNN','PDF'],['Historial de entrenamiento','CSV y PDF'],['Registro de modelos','CSV'],['Auditoría de exportaciones','Persistente'],['Descarga de artefactos','Con permiso']].map(([title,detail])=><div className="check-item" key={title}><span className="check-circle">✓</span><div><b>{title}</b><small>{detail}</small></div></div>)}</div>
    </Card>
  </div>
}
