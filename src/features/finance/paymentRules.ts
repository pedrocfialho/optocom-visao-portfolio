import type {FeeRule,PaymentBundle,PaymentMethod} from '../../lib/finance.types'
import {moneyCents} from '../operations/domain'
import {addDays} from './domain'
export function availableCardRules(rates:FeeRule[],method:Pick<PaymentMethod,'id'|'kind'|'active'>|undefined,date:string){
 if(!method?.active||!['debit','credit'].includes(method.kind))return {eligible:[],future:[]}
 const active=rates.filter(r=>r.active&&r.method_id===method.id&&(method.kind!=='debit'||r.installments===1))
 const dated=active.filter(r=>r.valid_from<=date)
 const eligible=dated.filter(r=>!dated.some(x=>x.acquirer===r.acquirer&&x.brand===r.brand&&x.installments===r.installments&&x.valid_from>r.valid_from))
 const sort=(a:FeeRule,b:FeeRule)=>a.acquirer.localeCompare(b.acquirer,'pt-BR')||a.brand.localeCompare(b.brand,'pt-BR')||a.installments-b.installments||a.valid_from.localeCompare(b.valid_from)||a.id.localeCompare(b.id)
 return {eligible:eligible.sort(sort),future:active.filter(r=>r.valid_from>date).sort(sort)}
}
export function cardPreview(amount:string,rule:FeeRule,date:string){
 const gross=moneyCents(amount),percent=BigInt(Math.round(Number(rule.percentage)*10000)),fixed=BigInt(Math.round(Number(rule.fixed_fee)*100))
 const fee=Number((BigInt(gross)*percent+500000n)/1000000n+fixed)
 if(fee>gross||gross<rule.installments)throw new Error('Valor insuficiente para a taxa ou o parcelamento selecionado.')
 return {gross:gross/100,fee:fee/100,net:(gross-fee)/100,parts:rule.installments,firstDate:addDays(date,rule.settlement_days)}
}
export function registeredCents(value:PaymentBundle){return value.payments.reduce((n,p)=>n+moneyCents(p.gross_amount||'0'),0)}
export function validatePayments(value:PaymentBundle,total:number){
 let sum:number;try{sum=registeredCents(value)}catch{return 'Revise os valores das formas de pagamento.'}
 const expected=Math.round(total*100)
 if(sum>expected)return 'O valor registrado ultrapassa o total.'
 if(value.complete_financial&&sum!==expected)return 'Registre o valor total ou marque “Permitir pagamento parcial”.'
 return ''
}
