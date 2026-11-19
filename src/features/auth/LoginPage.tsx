import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Brand } from '../../components/Brand'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'

export function LoginPage() {
  const { state, sessionUserId, refresh, signOut } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  if (state.status === 'authenticated') return <Navigate to="/dashboard" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setMessage('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) setMessage('Não foi possível entrar. Confira seu e-mail e senha ou tente novamente mais tarde.')
      else { setPassword(''); refresh() }
    } catch { setMessage('Não foi possível conectar. Verifique sua conexão e tente novamente.') }
    finally { setBusy(false) }
  }

  return <main className="login-layout">
    <section className="login-story"><Brand /><div><span className="eyebrow">OPTOCOM VISÃO</span><h1>Mais clareza para<br />cuidar da sua clínica.</h1><p>Agenda, atendimento e gestão financeira.<br />Um só lugar para acompanhar cada detalhe.</p><div className="story-detail"><ShieldCheck size={20} /> Acesso individual e seguro para a equipe</div></div><small>Gestão simples. Cuidado em cada etapa.</small></section>
    <section className="login-side"><div className="login-card"><span className="login-symbol"><LockKeyhole size={24} /></span><h2>Bem-vindo à OPTOCOM</h2><p>Entre com seu acesso de administrador.</p>
      {state.status === 'unconfigured' ? <><div className="notice"><strong>A estrutura inicial está pronta.</strong><p>O acesso da equipe será habilitado após a conexão com o Supabase.</p></div><Link className="button primary full-button" to="/visualizar/dashboard">Conhecer a estrutura visual <ArrowRight size={17} /></Link><p className="fine-print">Prévia sem dados de pacientes e sem gravação de informações.</p></> : <>
        {location.state?.passwordUpdated && <p className="notice" role="status">Senha definida com sucesso. O acesso à clínica depende da validação do seu perfil administrativo.</p>}
        {(state.status === 'error' || state.status === 'denied') && <div className="notice error" role="alert">{state.message}<div className="inline-actions"><button className="button" onClick={refresh}>Tentar novamente</button><button className="button" onClick={() => void signOut().catch(e => setMessage(e.message))}>Encerrar sessão</button></div></div>}
        {sessionUserId && <Link className="text-link" to="/definir-senha">Definir ou alterar minha senha</Link>}
        <form onSubmit={submit}><label htmlFor="email">E-mail</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Seu e-mail de acesso" /><label htmlFor="password">Senha</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Sua senha" />
          {message && <p role="alert" className="form-error">{message}</p>}<button className="button primary full-button" disabled={!supabase || busy || state.status === 'loading'}>{busy || state.status === 'loading' ? 'Validando acesso…' : 'Entrar no sistema'}<ArrowRight size={17} /></button>
        </form><Link className="text-link" to="/recuperar-senha">Esqueci minha senha</Link>
      </>}<div className="login-footer"><ShieldCheck size={15} /> Acesso restrito aos administradores da clínica</div>
    </div></section>
  </main>
}
