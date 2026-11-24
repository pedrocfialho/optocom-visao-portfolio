// Dados sintéticos de portfólio: nenhum dado do ambiente real.
import {fireEvent,render,screen} from '@testing-library/react'
import {describe,expect,it,vi} from 'vitest'
import {emptyPatientForm,PatientFields,patientForm,patientInput} from './PatientFields'
describe('Cadastro mínimo de pacientes',()=>{
 it('nome é o único campo obrigatório; ausências viram NULL e não dados artificiais',()=>{
  const input=patientInput({...emptyPatientForm,full_name:'  Ana Exemplo  '})
  expect(input).toEqual({full_name:'Ana Exemplo',phone:null,birth_date:null,cpf:null,admin_notes:'',active:true})
  render(<PatientFields form={emptyPatientForm} onChange={vi.fn()}/>)
  expect(screen.getByLabelText('Nome completo')).toBeRequired()
  for(const label of ['Telefone (opcional)','CPF (opcional)','Data de nascimento (opcional)','Observação administrativa (opcional)'])expect(screen.getByLabelText(label)).not.toBeRequired()
 })
 it('preserva validações dos dados informados sem exigir CPF ou nascimento',()=>{
  for(const fields of [{full_name:' '},{full_name:'A'},{full_name:'Ana Exemplo',phone:'123'},{full_name:'Ana Exemplo',cpf:'123'},{full_name:'Ana Exemplo',birth_date:'9999-01-01'}])expect(()=>patientInput({...emptyPatientForm,...fields})).toThrow()
  expect(patientInput({...emptyPatientForm,full_name:'Carlos Exemplo',phone:'(51) 99999-0001'}).phone).toBe('(51) 99999-0001')
 })
 it('editar campos opcionais não infere nem expõe o indicador de pendência',()=>{
  expect(patientInput({...emptyPatientForm,full_name:'Ana Exemplo'})).not.toHaveProperty('registration_pending')
  expect(patientInput({...emptyPatientForm,full_name:'Ana Exemplo',phone:'51999990001'})).not.toHaveProperty('registration_pending')
  expect(patientForm(null)).toEqual(emptyPatientForm)
  const change=vi.fn();render(<PatientFields form={emptyPatientForm} onChange={change}/>)
  fireEvent.change(screen.getByLabelText('Telefone (opcional)'),{target:{value:'51999990001'}})
  expect(change).toHaveBeenCalledWith({...emptyPatientForm,phone:'51999990001'})
 })
})
