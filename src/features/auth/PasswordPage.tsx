import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Brand } from '../../components/Brand'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'

export function PasswordPage({ mode }: { mode: 'request' | 'update' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const { state, sessionUserId, finishPasswordSetup } = useAuth()
  const navigate = useNavigate()
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setMessage('')
    try {
      if (mode === 'request') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/definir-senha` })
        if (error) throw error
        setMessage('Se houver uma conta para este e-mail, você receberá as instruções para definir uma nova senha.')
      } else {
        if (password !== confirmation) { setMessage('As senhas devem ser iguais.'); return }
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setPassword(''); setConfirmation(''); finishPasswordSetup()
        navigate('/login', { replace: true, state: { passwordUpdated: true } })
      }
    } catch { setMessage('Não foi possível concluir. Verifique sua conexão ou solicite um novo link de acesso.') }
    finally { setBusy(false) }
  }
  const allowed = mode === 'request' || !!sessionUserId
  return <main className="password-layout"><div className="password-brand"><Brand /></div><section className="panel password-card"><h1>{mode === 'request' ? 'Recuperar acesso' : 'Definir sua senha'}</h1><p>{mode === 'request' ? 'Enviaremos um link para o seu e-mail.' : 'Use uma senha exclusiva com pelo menos 12 caracteres.'}</p>
    {!allowed ? <p role="status">{state.status === 'loading' ? 'Validando o link…' : 'Abra um convite ou link de recuperação válido para continuar.'}</p> : <form onSubmit={submit}>{mode === 'request' ? <><label htmlFor="recovery-email">E-mail</label><input id="recovery-email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></> : <><label htmlFor="new-password">Nova senha</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /><label htmlFor="confirm-password">Confirme a senha</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></>}<button className="button primary full-button" disabled={busy || !supabase}>{busy ? 'Aguarde…' : mode === 'request' ? 'Enviar instruções' : 'Salvar senha'}</button></form>}
    {!supabase && <p className="notice">O Supabase ainda não foi conectado.</p>}{message && <p role="status">{message}</p>}<Link className="text-link" to="/login">Voltar ao acesso</Link>
  </section></main>
}
