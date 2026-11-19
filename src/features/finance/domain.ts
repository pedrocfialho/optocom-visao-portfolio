import { clinicParts, decimal, moneyCents } from '../operations/domain'
export { currency, moneyInput } from '../operations/domain'
export const today=()=>clinicParts().date
export const kinds={cash:'Dinheiro',pix:'PIX',debit:'Débito',credit:'Crédito',other:'Outras formas'} as const
export const statusLabels={pending:'Pendente',settled:'Pago/recebido',cancelled:'Cancelado',partial:'Parcial',completed:'Concluído',void:'Cancelado',draft:'Rascunho',active:'Ativo'} as const
export const impacts={revenue:'Receita operacional',expense:'Despesa operacional',fee:'Taxa financeira',financing:'Entrada/saída financeira'} as const
export function money(value:string){return decimal(moneyCents(value))}
export function signedMoney(value:string){const negative=value.trim().startsWith('-');return (negative?'-':'')+money(value.trim().replace(/^-/,'').trim())}
export function dateLabel(value:string|null){return value?(value.includes('T')?clinicParts(new Date(value)).date:value.slice(0,10)).split('-').reverse().join('/'):'—'}
export function addDays(value:string,days:number){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
export function period(mode:string,date=today()){if(mode==='today')return {from:date,to:date};if(mode==='previous'){const d=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-2,1,12));return period('month',d.toISOString().slice(0,10))};if(mode==='year')return {from:date.slice(0,4)+'-01-01',to:date.slice(0,4)+'-12-31'};return {from:date.slice(0,7)+'-01',to:new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0,12)).toISOString().slice(0,10)}}
export function dueWindow(mode:string){const date=today();if(mode==='overdue')return {from:undefined,to:addDays(date,-1),status:'pending' as const};if(mode==='today')return {from:date,to:date,status:'pending' as const};if(mode==='7'||mode==='30')return {from:date,to:addDays(date,Number(mode)),status:'pending' as const};return {from:undefined,to:undefined,status:mode==='paid'?'settled' as const:'pending' as const}}
export function csv(rows:(string|number|null)[][]){const cell=(value:string|number|null)=>{let text=value===null?'':typeof value==='number'?value.toFixed(2).replace('.',','):value;if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'};return '\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n')}
