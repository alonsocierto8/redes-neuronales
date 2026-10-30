import { useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { api, type AuthUser } from '../lib/api'
import { Button, Card } from '../components/Primitives'

export default function Auth({ onAuthenticated }: { onAuthenticated: (token: string, user: AuthUser) => void }) {
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = registering
        ? await api.register(email, name, password)
        : await api.login(email, password)
      onAuthenticated(result.access_token, result.user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar el acceso.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <Card className="auth-card">
      <div className="auth-brand"><BrainCircuit size={25}/><b>neuro<span>lab</span></b></div>
      <h1>{registering ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
      <p>NeuroLab Enterprise · Plataforma para modelos CNN</p>
      <form className="properties-form" onSubmit={submit}>
        {registering && <label>Nombre<input required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} autoComplete="name"/></label>}
        <label>Correo electrónico<input required type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email"/></label>
        <label>Contraseña<input required minLength={registering ? 12 : 1} type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={registering ? 'new-password' : 'current-password'}/>{registering&&<small>Al menos 12 caracteres.</small>}</label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <Button block type="submit" disabled={busy}>{busy ? 'Conectando…' : registering ? 'Crear cuenta' : 'Entrar'}</Button>
      </form>
      <button className="auth-toggle" onClick={() => {setRegistering(!registering);setError('')}}>
        {registering ? '¿Ya tienes cuenta? Inicia sesión' : '¿Primera vez? Crea una cuenta'}
      </button>
      <small>La primera cuenta creada tendrá rol de administrador.</small>
    </Card>
  </main>
}
