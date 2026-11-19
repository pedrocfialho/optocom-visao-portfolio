import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase, configurationError } from '../../lib/supabase'
import type { Profile } from '../../lib/database.types'
import { useLocation } from 'react-router-dom'
import { initialPasswordFlow, PASSWORD_SETUP_STORAGE_KEY } from './passwordFlow'
import { clearDataSession, setDataSession } from '../../lib/dataCache'

export type AuthState =
  | { status: 'loading' | 'signedOut' | 'unconfigured' | 'passwordSetup' }
  | { status: 'authenticated'; profile: Pick<Profile, 'id' | 'full_name' | 'role' | 'active'> }
  | { status: 'denied' | 'error'; message: string }

type AuthContextValue = {
  state: AuthState
  sessionUserId: string | null
  refresh: () => void
  signOut: () => Promise<void>
  finishPasswordSetup: () => void
}
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const currentPath = useRef(pathname)
  currentPath.current = pathname
  const passwordIntent = useRef(initialPasswordFlow)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [state, setState] = useState<AuthState>(configurationError
    ? { status: 'error', message: configurationError }
    : { status: supabase ? 'loading' : 'unconfigured' })
  const generation = useRef(0)
  const stateRef = useRef(state)
  const inFlight = useRef<Promise<void> | null>(null)
  const loggedOut = useRef(false)
  const signingOut = useRef(false)
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function publish(next: AuthState) { stateRef.current = next; setState(next) }
  function invalidate() { generation.current++; inFlight.current = null; clearTimeout(deadline.current); deadline.current = undefined }
  const refresh = useCallback(() => {
    const client = supabase
    if (!client || inFlight.current || loggedOut.current || signingOut.current) return
    const request = ++generation.current
    // Revalidação da mesma identidade não desmonta telas já autorizadas.
    // Qualquer falha abaixo revoga a autorização e limpa o cache imediatamente.
    if (stateRef.current.status !== 'authenticated') publish({ status: 'loading' })
    const block = (next: AuthState, keepVerifiedUser = false) => {
      if (request !== generation.current) return
      clearDataSession()
      if (!keepVerifiedUser) setSessionUserId(null)
      publish(next)
    }
    // Não manter uma autorização antiga indefinidamente numa conexão sem resposta.
    const timer = setTimeout(() => {
      if (request !== generation.current) return
      invalidate(); clearDataSession(); setSessionUserId(null)
      publish({ status: 'error', message: 'Não foi possível validar seu acesso. Verifique a conexão e tente novamente.' })
    }, 15_000)
    deadline.current = timer
    const task = (async () => {
      try {
        const { data: session, error: sessionError } = await client.auth.getSession()
        if (sessionError) throw sessionError
        if (request !== generation.current) return
        if (!session.session || (session.session.expires_at && session.session.expires_at <= Date.now() / 1000)) {
          block({ status: 'signedOut' })
          return
        }
        if (stateRef.current.status === 'authenticated' && stateRef.current.profile.id !== session.session.user.id) {
          clearDataSession(); setSessionUserId(null); publish({ status: 'loading' })
        }
        const { data, error } = await client.auth.getUser()
        if (error || !data.user || data.user.id !== session.session.user.id) throw error ?? new Error('Sessão inválida')
        if (request !== generation.current) return
        setSessionUserId(data.user.id)
        const pendingUser = window.sessionStorage.getItem(PASSWORD_SETUP_STORAGE_KEY)
        if (passwordIntent.current || pendingUser === data.user.id || currentPath.current === '/definir-senha') {
          passwordIntent.current = true
          window.sessionStorage.setItem(PASSWORD_SETUP_STORAGE_KEY, data.user.id)
          clearDataSession(); publish({ status: 'passwordSetup' })
          return
        }
        const { data: profile, error: profileError } = await client.from('users_profile').select('id,full_name,role,active').eq('id', data.user.id).maybeSingle()
        if (request !== generation.current) return
        if (profileError && ['PGRST205', '42P01'].includes(profileError.code)) {
          block({ status: 'denied', message: 'Sua sessão no Supabase foi validada, mas a estrutura de perfis ainda não está disponível. É necessário aplicar a migration da Fase 1 e criar seu perfil administrativo para acessar a clínica.' }, true)
          return
        }
        if (profileError) throw profileError
        if (profile?.id === data.user.id && profile.active && profile.role === 'admin') {
          setDataSession(data.user.id); publish({ status: 'authenticated', profile })
        } else block({ status: 'denied', message: 'Seu usuário não possui um perfil de administrador ativo. Solicite a liberação ao responsável pela configuração.' }, true)
      } catch {
        block({ status: 'error', message: 'Não foi possível validar seu acesso. Verifique a conexão e a configuração do Supabase.' })
      }
    })()
    inFlight.current = task
    void task.finally(() => {
      clearTimeout(timer)
      if (deadline.current === timer) deadline.current = undefined
      if (inFlight.current === task) inFlight.current = null
    })
  }, [])

  useEffect(() => {
    if (!supabase) return
    // Não aguardar chamadas Supabase dentro do callback de autenticação.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        loggedOut.current = true
        invalidate(); clearDataSession(); setSessionUserId(null)
        passwordIntent.current = false
        window.sessionStorage.removeItem(PASSWORD_SETUP_STORAGE_KEY)
        publish({ status: 'signedOut' })
        return
      }
      if (event === 'SIGNED_IN' && !signingOut.current) loggedOut.current = false
      if (event === 'PASSWORD_RECOVERY') {
        invalidate(); clearDataSession(); passwordIntent.current = true
        setSessionUserId(null); publish({ status: 'loading' })
      } else if (session && stateRef.current.status === 'authenticated' && session.user.id !== stateRef.current.profile.id) {
        invalidate(); clearDataSession(); setSessionUserId(null); publish({ status: 'loading' })
      }
      queueMicrotask(refresh)
    })
    window.addEventListener('focus', refresh)
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { subscription.unsubscribe(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); invalidate() }
  }, [refresh])

  useEffect(() => { refresh() }, [pathname, refresh])

  function finishPasswordSetup() {
    invalidate(); clearDataSession()
    passwordIntent.current = false
    window.sessionStorage.removeItem(PASSWORD_SETUP_STORAGE_KEY)
    setSessionUserId(null)
    publish({ status: 'loading' })
  }

  async function signOut() {
    if (!supabase) return
    signingOut.current = true
    loggedOut.current = true
    invalidate(); clearDataSession(); setSessionUserId(null); publish({ status: 'loading' })
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      finishPasswordSetup()
      setSessionUserId(null)
      publish({ status: 'signedOut' })
    } catch {
      invalidate(); clearDataSession(); setSessionUserId(null)
      publish({ status: 'error', message: 'Não foi possível encerrar a sessão. Tente novamente.' })
      throw new Error('Não foi possível encerrar a sessão. Tente novamente.')
    } finally { signingOut.current = false }
  }

  return <AuthContext.Provider value={{ state, sessionUserId, refresh, signOut, finishPasswordSetup }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider ausente')
  return value
}
