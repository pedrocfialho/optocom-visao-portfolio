// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {useState} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {describe,expect,it} from 'vitest'
import type {FeeRule,FinanceCatalogs} from '../../lib/finance.types'
import {PaymentEditor,emptyPaymentBundle} from './PaymentEditor'
import {availableCardRules,cardPreview,validatePayments} from './paymentRules'
const rate=(id:string,fields:Partial<FeeRule>={}):FeeRule=>({id,method_id:'credit',acquirer:'Adquirente Exemplo',brand:'VISA',installments:1,percentage:3,fixed_fee:0.1,settlement_days:30,interval_days:30,valid_from:'2026-01-01',active:true,version:1,created_at:'',updated_at:'',created_by:null,updated_by:null,...fields})
const rates=[rate('visa-1'),rate('visa-3',{installments:3}),rate('master-1',{brand:'MASTERCARD'}),rate('future',{brand:'FUTURA',valid_from:'2099-01-01'}),rate('inactive',{brand:'INATIVA',active:false}),rate('old',{valid_from:'2025-01-01'}),rate('debit',{method_id:'debit'})]
const catalogs={methods:[{id:'credit',name:'Crédito',kind:'credit',active:true},{id:'debit',name:'Débito',kind:'debit',active:true}],accounts:[{id:'account',name:'Banco',active:true}],rates,categories:[],suppliers:[],recurring:[]} as unknown as FinanceCatalogs
function Fixture(){const [value,setValue]=useState({...emptyPaymentBundle(),applied_on:'2026-11-09'});return <PaymentEditor catalogs={catalogs} value={value} onChange={setValue} total={310}/>}
describe('Pagamento simples, dividido, parcial e opções completas de cartão',()=>{
 it('é integral por padrão, preenche saldo e mostra o restante em tempo real',()=>{
  render(<Fixture/>);expect(screen.getByLabelText('Permitir pagamento parcial')).not.toBeChecked()
  fireEvent.click(screen.getByText('+ Adicionar forma de pagamento'));expect(screen.getByLabelText('Valor bruto 1 (R$)')).toHaveValue('310,00')
  fireEvent.change(screen.getByLabelText('Valor bruto 1 (R$)'),{target:{value:'100,00'}})
  expect(screen.getByTestId('payment-summary')).toHaveTextContent('210,00')
  fireEvent.click(screen.getByText('+ Adicionar forma de pagamento'));expect(screen.getByLabelText('Valor bruto 2 (R$)')).toHaveValue('210,00')
  fireEvent.change(screen.getByLabelText('Valor bruto 2 (R$)'),{target:{value:'50,00'}});fireEvent.click(screen.getByText('Usar saldo na forma 2'));expect(screen.getByLabelText('Valor bruto 2 (R$)')).toHaveValue('210,00')
  fireEvent.click(screen.getByLabelText('Permitir pagamento parcial'));expect(screen.getByText('O valor restante ficará em Contas a Receber.')).toBeInTheDocument()
 })
 it('todo ID elegível do catálogo aparece e futura fica visível mas desabilitada',()=>{
  render(<Fixture/>);fireEvent.click(screen.getByText('+ Adicionar forma de pagamento'));fireEvent.change(screen.getByLabelText('Forma de pagamento 1'),{target:{value:'credit'}})
  const select=screen.getByLabelText('Taxa e parcelamento 1') as HTMLSelectElement
  expect([...select.options].filter(o=>o.value&&!o.disabled).map(o=>o.value).sort()).toEqual(['visa-1','visa-3','master-1'].sort())
  expect([...select.options].find(o=>o.value==='future')).toHaveProperty('disabled',true)
  expect([...select.options].some(o=>['inactive','old','debit'].includes(o.value))).toBe(false)
  fireEvent.change(select,{target:{value:'visa-3'}});expect(screen.getByTestId('card-preview-0')).toHaveTextContent('300,60');expect(screen.getByTestId('card-preview-0')).toHaveTextContent('09/12/2026')
  fireEvent.change(screen.getByLabelText('Forma de pagamento 1'),{target:{value:'debit'}});expect((screen.getByLabelText('Taxa e parcelamento 1') as HTMLSelectElement).options.length).toBe(2)
 })
 it('valida integral/parcial/limite e arredonda taxa em centavos como o banco',()=>{
  const v={...emptyPaymentBundle(),payments:[{method_id:'credit',account_id:'account',gross_amount:'100,00',installments:1,fee_rule_id:'visa-1',received_now:false}]}
  expect(validatePayments(v,310)).toContain('Permitir pagamento parcial');expect(validatePayments({...v,complete_financial:false},310)).toBe('');expect(validatePayments(v,50)).toContain('ultrapassa')
  expect(cardPreview('310,00',rate('r',{installments:3}),'2026-06-01')).toEqual({gross:310,fee:9.4,net:300.6,parts:3,firstDate:'2026-07-01'})
  expect(availableCardRules(rates,undefined,'2026-11-09').eligible).toHaveLength(0)
 })
})
