// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {fireEvent,render,screen} from '@testing-library/react'
import {describe,expect,it,vi} from 'vitest'
import {Modal} from './Modal'
describe('Modal em primeiro plano e sem estado persistente',()=>{
 it('identifica o diálogo, bloqueia a rolagem, permite ESC e restaura foco ao desmontar',()=>{
  const trigger=document.createElement('button');document.body.appendChild(trigger);trigger.focus()
  const close=vi.fn(),view=render(<Modal title="Novo cadastro" onClose={close}><label>Nome<input/></label></Modal>)
  expect(screen.getByRole('dialog',{name:'Novo cadastro'})).toHaveAttribute('open');expect(document.documentElement.style.overflow).toBe('hidden')
  fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}));expect(close).toHaveBeenCalledOnce()
  view.unmount();expect(document.documentElement.style.overflow).toBe('');expect(document.activeElement).toBe(trigger);trigger.remove()
 })
 it('não permite fechar durante operação em andamento',()=>{
  const close=vi.fn();render(<Modal title="Salvando" onClose={close} busy><input/></Modal>);fireEvent(screen.getByRole('dialog'),new Event('cancel',{cancelable:true}));expect(close).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Fechar janela'})).toBeDisabled()
 })
 it('ESC no diálogo de exceção não fecha os detalhes que estão atrás',()=>{
  const parent=vi.fn(),child=vi.fn();render(<Modal title="Detalhes" onClose={parent}><Modal title="Exceção" onClose={child}><input/></Modal></Modal>)
  fireEvent(screen.getByRole('dialog',{name:'Exceção'}),new Event('cancel',{bubbles:true,cancelable:true}))
  expect(child).toHaveBeenCalledOnce();expect(parent).not.toHaveBeenCalled()
 })
})
