import { useEffect, useState } from 'react'
import { Activity, Check, LockKeyhole, Save, Shield, SlidersHorizontal, Users } from 'lucide-react'
import { PageHeader, Card, CardTitle, Badge, Button, EmptyState } from '../components/Primitives'
import {
  api,
  type AdminHealth,
  type AdminSettings,
  type ApiAdminUser,
} from '../lib/api'

interface AuditEvent {
  id: number
  actor_id: number | null
  project_id: number | null
  action: string
  created_at: string
}

const roles = ['Administrador', 'Responsable de proyecto', 'Ingeniero de IA', 'Revisor', 'Lector']
const initialSettings: AdminSettings = { max_active_jobs: 1, max_upload_mb: 100, retention_days: 90 }

export default function Admin({ currentUserRole }: { currentUserRole: string | null }) {
  const [users, setUsers] = useState<ApiAdminUser[]>([])
  const [settings, setSettings] = useState(initialSettings)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [health, setHealth] = useState<AdminHealth | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (currentUserRole !== 'Administrador') {
      setLoading(false)
      return
    }
    let active = true
    Promise.all([
      api.listAdminUsers(),
      api.getAdminSettings(),
      api.listAdminAudit(),
      api.adminHealth(),
    ]).then(([userRows, savedSettings, auditRows, status]) => {
      if (!active) return
      setUsers(userRows)
      setSettings(savedSettings)
      setEvents(auditRows)
      setHealth(status)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la administración.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [currentUserRole])

  async function changeRole(userId: number, role: string) {
    try {
      const updated = await api.updateUserRole(userId, role)
      setUsers(current => current.map(user => user.id === userId ? updated : user))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el rol.')
    }
  }

  async function changeStatus(userId: number, status: string) {
    try {
      const updated = await api.updateUserStatus(userId, status)
      setUsers(current => current.map(user => user.id === userId ? updated : user))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el estado.')
    }
  }

  async function saveSettings() {
    setSaving(true)
    try {
      setSettings(await api.saveAdminSettings(settings))
      setEvents(await api.listAdminAudit())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los ajustes.')
    } finally {
      setSaving(false)
    }
  }

  if (currentUserRole !== 'Administrador') {
    return <div className="page-wrap">
      <PageHeader eyebrow="M10 · ADMINISTRATION" title="Administración y seguridad" description="Configuración global y control de acceso."/>
      <Card><EmptyState title="Acceso restringido" detail="Solo una cuenta con rol Administrador puede consultar este módulo."/></Card>
    </div>
  }

  return <div className="page-wrap">
    <PageHeader
      eyebrow="M10 · ADMINISTRATION & SECURITY"
      title="Administración y seguridad"
      description="Usuarios, roles, límites operativos y auditoría persistidos por la API."
      action={<Badge tone={health?.worker === 'online' ? 'green' : 'amber'}>Worker {health?.worker || '…'}</Badge>}
    />
    {error && <p className="auth-error" role="alert">{error}</p>}
    {loading ? <Card><EmptyState title="Cargando controles" detail="Consultando usuarios, configuración y auditoría del servidor."/></Card> : <>
      <div className="admin-stats">
        <Card><Users size={18}/><span>Usuarios</span><b>{users.length}</b></Card>
        <Card><Shield size={18}/><span>Roles configurados</span><b>{roles.length}</b></Card>
        <Card><Activity size={18}/><span>Eventos de auditoría</span><b>{events.length}</b></Card>
        <Card><LockKeyhole size={18}/><span>API / Base de datos</span><b>{health?.api === 'ok' && health.database === 'connected' ? 'Operativo' : 'Revisar'}</b></Card>
      </div>
      <div className="admin-grid">
        <Card className="table-card">
          <CardTitle title="Usuarios y roles" subtitle="Cambios validados y auditados en el backend"/>
          <div className="table-scroll"><table>
            <thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead>
            <tbody>{users.map(user => <tr key={user.id}>
              <td><b>{user.display_name}</b></td>
              <td>{user.email}</td>
              <td><select className="inline-status" value={user.role} onChange={event => changeRole(user.id, event.target.value)}>
                {roles.map(role => <option key={role}>{role}</option>)}
              </select></td>
              <td><select className="inline-status" value={user.status} onChange={event => changeStatus(user.id, event.target.value)}>
                <option>Activo</option><option>Suspendido</option>
              </select></td>
            </tr>)}</tbody>
          </table></div>
        </Card>
        <Card>
          <CardTitle title="Límites de recursos" subtitle="Se aplican a nuevas cargas y trabajos." action={<SlidersHorizontal size={17} className="muted-icon"/>}/>
          <div className="properties-form">
            <label>Trabajos concurrentes<input type="number" min="1" max="10" value={settings.max_active_jobs} onChange={event => setSettings({ ...settings, max_active_jobs: Number(event.target.value) })}/></label>
            <label>Tamaño máximo de dataset (MB)<input type="number" min="10" max="100" value={settings.max_upload_mb} onChange={event => setSettings({ ...settings, max_upload_mb: Number(event.target.value) })}/></label>
            <label>Retención (días)<input type="number" min="7" max="365" value={settings.retention_days} onChange={event => setSettings({ ...settings, retention_days: Number(event.target.value) })}/></label>
            <Button disabled={saving} onClick={saveSettings} icon={saving ? <Save size={15}/> : <Check size={15}/>}>{saving ? 'Guardando…' : 'Guardar ajustes'}</Button>
          </div>
        </Card>
      </div>
      <Card className="table-card audit-card">
        <CardTitle title="Registro de auditoría" subtitle="Eventos recientes persistidos en el servidor"/>
        <div className="table-scroll"><table>
          <thead><tr><th>Evento</th><th>Actor</th><th>Proyecto</th><th>Fecha</th></tr></thead>
          <tbody>{events.map(event => <tr key={event.id}>
            <td><code>{event.action}</code></td><td>{event.actor_id ?? 'Sistema'}</td>
            <td>{event.project_id ?? '—'}</td><td>{new Date(event.created_at).toLocaleString()}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>
    </>}
  </div>
}
