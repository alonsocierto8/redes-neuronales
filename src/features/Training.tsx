import { useEffect, useMemo, useState } from 'react'
import { Activity, Ban, CheckCircle2, Play, Settings2 } from 'lucide-react'
import { PageHeader, Card, CardTitle, Badge, Button } from '../components/Primitives'
import type { Dataset, Job, Project } from '../types'
import type { SavedArchitecture } from '../lib/api'

export default function Training({ jobs, datasets, projects, architectures, onStart, onCancel, onCreateVersion }: {
  jobs: Job[]
  datasets: Dataset[]
  projects: Project[]
  architectures: SavedArchitecture[]
  onStart: (data: { projectId: string; datasetId: string; architectureId: number; epochs: number; batch: number; optimizer: string }) => Promise<void>
  onCancel: (id: string) => Promise<void>
  onCreateVersion: (jobId: string) => Promise<void>
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '')
  const [datasetId, setDatasetId] = useState('')
  const [architectureId, setArchitectureId] = useState('')
  const [epochs, setEpochs] = useState(20)
  const [batch, setBatch] = useState(32)
  const [optimizer, setOptimizer] = useState('Adam')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const projectArchitectures = useMemo(() => architectures.filter(architecture => architecture.projectId === projectId), [architectures, projectId])
  const selectedArchitecture = projectArchitectures.find(architecture => String(architecture.id) === architectureId)
  const projectDatasets = useMemo(() => datasets.filter(dataset => dataset.projectId === projectId), [datasets, projectId])
  const selectedDataset = projectDatasets.find(dataset => dataset.id === datasetId)
  const compatibleArchitectures = projectArchitectures.filter(architecture => !selectedDataset || architecture.family === selectedDataset.family)

  useEffect(() => {
    const generatedArchitecture = projectArchitectures.find(
      architecture => architecture.config.generated_for_dataset_id === Number(datasetId),
    )
    if (generatedArchitecture) {
      setArchitectureId(String(generatedArchitecture.id))
      return
    }
    if (selectedArchitecture && selectedDataset && selectedArchitecture.family !== selectedDataset.family) {
      setArchitectureId('')
    }
  }, [datasetId, projectArchitectures])

  async function start() {
    if (!projectId || !datasetId || !architectureId) {
      setNotice('Selecciona el proyecto, una arquitectura guardada y un dataset compatible.')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await onStart({ projectId, datasetId, architectureId: Number(architectureId), epochs, batch, optimizer })
      setNotice('Entrenamiento CNN enviado a la cola persistente.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo iniciar el entrenamiento.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="page-wrap">
    <PageHeader eyebrow="M06 · TRAINING" title="Entrenamientos" description="Ejecuta CNN y redes Feedforward en el worker y consulta progreso persistido." action={<Badge tone="blue"><span className="pulse-dot"/> Cola del backend</Badge>}/>
    <div className="training-layout">
      <Card className="training-config"><CardTitle title="Nueva ejecución" subtitle="El worker TensorFlow debe estar activo." action={<Settings2 size={17} className="muted-icon"/>}/>
        <div className="properties-form">
          <label>Proyecto<select value={projectId} onChange={event => {setProjectId(event.target.value);setDatasetId('');setArchitectureId('')}}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>Dataset<select value={datasetId} onChange={event => {setDatasetId(event.target.value);setArchitectureId('')}}><option value="">Selecciona un dataset</option>{projectDatasets.map(item => <option value={item.id} key={item.id}>{item.name} · {item.family} · {item.features} clases</option>)}</select></label>
          <label>Arquitectura compatible<select value={architectureId} onChange={event => setArchitectureId(event.target.value)}><option value="">Selecciona una arquitectura</option>{compatibleArchitectures.map(item => <option value={item.id} key={item.id}>{item.name} · {item.family} · {item.config.layers.length} capas</option>)}</select></label>
          <div className="form-two"><label>Épocas<input type="number" min="1" max="500" value={epochs} onChange={event => setEpochs(Number(event.target.value))}/></label><label>Batch size<select value={batch} onChange={event => setBatch(Number(event.target.value))}>{[8,16,32,64,128].map(value => <option key={value}>{value}</option>)}</select></label></div>
          <label>Optimizador<select value={optimizer} onChange={event => setOptimizer(event.target.value)}>{['Adam','SGD','RMSprop','Adagrad'].map(value => <option key={value}>{value}</option>)}</select></label>
          <div className="config-note"><span className="notice-mark">i</span><span>La API valida permisos, familia, forma de entrada y clases. El worker separa datos de entrenamiento, validación y prueba.</span></div>
          <Button block disabled={busy || !projects.length} onClick={start} icon={<Play size={15} fill="currentColor"/>}>{busy ? 'Enviando…' : 'Iniciar entrenamiento'}</Button>
          {notice && <p className="inline-notice" role="status">{notice}</p>}
        </div>
        <div className="resource-box"><div><span>Motor</span><b><Activity size={14}/> TensorFlow · Keras</b></div><div><span>Estado</span><b>Persistido</b></div><div><span>Actualización</span><b>SSE</b></div></div>
      </Card>
      <div className="jobs-column">
        <Card><CardTitle title="Cola de entrenamientos" subtitle={`${jobs.length} trabajos persistidos`} action={<span className="live-status"><i/> Estado del servidor</span>}/>
          <div className="job-list">{jobs.map(job => <div className="job-card-row" key={job.id}>
            <div className={`job-square ${job.status === 'Ejecutando' ? 'job-square-live' : ''}`}><Activity size={18}/></div>
            <div className="job-info"><div className="job-name-row"><b>{job.project}</b><Badge tone={job.status === 'Completado' ? 'green' : job.status === 'Ejecutando' ? 'blue' : job.status === 'Fallido' ? 'red' : job.status === 'Cancelado' ? 'neutral' : 'amber'}>{job.status}</Badge></div>
              <small>{job.id} · {job.family} · {job.dataset}</small><div className="job-bar-row"><div className="progress-track"><span style={{ width: `${job.progress}%` }}/></div><span>{job.progress}%</span></div>
              <div className="job-metadata"><span>Época {job.epoch}/{job.epochs}</span><span>Loss {job.loss.toFixed(3)}</span><span>Acc. {(job.accuracy * 100).toFixed(1)}%</span><span>{job.duration}</span></div>
              {job.error && <small className="auth-error">{job.error}</small>}
            </div>
            {job.status === 'Ejecutando' || job.status === 'Preparando' || job.status === 'En cola'
              ? <button className="cancel-job" onClick={async () => {try {await onCancel(job.id)} catch (error) {setNotice(error instanceof Error ? error.message : 'No se pudo cancelar el trabajo.')}}} title="Solicitar cancelación"><Ban size={16}/></button>
              : job.status === 'Completado'
                ? <button className="row-arrow" title="Crear versión inmutable" onClick={async () => {try {await onCreateVersion(job.id);setNotice('Versión registrada con checksum.')} catch (error) {setNotice(error instanceof Error ? error.message : 'No se pudo registrar el modelo.')}}}><CheckCircle2 size={18}/></button>
                : null}
          </div>)}</div>
        </Card>
      </div>
    </div>
  </div>
}
