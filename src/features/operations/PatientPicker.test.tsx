// Dados sintéticos de portfólio: nenhum dado do ambiente real.
import {act,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {PatientPicker} from './shared'
const mocks=vi.hoisted(()=>({search:vi.fn()}))
vi.mock('./api',()=>({searchPatients:mocks.search,errorText:(error:Error)=>error.message}))
beforeEach(()=>{vi.useFakeTimers();mocks.search.mockReset().mockResolvedValue([])})
afterEach(()=>vi.useRealTimers())
const type=(value:string)=>fireEvent.change(screen.getByRole('combobox',{name:'Paciente'}),{target:{value}})
const tick=()=>act(async()=>{await vi.advanceTimersByTimeAsync(300)})
describe('Busca e seleção explícita na Agenda',()=>{
 it('indicação nas sugestões usa o estado explícito, independentemente do telefone',async()=>{
  mocks.search.mockResolvedValue([{id:'complete-example',full_name:'Completo Exemplo',phone:null,registration_pending:false},{id:'pending-example',full_name:'Pendente Exemplo',phone:'51999990001',registration_pending:true}])
  render(<PatientPicker id="" name="" onChange={vi.fn()}/>);type('Exemplo');await tick()
  expect(screen.getByRole('option',{name:/^Completo Exemplo/})).not.toHaveTextContent('Cadastro pendente')
  expect(screen.getByRole('option',{name:/^Pendente Exemplo/})).toHaveTextContent('Cadastro pendente')
 })
 it('espera o debounce e as sugestões antes de oferecer cadastro novo; não grava durante a busca',async()=>{
  const onNew=vi.fn(),onChange=vi.fn();render(<PatientPicker id="" name="" onChange={onChange} onNew={onNew}/>)
  type('Ana');type('Ana Exemplo');expect(mocks.search).not.toHaveBeenCalled();expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await tick();expect(mocks.search).toHaveBeenCalledTimes(1)
  expect(mocks.search).toHaveBeenCalledWith('Ana Exemplo',0,true)
  expect(onNew).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('option',{name:'+ Agendar novo paciente: Ana Exemplo'}))
  expect(onNew).toHaveBeenCalledWith('Ana Exemplo');expect(onChange).not.toHaveBeenCalled()
 })
 it('apresenta existentes e permite escolher um homônimo diferente sem fusão automática',async()=>{
  mocks.search.mockResolvedValue([{id:'existing-example',full_name:'Ana Exemplo',phone:'51999990001'}])
  const onChange=vi.fn(),onNew=vi.fn();render(<PatientPicker id="" name="" onChange={onChange} onNew={onNew}/>)
  type('Ana Exemplo');await tick()
  expect(screen.getAllByRole('option')).toHaveLength(2)
  fireEvent.click(screen.getByRole('option',{name:/^Ana Exemplo/}))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({id:'existing-example'}));expect(onNew).not.toHaveBeenCalled()
 })
 it('ignora resultado de termo antigo e não oferece criação quando a pesquisa falha',async()=>{
  let resolve!:(value:unknown[])=>void
  mocks.search.mockReturnValueOnce(new Promise(r=>{resolve=r})).mockRejectedValueOnce(new Error('Falha de pesquisa'))
  render(<PatientPicker id="" name="" onChange={vi.fn()} onNew={vi.fn()}/>)
  type('Antigo Exemplo');await tick();type('Atual Exemplo');await tick()
  await act(async()=>resolve([{id:'old-example',full_name:'Antigo Exemplo',phone:null}]))
  expect(screen.queryByText('Antigo Exemplo')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('Falha de pesquisa');expect(screen.queryByRole('option')).not.toBeInTheDocument()
 })
 it('a ação de novo paciente é restrita à Agenda e não interpreta um telefone como nome',async()=>{
  const view=render(<PatientPicker id="" name="" onChange={vi.fn()}/>)
  type('Carlos Exemplo');await tick();expect(screen.queryByRole('option')).not.toBeInTheDocument()
  view.rerender(<PatientPicker id="" name="" onChange={vi.fn()} onNew={vi.fn()}/>);type('51999990001');await tick();expect(screen.queryByRole('option')).not.toBeInTheDocument()
 })
 it('permite a ação pelo teclado e mantém o novo paciente apenas como rascunho',async()=>{
  const onNew=vi.fn();render(<PatientPicker id="" name="" onChange={vi.fn()} onNew={onNew}/>)
  type('Carlos Exemplo');await tick();fireEvent.keyDown(screen.getByRole('combobox'),{key:'Enter'})
  expect(onNew).toHaveBeenCalledTimes(1)
 })
})
