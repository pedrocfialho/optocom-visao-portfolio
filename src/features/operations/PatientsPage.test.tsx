// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PatientsPage } from './PatientsPage'
const mocks = vi.hoisted(() => ({ search: vi.fn(), visits: vi.fn() }))
vi.mock('./api', () => ({ searchPatients: mocks.search, visits: mocks.visits, errorText: (e: Error) => e.message }))
beforeEach(() => { vi.useFakeTimers(); mocks.search.mockReset().mockResolvedValue([]); mocks.visits.mockResolvedValue([]) })
afterEach(() => vi.useRealTimers())
async function open() { const view = render(<MemoryRouter><PatientsPage /></MemoryRouter>); await act(async () => {}); return view }
describe('Pesquisa de pacientes com debounce e isolamento de respostas', () => {
  it('oito teclas rápidas geram uma nova RPC após 300ms', async () => {
    const view = await open(); const input = screen.getByLabelText('Pesquisar por nome ou telefone')
    let query = ''
    for (const char of 'AnaExemplo') { query += char; fireEvent.change(input, { target: { value: query } }); await act(async () => { await vi.advanceTimersByTimeAsync(80) }) }
    expect(mocks.search).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(220) })
    expect(mocks.search).toHaveBeenCalledTimes(2); expect(mocks.search).toHaveBeenLastCalledWith('AnaExemplo', 0, true)
    view.unmount(); expect(vi.getTimerCount()).toBe(0)
  })
  it('resposta antiga que termina depois não substitui os resultados novos', async () => {
    let resolve!: (value: unknown[]) => void
    mocks.search.mockReturnValueOnce(new Promise(r => { resolve = r })).mockResolvedValue([{ id: 'novo', full_name: 'Ana Exemplo atual', phone: '51999990001', active: true }])
    await open(); fireEvent.change(screen.getByLabelText('Pesquisar por nome ou telefone'), { target: { value: 'Maria' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.getByText('Ana Exemplo atual')).toBeInTheDocument()
    await act(async () => resolve([{ id: 'antigo', full_name: 'Resposta antiga', phone: '51999990001', active: true }]))
    expect(screen.queryByText('Resposta antiga')).not.toBeInTheDocument()
    expect(screen.getByText('Ana Exemplo atual')).toBeInTheDocument()
  })
  it('reinicia paginação sem consultar o termo anterior enquanto digita', async () => {
    mocks.search.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ id: String(i), full_name: 'Paciente ' + i, phone: '51999990001', active: true })))
    await open(); fireEvent.click(screen.getAllByRole('button', { name: 'Próxima' })[0]); await act(async () => {})
    expect(mocks.search).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByLabelText('Pesquisar por nome ou telefone'), { target: { value: 'Outro' } }); await act(async () => {})
    expect(mocks.search).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(mocks.search).toHaveBeenCalledTimes(3); expect(mocks.search).toHaveBeenLastCalledWith('Outro', 0, true)
  })
})
