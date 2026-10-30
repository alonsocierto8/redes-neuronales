import { useMemo, useState } from 'react'
import { Archive, Download, FileBox, GitCompareArrows, ShieldCheck } from 'lucide-react'
import type { ModelVersion } from '../types'
import { PageHeader, Card, CardTitle, Badge, Button, SearchBox, EmptyState } from '../components/Primitives'

export default function Models({ models, onStatus, onCompare, onDownload }: {
  models: ModelVersion[]
  onStatus: (id: string, status: ModelVersion['status']) => void
  onCompare: (ids: string[]) => void
  onDownload: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const filtered = useMemo(
    () => models.filter(model => `${model.name} ${model.version} ${model.family}`.toLowerCase().includes(search.toLowerCase())),
    [models, search],
  )
  const tone = (status: ModelVersion['status']) => status === 'Aprobado' ? 'green' : status === 'Revisado' ? 'blue' : status === 'Retirado' ? 'red' : 'neutral'
  function toggle(id: string) {
    setSelected(current => current.includes(id)
      ? current.filter(item => item !== id)
      : current.length < 2 ? [...current, id] : [current[1], id])
  }

  return <div className="page-wrap">
    <PageHeader eyebrow="M08 · MODEL REGISTRY" title="Registro de modelos" description="Versiones inmutables de modelos entrenados, con checksum y flujo de revisión." action={<Button variant="secondary" onClick={() => onCompare(selected)} icon={<GitCompareArrows size={15}/>}>Comparar ({selected.length})</Button>}/>
    <div className="registry-summary">
      <Card><FileBox size={18}/><span>Versiones registradas</span><b>{models.length.toString().padStart(2, '0')}</b></Card>
      <Card><ShieldCheck size={18}/><span>Aprobadas</span><b>{models.filter(model => model.status === 'Aprobado').length.toString().padStart(2, '0')}</b></Card>
      <Card><Archive size={18}/><span>Retiradas</span><b>{models.filter(model => model.status === 'Retirado').length.toString().padStart(2, '0')}</b></Card>
    </div>
    <Card className="table-card">
      <CardTitle title="Versiones registradas" subtitle="Selecciona hasta dos modelos para comparar" action={<SearchBox value={search} onChange={setSearch} placeholder="Buscar modelo..."/>}/>
      {filtered.length === 0 ? <EmptyState title="No hay modelos" detail="Las versiones aparecerán al registrar un entrenamiento completado."/> : <div className="table-scroll"><table>
        <thead><tr><th>Comparar</th><th>Modelo / versión</th><th>Familia</th><th>Accuracy</th><th>Estado de revisión</th><th>Checksum</th><th>Acciones</th></tr></thead>
        <tbody>{filtered.map(model => <tr key={model.id}>
          <td><input aria-label={`Seleccionar ${model.name}`} type="checkbox" checked={selected.includes(model.id)} onChange={() => toggle(model.id)}/></td>
          <td><div className="project-cell"><div className="model-icon"><FileBox size={17}/></div><div><b>{model.name}</b><small>{model.id} · {model.version} · {model.jobId}</small></div></div></td>
          <td>{model.family}</td>
          <td><b>{model.accuracy.toFixed(1)}%</b><div className="progress-track accuracy-track"><span style={{ width: `${model.accuracy}%` }}/></div></td>
          <td><Badge tone={tone(model.status)}>{model.status}</Badge></td>
          <td className="mono">{model.checksum?.slice(0, 12) || '—'}</td>
          <td><div className="model-actions">
            <select aria-label={`Estado de ${model.name}`} className="inline-status" value={model.status} onChange={event => onStatus(model.id, event.target.value as ModelVersion['status'])}>
              <option>Borrador</option><option>Revisado</option><option>Aprobado</option><option>Retirado</option>
            </select>
            <button className="row-arrow" title={`Descargar artefacto ${model.family}`} onClick={() => onDownload(model.id)}><Download size={15}/></button>
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </Card>
    <div className="registry-note"><ShieldCheck size={17}/><div><b>Versionado inmutable</b><p>Cada ejecución genera un artefacto separado. Las versiones no se sobrescriben y la descarga se audita.</p></div></div>
    <div className="bottom-grid">
      <Card><CardTitle title="Flujo de revisión" subtitle="Permisos administrados por rol"/><div className="review-flow">{[['Borrador','Configuración inicial'],['Revisado','Revisión técnica'],['Aprobado','Listo para uso'],['Retirado','Fuera de uso']].map(([status, detail], index) => <div className="review-step" key={status}><span className={`review-step-num step-${index}`}>{index + 1}</span><div><b>{status}</b><small>{detail}</small></div></div>)}</div></Card>
      <Card><CardTitle title="Trazabilidad" subtitle="Artefactos del worker TensorFlow"/><div className="trace-list"><div><span>Origen de versión</span><b>Trabajo de entrenamiento</b></div><div><span>Versiones almacenadas</span><b>{models.length}</b></div><div><span>Checksum</span><b className="mono">SHA-256</b></div><div><span>Artefactos</span><Badge tone="green">Disponibles</Badge></div></div></Card>
    </div>
  </div>
}
