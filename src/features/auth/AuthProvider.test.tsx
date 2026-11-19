// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter } from 'react-router-dom'
import { clearDataSession, sharedRead } from '../../lib/dataCache'
import { AuthProvider, useAuth } from './AuthProvider'
import { App } from '../../app/App'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getUser: vi.fn(), maybeSingle: vi.fn(), signOut: vi.fn(), signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(), updateUser: vi.fn(),
  inviteCallback: false,
  onAuthStateChange: vi.fn((_listener: (event: string, session?: { user: { id: string } } | null) => void) => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}))
vi.mock('./passwordFlow', async importOriginal => ({
  ...await importOriginal<typeof import('./passwordFlow')>(),
  get initialPasswordFlow() { return mocks.inviteCallback },
}))
vi.mock('../../lib/supabase', () => ({
  configurationError: null,
  supabase: {
    auth: mocks,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  },
}))

const profile = { id: 'admin-1', full_name: 'Pessoa Administradora', role: 'admin', active: true }
beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  clearDataSession()
  mocks.inviteCallback = false
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: profile.id } } }, error: null })
  mocks.getUser.mockResolvedValue({ data: { user: { id: profile.id } }, error: null })
  mocks.maybeSingle.mockResolvedValue({ data: profile, error: null })
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null })
  mocks.updateUser.mockResolvedValue({ error: null })
})

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const mounted = vi.fn(), unmounted = vi.fn()
function MountedEditor() {
  useEffect(() => { mounted(); return () => { unmounted() } }, [])
  return <><input aria-label="Rascunho preservado" defaultValue="rascunho" /><Link to="/outra-rota">Navegar</Link></>
}
function SecurityGate() {
  const { state, refresh, signOut } = useAuth()
  return <><p>{state.status}</p><button onClick={refresh}>Revalidar</button><button onClick={() => void signOut().catch(() => {})}>Logout seguro</button>{state.status === 'authenticated' && <MountedEditor />}</>
}

describe('Revalidação sem desmontagem e sem redução de autorização', () => {
  it('deduplica montagem, INITIAL_SESSION e foco concorrentes', async () => {
    const pending = deferred<unknown>(); mocks.getUser.mockReturnValue(pending.promise)
    render(<AuthProvider><SecurityGate /></AuthProvider>, { wrapper: MemoryRouter })
    await waitFor(() => expect(mocks.getUser).toHaveBeenCalledTimes(1))
    fireEvent.focus(window); fireEvent.focus(window)
    act(() => { mocks.onAuthStateChange.mock.calls[0][0]('INITIAL_SESSION') })
    expect(mocks.getUser).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Rascunho preservado')).not.toBeInTheDocument()
    await act(async () => pending.resolve({ data: { user: { id: profile.id } }, error: null }))
    expect(await screen.findByText('authenticated')).toBeInTheDocument()
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('mantém editor e rascunho ao navegar/revalidar, mas consulta admin novamente', async () => {
    render(<AuthProvider><SecurityGate /></AuthProvider>, { wrapper: MemoryRouter })
    const input = await screen.findByLabelText('Rascunho preservado')
    fireEvent.change(input, { target: { value: 'valor não salvo' } })
    const pending = deferred<unknown>(); mocks.getUser.mockReturnValueOnce(pending.promise)
    await userEvent.click(screen.getByRole('link', { name: 'Navegar' }))
    await waitFor(() => expect(mocks.getUser).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Rascunho preservado')).toBe(input)
    expect(input).toHaveValue('valor não salvo')
    expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled()
    await act(async () => pending.resolve({ data: { user: { id: profile.id } }, error: null }))
    await waitFor(() => expect(mocks.maybeSingle).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Rascunho preservado')).toBe(input)
  })

  it.each(['inactive', 'missing', 'role', 'wrong-id', 'profile-error', 'user-error', 'expired', 'no-session'])('revoga tela/cache quando revalidação falha: %s', async failure => {
    render(<AuthProvider><SecurityGate /></AuthProvider>, { wrapper: MemoryRouter })
    await screen.findByLabelText('Rascunho preservado')
    const load = vi.fn().mockResolvedValue('cache antigo')
    await sharedRead('catalog:security-test', load, 60000)
    if (failure === 'inactive') mocks.maybeSingle.mockResolvedValue({ data: { ...profile, active: false }, error: null })
    if (failure === 'missing') mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    if (failure === 'role') mocks.maybeSingle.mockResolvedValue({ data: { ...profile, role: 'viewer' }, error: null })
    if (failure === 'wrong-id') mocks.maybeSingle.mockResolvedValue({ data: { ...profile, id: 'outro' }, error: null })
    if (failure === 'profile-error') mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: '42501' } })
    if (failure === 'user-error') mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid token' } })
    if (failure === 'expired') mocks.getSession.mockResolvedValue({ data: { session: { user: { id: profile.id }, expires_at: 1 } }, error: null })
    if (failure === 'no-session') mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    fireEvent.focus(window)
    await waitFor(() => expect(screen.queryByLabelText('Rascunho preservado')).not.toBeInTheDocument())
    await sharedRead('catalog:security-test', load, 60000)
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('authenticated')).not.toBeInTheDocument()
  })

  it('SIGNED_OUT bloqueia imediatamente e resposta antiga não restaura acesso', async () => {
    render(<AuthProvider><SecurityGate /></AuthProvider>, { wrapper: MemoryRouter })
    await screen.findByLabelText('Rascunho preservado')
    const pending = deferred<unknown>(); mocks.getUser.mockReturnValueOnce(pending.promise)
    fireEvent.focus(window)
    await waitFor(() => expect(mocks.getUser).toHaveBeenCalledTimes(2))
    act(() => { mocks.onAuthStateChange.mock.calls[0][0]('SIGNED_OUT') })
    expect(screen.getByText('signedOut')).toBeInTheDocument()
    expect(screen.queryByLabelText('Rascunho preservado')).not.toBeInTheDocument()
    await act(async () => pending.resolve({ data: { user: { id: profile.id } }, error: null }))
    fireEvent.focus(window)
    expect(screen.getByText('signedOut')).toBeInTheDocument()
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('não aceita divergência entre a identidade da sessão e getUser', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'outro' } }, error: null })
    render(<AuthProvider><SecurityGate /></AuthProvider>, { wrapper: MemoryRouter })
    expect(await screen.findByText('error')).toBeInTheDocument()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })
  it('logout pendente/falho permanece bloqueado mesmo com evento antigo SIGNED_IN', async () => {
    render(<AuthProvider><SecurityGate /></AuthProvider>, { wrapper: MemoryRouter })
    await screen.findByLabelText('Rascunho preservado')
    const pending = deferred<unknown>(); mocks.signOut.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Logout seguro' }))
    expect(screen.queryByLabelText('Rascunho preservado')).not.toBeInTheDocument()
    await act(async () => { mocks.onAuthStateChange.mock.calls[0][0]('SIGNED_IN', { user: { id: profile.id } }) })
    expect(mocks.getUser).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve({ error: { message: 'offline' } }))
    expect(screen.getByText('error')).toBeInTheDocument()
    fireEvent.focus(window); expect(screen.queryByText('authenticated')).not.toBeInTheDocument()
  })
  it('revalidação sem resposta bloqueia em 15s e uma resposta tardia não restaura acesso', async () => {
    const view = render(<AuthProvider><SecurityGate /></AuthProvider>, { wrapper: MemoryRouter })
    await screen.findByLabelText('Rascunho preservado')
    vi.useFakeTimers()
    try {
      const pending = deferred<unknown>(); mocks.getUser.mockReturnValueOnce(pending.promise)
      fireEvent.focus(window); await act(async () => {})
      expect(screen.getByLabelText('Rascunho preservado')).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
      expect(screen.getByText('error')).toBeInTheDocument()
      expect(screen.queryByLabelText('Rascunho preservado')).not.toBeInTheDocument()
      await act(async () => pending.resolve({ data: { user: { id: profile.id } }, error: null }))
      expect(screen.getByText('error')).toBeInTheDocument()
      view.unmount(); expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})

function Probe() {
  const { state, signOut } = useAuth()
  return <><p>{state.status}</p><button onClick={() => void signOut()}>Sair</button></>
}
describe('Autenticação com Supabase configurado', () => {
  it('valida o usuário e o perfil antes de liberar acesso, e encerra sessão', async () => {
    render(<AuthProvider><Probe /></AuthProvider>, { wrapper: MemoryRouter })
    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(await screen.findByText('authenticated')).toBeInTheDocument()
    expect(mocks.getUser).toHaveBeenCalled()
    await userEvent.click(screen.getByText('Sair'))
    expect(await screen.findByText('signedOut')).toBeInTheDocument()
  })
  it.each([null, { ...profile, active: false }, { ...profile, role: 'viewer' }])('bloqueia perfil ausente, inativo ou sem papel admin: %s', async data => {
    mocks.maybeSingle.mockResolvedValue({ data, error: null })
    render(<AuthProvider><Probe /></AuthProvider>, { wrapper: MemoryRouter })
    expect(await screen.findByText('denied')).toBeInTheDocument()
  })
  it('falha de rede não libera acesso', async () => {
    mocks.getUser.mockRejectedValue(new Error('offline'))
    render(<AuthProvider><Probe /></AuthProvider>, { wrapper: MemoryRouter })
    expect(await screen.findByText('error')).toBeInTheDocument()
  })
  it('bloqueia a prévia quando há backend e apresenta login para sessão ausente', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    render(<MemoryRouter initialEntries={['/visualizar/dashboard']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Validando acesso…/)).not.toBeInTheDocument())
    expect(screen.queryByText(/Conhecer a estrutura visual/)).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
  it('mostra erro genérico em login inválido', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid credentials' } })
    render(<MemoryRouter initialEntries={['/login']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    await userEvent.type(await screen.findByLabelText('E-mail'), 'admin@example.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-incorreta')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar no sistema' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível entrar')
  })
  it('envia recuperação sem revelar se o e-mail tem conta', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    render(<MemoryRouter initialEntries={['/recuperar-senha']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    await userEvent.type(screen.getByLabelText('E-mail'), 'admin@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }))
    expect(await screen.findByText(/Se houver uma conta para este e-mail/)).toBeInTheDocument()
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('admin@example.com', expect.objectContaining({ redirectTo: expect.stringContaining('/definir-senha') }))
  })
  it('recusa definição de senha sem sessão e exige confirmação com sessão', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const view = render(<MemoryRouter initialEntries={['/definir-senha']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    expect(await screen.findByText(/Abra um convite ou link de recuperação válido/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument()
    view.unmount()
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: profile.id } } }, error: null })
    render(<MemoryRouter initialEntries={['/definir-senha']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'senha-segura-1234')
    await userEvent.type(screen.getByLabelText('Confirme a senha'), 'senha-diferente-1234')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(await screen.findByText('As senhas devem ser iguais.')).toBeInTheDocument()
    expect(mocks.updateUser).not.toHaveBeenCalled()
    await userEvent.clear(screen.getByLabelText('Confirme a senha'))
    await userEvent.type(screen.getByLabelText('Confirme a senha'), 'senha-segura-1234')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'senha-segura-1234' }))
  })
  it('encaminha convite recebido no Site URL para definir senha, sem consultar perfis', async () => {
    mocks.inviteCallback = true
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST205' } })
    render(<MemoryRouter initialEntries={['/']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    expect(await screen.findByLabelText('Nova senha')).toBeInTheDocument()
    expect(mocks.getUser).toHaveBeenCalled()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('optocom.password-setup-user')).toBe(profile.id)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
  it('mantém o convite pendente após recarregar ou abrir outra rota', async () => {
    window.sessionStorage.setItem('optocom.password-setup-user', profile.id)
    render(<MemoryRouter initialEntries={['/dashboard']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    expect(await screen.findByLabelText('Nova senha')).toBeInTheDocument()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })
  it('não libera definição de senha por tipo de convite sem sessão válida', async () => {
    mocks.inviteCallback = true
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid session' } })
    render(<MemoryRouter initialEntries={['/']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    expect(await screen.findByText(/Não foi possível validar seu acesso/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })
  it('permite recuperar uma sessão já aceita mesmo sem a tabela de perfis', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST205' } })
    render(<MemoryRouter initialEntries={['/login']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    expect(await screen.findByText(/estrutura de perfis ainda não está disponível/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Definir ou alterar minha senha' }))
    expect(await screen.findByLabelText('Nova senha')).toBeInTheDocument()
  })
  it('somente consulta o perfil depois de salvar a senha, e mantém o sistema bloqueado sem perfil', async () => {
    mocks.inviteCallback = true
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST205' } })
    render(<MemoryRouter initialEntries={['/']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'senha-de-teste-1234')
    await userEvent.type(screen.getByLabelText('Confirme a senha'), 'senha-de-teste-1234')
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(await screen.findByText(/Senha definida com sucesso/)).toBeInTheDocument()
    expect(await screen.findByText(/estrutura de perfis ainda não está disponível/)).toBeInTheDocument()
    expect(window.sessionStorage.getItem('optocom.password-setup-user')).toBeNull()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
  it('recuperação de senha também dispensa perfil antes de salvar', async () => {
    render(<MemoryRouter initialEntries={['/login']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    await screen.findByRole('heading', { name: 'OPTOCOM Visão' })
    const listener = mocks.onAuthStateChange.mock.calls[0][0]
    const { act } = await import('@testing-library/react')
    await act(async () => { listener('PASSWORD_RECOVERY') })
    expect(await screen.findByLabelText('Nova senha')).toBeInTheDocument()
  })
  it('falha ao salvar senha mantém a etapa pendente e não consulta perfis', async () => {
    mocks.inviteCallback = true
    mocks.updateUser.mockResolvedValue({ error: { message: 'Password update failed' } })
    render(<MemoryRouter initialEntries={['/']}><AuthProvider><App /></AuthProvider></MemoryRouter>)
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'senha-de-teste-1234')
    await userEvent.type(screen.getByLabelText('Confirme a senha'), 'senha-de-teste-1234')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(await screen.findByText(/Não foi possível concluir/)).toBeInTheDocument()
    expect(window.sessionStorage.getItem('optocom.password-setup-user')).toBe(profile.id)
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })
})
