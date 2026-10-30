import { useMemo } from 'react'
import { Activity, ArrowUpRight, Boxes, BrainCircuit, CheckCircle2, Clock3, Cpu, Plus, Sparkles } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from 'recharts'
import { PageHeader, Card, CardTitle, Badge, Button, SectionLink } from '../components/Primitives'
import type { Job, Project, PageKey } from '../types'

export default function Dashboard({ projects, jobs, modelsCount, navigate, onNewProject }: {
  projects: Project[]
  jobs: Job[]
  modelsCount: number
  navigate: (page: PageKey) => void
  onNewProject: () => void
}) {
  const running = jobs.filter(job => ['Ejecutando', 'Preparando'].includes(job.status)).length
  const completed = jobs.filter(job => job.status === 'Completado').length
  const chartData = useMemo(() => {
    const today = new Date()
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - (6 - index))
      const value = jobs.filter(job => new Date(job.date).toDateString() === date.toDateString()).length
      return {
        day: new Intl.DateTimeFormat('es', { weekday: 'short' }).format(date).replace('.', ''),
        value,
      }
    })
  }, [jobs])

  return <div className="page-wrap">
    <PageHeader eyebrow="M01 · OVERVIEW" title="Panel de control" description="Resumen de proyectos y actividad persistida." action={<Button onClick={onNewProject} icon={<Plus size={16}/>}>Nuevo proyecto</Button>}/>
    <div className="welcome-banner"><div className="welcome-orb"><BrainCircuit size={26}/></div><div><div className="welcome-kicker"><Sparkles size={13}/> ESPACIO DE TRABAJO</div><h2>Construye, entrena y evalúa modelos de IA.</h2><p>Diseña arquitecturas Feedforward o CNN, ejecuta entrenamientos y conserva sus resultados.</p></div><div className="banner-chip"><span className="pulse-dot"/> API conectada</div></div>
    <div className="stats-grid">
      <Card className="stat-card"><div className="stat-top"><span>Proyectos</span><span className="stat-icon violet"><Boxes size={18}/></span></div><div className="stat-number">{projects.length.toString().padStart(2, '0')}</div><div className="stat-foot">Accesibles para tu cuenta</div></Card>
      <Card className="stat-card"><div className="stat-top"><span>Entrenamientos activos</span><span className="stat-icon cyan"><Activity size={18}/></span></div><div className="stat-number">{running.toString().padStart(2, '0')}</div><div className="stat-foot"><span className="positive"><span className="pulse-dot"/> En cola o ejecución</span></div></Card>
      <Card className="stat-card"><div className="stat-top"><span>Modelos registrados</span><span className="stat-icon green"><BrainCircuit size={18}/></span></div><div className="stat-number">{modelsCount.toString().padStart(2, '0')}</div><div className="stat-foot">Versiones persistidas</div></Card>
      <Card className="stat-card"><div className="stat-top"><span>Trabajos completados</span><span className="stat-icon amber"><Cpu size={18}/></span></div><div className="stat-number">{completed.toString().padStart(2, '0')}</div><div className="stat-foot">{jobs.length} trabajos registrados</div></Card>
    </div>
    <div className="dashboard-grid">
      <Card><CardTitle title="Actividad de entrenamiento" subtitle="Trabajos creados · últimos 7 días"/><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 6, left: 0, bottom: 0 }}><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c6df2" stopOpacity={0.28}/><stop offset="100%" stopColor="#7c6df2" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#7f8aa4', fontSize: 11 }}/><Tooltip contentStyle={{ background: '#151d31', border: '1px solid #29334c', borderRadius: 10, color: '#e7eaf4' }}/><Area type="monotone" dataKey="value" name="Trabajos" stroke="#9183ff" strokeWidth={2.5} fill="url(#chartFill)"/></AreaChart></ResponsiveContainer></div></Card>
      <Card><CardTitle title="Estado de la plataforma" subtitle="Servicios y datos del espacio de trabajo"/><div className="system-list">{[['API de aplicación', 'Conectada', 'green'], ['Trabajos persistidos', String(jobs.length), 'blue'], ['Worker TensorFlow', 'Proceso requerido', 'amber'], ['Métricas', 'Guardadas por época', 'green']].map(([name, status, tone]) => <div className="system-row" key={name}><span className="system-indicator"/><span>{name}</span><Badge tone={tone as 'green' | 'blue' | 'amber'}>{status}</Badge></div>)}</div><div className="notice-box"><span className="notice-mark">i</span><span>Los trabajos esperan en la cola hasta que el proceso worker esté activo. Consulta su estado en Administración.</span></div></Card>
    </div>
    <Card className="table-card"><CardTitle title="Proyectos recientes" subtitle="Accede rápidamente a tus espacios de trabajo" action={<SectionLink onClick={() => navigate('projects')}>Ver proyectos</SectionLink>}/><div className="table-scroll"><table><thead><tr><th>Proyecto</th><th>Familias disponibles</th><th>Estado</th><th>Progreso</th><th>Última actividad</th><th/></tr></thead><tbody>{projects.slice(0, 4).map(project => <tr key={project.id}><td><div className="project-cell"><div className="table-avatar">IA</div><div><b>{project.name}</b><small>{project.id}</small></div></div></td><td>Feedforward / CNN</td><td><Badge tone={project.status === 'Activo' ? 'green' : 'neutral'}>{project.status}</Badge></td><td><div className="progress-cell"><div className="progress-track"><span style={{ width: `${project.progress}%` }}/></div><small>{project.progress}%</small></div></td><td className="muted-cell">{project.updated}</td><td><button className="row-arrow" onClick={() => navigate('architectures')}><ArrowUpRight size={16}/></button></td></tr>)}</tbody></table></div></Card>
    <div className="bottom-grid"><Card><CardTitle title="Entrenamientos recientes" subtitle="Últimos trabajos de la cola" action={<SectionLink onClick={() => navigate('training')}>Ver todos</SectionLink>}/><div className="recent-jobs">{jobs.slice(0, 3).map(job => <div className="recent-job" key={job.id}><div className={`job-icon ${job.status === 'Ejecutando' ? 'job-live' : ''}`}><Activity size={17}/></div><div className="recent-job-main"><b>{job.project}</b><small>{job.id} · {job.family}</small>{job.status === 'Ejecutando' && <div className="progress-track job-progress"><span style={{ width: `${job.progress}%` }}/></div>}</div><div className="recent-job-end"><Badge tone={job.status === 'Completado' ? 'green' : job.status === 'Ejecutando' ? 'blue' : job.status === 'Fallido' ? 'red' : 'amber'}>{job.status}</Badge><small>{job.status === 'Ejecutando' ? `${job.progress}%` : job.date}</small></div></div>)}</div></Card>
      <Card className="quick-card"><div className="quick-icon"><CheckCircle2 size={21}/></div><h3>Continúa donde lo dejaste</h3><p>Diseña una arquitectura, revisa las métricas o registra una nueva versión de modelo.</p><div className="quick-actions"><Button variant="secondary" onClick={() => navigate('architectures')}>Diseñar arquitectura <ArrowUpRight size={15}/></Button><Button variant="ghost" onClick={() => navigate('models')}>Registro de modelos <ArrowUpRight size={15}/></Button></div><div className="quick-footer"><Clock3 size={13}/> Estado sincronizado con la API</div></Card></div>
  </div>
}
