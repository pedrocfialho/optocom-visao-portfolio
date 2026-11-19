// @vitest-environment node
// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {PGlite} from '@electric-sql/pglite'
import {describe,expect,it} from 'vitest'
import {availableCardRules} from './paymentRules'
import type {FeeRule,PaymentMethod} from '../../lib/finance.types'
describe('Catálogo sintético comparado com um oráculo SQL independente',()=>{
 it('seleciona apenas a vigência atual de cada modalidade e parcelamento',async()=>{
  const meta={version:1,created_at:'2030-01-01',updated_at:'2030-01-01',created_by:null,updated_by:null}
  const methods:PaymentMethod[]=[{...meta,id:'credit-example',name:'Crédito Exemplo',kind:'credit',active:true},{...meta,id:'debit-example',name:'Débito Exemplo',kind:'debit',active:true}]
  const rates:FeeRule[]=methods.flatMap(method=>[1,2].flatMap(installments=>['2029-01-01','2030-01-01','2031-01-01'].map(valid_from=>({...meta,id:`${method.id}-${installments}-${valid_from}`,method_id:method.id,acquirer:'Adquirente Exemplo',brand:'Bandeira Exemplo',installments,percentage:2,fixed_fee:0,settlement_days:30,interval_days:30,valid_from,active:true}))))
  rates.push({...rates[0],id:'inactive-example',active:false,valid_from:'2030-02-01'})
  const data={date:'2030-06-01',methods,rates}
  const db=new PGlite()
  try{for(const method of data.methods.filter(m=>m.active&&['credit','debit'].includes(m.kind))){
   // Dados gerados acima; nenhum arquivo privado ou acesso remoto.
   const {rows}=await db.query<{id:string}>(`select id from (
    select id,row_number() over(partition by acquirer,brand,installments order by valid_from desc) as position
    from jsonb_to_recordset($1::jsonb) as r(id text,method_id text,active boolean,acquirer text,brand text,installments integer,valid_from date)
    where active and method_id=$2 and valid_from<=$3::date and ($4<>'debit' or installments=1)
   ) eligible where position=1 order by id`,[JSON.stringify(data.rates),method.id,data.date,method.kind])
   const eligible=availableCardRules(data.rates,method,data.date).eligible.map(r=>r.id).sort()
   expect(eligible).toHaveLength(method.kind==='debit'?1:2)
   expect(eligible).toEqual(rows.map(r=>r.id))
  }}finally{await db.close()}
 })
})
