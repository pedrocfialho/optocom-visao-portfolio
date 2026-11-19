// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from '../features/auth/AuthProvider'
import { navigation } from './navigation'

vi.mock('../lib/supabase', () => ({ supabase: null, configurationError: null }))
function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
}

describe('Fundação sem Supabase', () => {
  it('exige login nas rotas protegidas, inclusive por acesso direto', async () => {
    open('/pacientes')
    expect(await screen.findByText('Bem-vindo à OPTOCOM')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
  it.each(['/financeiro','/configuracoes/financeiro','/fechamento-diario'])('protege acesso financeiro direto a %s',async path=>{
    open(path)
    expect(await screen.findByText('Bem-vindo à OPTOCOM')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
  it('abre uma prévia explicitamente identificada e navega pelos 15 módulos', async () => {
    const user = userEvent.setup()
    open('/login')
    await user.click(screen.getByRole('link', { name: /Conhecer a estrutura visual/ }))
    expect(await screen.findByText(/Prévia visual · Sem dados reais/,{}, {timeout:5000})).toBeInTheDocument()
    const nav = screen.getByRole('navigation')
    expect(nav.querySelectorAll('a')).toHaveLength(15)
    for (const item of navigation) {
      await user.click(screen.getByRole('link', { name: item.title }))
      expect(await screen.findByRole('heading', { level: 1, name: item.path === 'dashboard' ? 'OPTOCOM Visão' : item.title })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /Salvar|Cadastrar|Fazer backup/ })).not.toBeInTheDocument()
  },15000)
  it('abre e fecha a navegação móvel e oferece retorno para URL inexistente', async () => {
    const user = userEvent.setup()
    open('/visualizar/inexistente')
    expect(await screen.findByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }))
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false')
  })
})
