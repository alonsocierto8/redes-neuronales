import type { ReactNode } from 'react'
import { Search, ChevronRight, Plus, Download, MoreHorizontal } from 'lucide-react'

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow || 'NEUROLAB WORKSPACE'}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="header-action">{action}</div>}</div>
}
export function Button({ children, variant = 'primary', onClick, icon, block = false, type = 'button', disabled = false }: { children: ReactNode; variant?: 'primary'|'secondary'|'ghost'|'danger'; onClick?: () => void; icon?: ReactNode; block?: boolean; type?: 'button'|'submit'; disabled?: boolean }) {
  return <button type={type} disabled={disabled} className={`btn btn-${variant}${block ? ' btn-block' : ''}`} onClick={onClick}>{icon}{children}</button>
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral'|'green'|'blue'|'amber'|'red'|'purple' }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" />{children}</span>
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section> }
export function CardTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) { return <div className="card-title"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div> }
export function SearchBox({ value, onChange, placeholder = 'Buscar...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="search-box"><Search size={16}/><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/></label>
}
export function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><div className="empty-icon"><Search size={20}/></div><b>{title}</b><span>{detail}</span></div> }
export function SectionLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-link" onClick={onClick}>{children}<ChevronRight size={15}/></button> }
export function IconButton({ label, onClick }: { label: string; onClick?: () => void }) { return <button className="icon-btn" aria-label={label} title={label} onClick={onClick}><MoreHorizontal size={17}/></button> }
export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <Button onClick={onClick} icon={<Plus size={16}/ >}>{children}</Button> }
export function ExportButton({ onClick, children = 'Exportar' }: { onClick: () => void; children?: ReactNode }) { return <Button variant="secondary" onClick={onClick} icon={<Download size={15}/ >}>{children}</Button> }
