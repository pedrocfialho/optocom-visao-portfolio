import type { AppointmentStatus } from '../../lib/database.types'

export const appointmentLabels: Record<AppointmentStatus, string> = { scheduled: 'Agendado', confirmed: 'Confirmado', attended: 'Atendido', cancelled: 'Cancelado', no_show: 'Faltou' }
export const visitLabels = { draft: 'Em andamento', completed: 'Concluído', cancelled: 'Cancelado' }
export const PAGE_SIZE = 20
export function moneyInput(value: number | string) { return Number(value).toFixed(2).replace('.', ',') }
export function moneyCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor válido, com até duas casas decimais.')
  const [whole, fraction = ''] = normalized.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}
export function decimal(cents: number) { return (cents / 100).toFixed(2) }
export function currency(value: number | string) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value)) }
export function visitTotal(base: string, discount: string, prices: string[]) {
  const b = moneyCents(base), d = moneyCents(discount)
  if (d > b) throw new Error('O desconto não pode superar o valor da consulta.')
  return { consultation: b - d, total: b - d + prices.reduce((sum, value) => sum + moneyCents(value), 0) }
}
export function clinicParts(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const get = (key: string) => parts.find(p => p.type === key)!.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}
export function clinicInstant(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Informe data e horário válidos.')
  const desired = Date.parse(`${date}T${time}:00Z`)
  const displayed = clinicParts(new Date(desired))
  const represented = Date.parse(`${displayed.date}T${displayed.time}:00Z`)
  return new Date(desired + desired - represented).toISOString()
}
export function dayRange(date: string) {
  const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
  return [clinicInstant(date, '00:00'), clinicInstant(next.toISOString().slice(0, 10), '00:00')]
}
export function displayDate(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
