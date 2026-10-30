import { useMemo, useState } from 'react'
import { Database, FileSpreadsheet, Image, Trash2, UploadCloud } from 'lucide-react'
import type { Dataset, Project } from '../types'
import { PageHeader, Card, CardTitle, Badge, Button, SearchBox, AddButton, EmptyState } from '../components/Primitives'

export default function Datasets({ datasets, projects, onAdd, onDelete }: {
  datasets: Dataset[]
  projects: Project[]
  onAdd: (projectId: string, name: string, file: File) => Promise<void>
  onDelete: (dataset: Dataset) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState(projects[0]?.id || '')
  const [file, setFile] = useState<File>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const filtered = useMemo(() => datasets.filter(dataset => (dataset.name + dataset.format).toLowerCase().includes(search.toLowerCase())), [datasets, search])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!projectId || !name.trim() || !file) {
      setNotice('Elige el proyecto, el nombre y un ZIP de imágenes.')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await onAdd(projectId, name.trim(), file)
      setName('')
      setFile(undefined)
      setShow(false)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo cargar el dataset.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="page-wrap">
    <PageHeader eyebrow="M05 · CNN IMAGE DATA" title="Datasets de imágenes" description="Carga datasets de clasificación CNN con una carpeta por clase." action={<AddButton onClick={() => setShow(!show)}>Cargar dataset</AddButton>}/>
    <div className="dataset-summary">
      <Card><div className="dataset-summary-icon"><Database size={19}/></div><span>Datasets registrados</span><b>{datasets.length}</b><small>Almacenados por proyecto</small></Card>
      <Card><div className="dataset-summary-icon green"><FileSpreadsheet size={19}/></div><span>Imágenes</span><b>{datasets.reduce((total, dataset) => total + Number(dataset.rows), 0).toLocaleString('es')}</b><small>Validadas en archivo ZIP</small></Card>
      <Card><div className="dataset-summary-icon amber"><UploadCloud size={19}/></div><span>Clases</span><b>{datasets.reduce((total, dataset) => total + dataset.features, 0)}</b><small>Etiquetas detectadas</small></Card>
    </div>
    {show && <Card className="form-card"><CardTitle title="Cargar dataset CNN" subtitle="ZIP de máximo 100 MB con imágenes separadas en carpetas por clase."/>
      <form className="form-grid" onSubmit={submit}>
        <label>Proyecto<select value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
        <label>Nombre<input required minLength={2} maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Ej. Productos por categoría"/></label>
        <label className="form-full upload-drop"><UploadCloud size={21}/><b>{file?.name || 'Seleccionar ZIP de imágenes'}</b><span>Formato: raíz opcional/clase/imagen.jpg · mínimo 2 clases</span><input required type="file" accept=".zip,application/zip" onChange={event => setFile(event.target.files?.[0])}/></label>
        {notice && <p className="auth-error form-full" role="alert">{notice}</p>}
        <div className="form-full form-actions"><Button variant="secondary" type="button" onClick={() => {setShow(false);setNotice('')}}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? 'Validando y cargando…' : 'Cargar dataset'}</Button></div>
      </form>
    </Card>}
    <Card className="table-card"><CardTitle title="Catálogo de datasets" subtitle="Imágenes, clases y versión guardadas en el backend" action={<SearchBox value={search} onChange={setSearch} placeholder="Buscar dataset..."/>}/>
      {filtered.length === 0 ? <EmptyState title="No se encontraron datasets" detail="Selecciona un proyecto y carga un ZIP de imágenes por clase."/> : <div className="table-scroll"><table><thead><tr><th>Dataset</th><th>Proyecto</th><th>Imágenes</th><th>Clases</th><th>Formato</th><th>Estado</th><th>Versión</th><th/></tr></thead><tbody>
        {filtered.map(dataset => <tr key={dataset.id}><td><div className="project-cell"><div className="dataset-file-icon"><Image size={17}/></div><div><b>{dataset.name}</b><small>{dataset.id}</small></div></div></td><td>{projects.find(project => project.id === dataset.projectId)?.name || '—'}</td><td>{dataset.rows}</td><td>{dataset.features}</td><td><span className="family-chip">ZIP · imágenes</span></td><td><Badge tone={dataset.status === 'Validado' ? 'green' : 'amber'}>{dataset.status}</Badge></td><td>{dataset.updated}</td><td><button className="row-arrow" title="Eliminar dataset" onClick={async () => {if (window.confirm(`¿Eliminar el dataset ${dataset.name}?`)) {try {await onDelete(dataset)} catch (error) {setNotice(error instanceof Error ? error.message : 'No se pudo eliminar el dataset.')}}}}><Trash2 size={15}/></button></td></tr>)}
      </tbody></table></div>}
    </Card>
    <div className="notice-box wide-notice"><span className="notice-mark">i</span><span>Estructura admitida: <code>clase_a/imagen.jpg</code> y <code>clase_b/imagen.jpg</code>. No se aceptan rutas inseguras ni archivos mayores de 100 MB.</span></div>
  </div>
}
