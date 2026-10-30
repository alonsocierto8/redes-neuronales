import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BarChart3, ChartNoAxesCombined, GitCompareArrows } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { PageHeader, Card, CardTitle, Badge, EmptyState } from '../components/Primitives'
import type { Job } from '../types'
import { api, type TrainingMetric } from '../lib/api'

export default function Evaluation({ jobs }: { jobs: Job[] }) {
  const [selectedId, setSelectedId] = useState('')
  const [metric, setMetric] = useState<'loss' | 'accuracy'>('loss')
  const [metrics, setMetrics] = useState<TrainingMetric[]>([])
  const [error, setError] = useState('')
  const candidates = useMemo(() => jobs.filter(job => ['Completado', 'Ejecutando', 'Preparando'].includes(job.status)), [jobs])
  const selectedJob = candidates.find(job => job.id === selectedId) || candidates[0]

  useEffect(() => {
    if (!selectedJob) {
      setMetrics([])
      return
    }
    let active = true
    api.listMetrics(selectedJob.id).then(result => {
      if (active) {
        setMetrics(result)
        setError('')
      }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las métricas.')
    })
    return () => { active = false }
  }, [selectedJob?.id])

  const chartData = useMemo(() => {
    const points = new Map<number, Record<string, number>>()
    for (const item of metrics) {
      const point = points.get(item.epoch) || { epoch: item.epoch }
      point[item.name] = item.value
      points.set(item.epoch, point)
    }
    return [...points.values()].sort((a, b) => a.epoch - b.epoch)
  }, [metrics])
  const latest = chartData.at(-1)
  const finalLoss = latest?.loss ?? selectedJob?.loss ?? 0
  const finalAccuracy = latest?.accuracy ?? selectedJob?.accuracy ?? 0
  const validationAccuracy = latest?.val_accuracy

  return <div className="page-wrap">
    <PageHeader eyebrow="M07 · CNN EVALUATION" title="Evaluación y métricas" description="Consulta métricas registradas por época durante el entrenamiento CNN." action={<Badge tone={chartData.length ? 'green' : 'amber'}>{chartData.length ? 'Métricas reales' : 'Sin métricas'}</Badge>}/>
    <div className="metric-cards">
      <Card><div className="metric-top"><span>Accuracy</span><ChartNoAxesCombined size={17}/></div><div className="metric-value">{(finalAccuracy * 100).toFixed(1)}<span>%</span></div><div className="metric-caption positive"><ArrowUpRight size={14}/> Último valor registrado</div></Card>
      <Card><div className="metric-top"><span>Loss final</span><BarChart3 size={17}/></div><div className="metric-value">{finalLoss.toFixed(4)}</div><div className="metric-caption muted-cell"><ArrowDownRight size={14}/> Último valor registrado</div></Card>
      <Card><div className="metric-top"><span>Val. accuracy</span><GitCompareArrows size={17}/></div><div className="metric-value">{validationAccuracy === undefined ? '—' : `${(validationAccuracy * 100).toFixed(1)}%`}</div><div className="metric-caption muted-cell">Conjunto de validación</div></Card>
      <Card><div className="metric-top"><span>Ejecuciones terminadas</span><BarChart3 size={17}/></div><div className="metric-value">{jobs.filter(job => job.status === 'Completado').length.toString().padStart(2, '0')}</div><div className="metric-caption muted-cell">Trabajos CNN completados</div></Card>
    </div>
    <Card className="evaluation-chart">
      <CardTitle title="Curva de entrenamiento" subtitle={selectedJob ? `${selectedJob.id} · ${selectedJob.project}` : 'Selecciona un entrenamiento completado'} action={<><select aria-label="Entrenamiento" value={selectedJob?.id || ''} onChange={event => setSelectedId(event.target.value)}>{candidates.map(job => <option value={job.id} key={job.id}>{job.id} · {job.project}</option>)}</select><div className="filter-tabs compact-tabs">{[['loss','Pérdida'],['accuracy','Accuracy']].map(([value,label])=><button className={metric === value ? 'filter-active' : ''} key={value} onClick={() => setMetric(value as 'loss'|'accuracy')}>{label}</button>)}</div></>}/>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {!chartData.length ? <EmptyState title="Aún no hay métricas" detail={selectedJob ? 'Los datos aparecerán cuando el worker termine la primera época.' : 'Inicia un entrenamiento CNN para registrar resultados.'}/> : <div className="large-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{top:16,right:16,left:0,bottom:0}}><CartesianGrid stroke="#28334a" strokeDasharray="3 4" vertical={false}/><XAxis dataKey="epoch" tick={{fill:'#7f8aa4',fontSize:11}} tickLine={false} axisLine={false} label={{value:'Época',position:'insideBottomRight',offset:-5,fill:'#7f8aa4',fontSize:11}}/><YAxis tick={{fill:'#7f8aa4',fontSize:11}} tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#151d31',border:'1px solid #29334c',borderRadius:10,color:'#e7eaf4'}}/><Legend/><Line type="monotone" dataKey={metric} name="Entrenamiento" stroke="#9183ff" strokeWidth={2.5} dot={false}/><Line type="monotone" dataKey={metric === 'loss' ? 'val_loss' : 'val_accuracy'} name="Validación" stroke="#42c9c4" strokeWidth={2.5} dot={false} strokeDasharray="5 4"/></LineChart></ResponsiveContainer></div>}
      <div className="chart-footnote"><span><i className="legend-dot purple-dot"/> Entrenamiento</span><span><i className="legend-dot cyan-dot"/> Validación</span><span className="muted-cell">Métricas persistidas por época</span></div>
    </Card>
    <Card className="table-card"><CardTitle title="Comparación de ejecuciones CNN" subtitle="Resultados registrados por el worker"/><div className="table-scroll"><table><thead><tr><th>Trabajo</th><th>Familia</th><th>Estado</th><th>Épocas</th><th>Loss</th><th>Accuracy</th></tr></thead><tbody>{jobs.map(job=><tr key={job.id}><td><b>{job.id}</b><small className="table-subline">{job.project}</small></td><td>CNN</td><td><Badge tone={job.status==='Completado'?'green':job.status==='Ejecutando'?'blue':job.status==='Fallido'?'red':'amber'}>{job.status}</Badge></td><td>{job.epoch}/{job.epochs}</td><td>{job.loss.toFixed(4)}</td><td><b>{(job.accuracy*100).toFixed(1)}%</b></td></tr>)}</tbody></table></div></Card>
  </div>
}
