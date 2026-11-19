import { supabase } from '../../lib/supabase'
import type { Appointment, AppointmentStatus, Json, Patient, PricedCatalog, Professional, Visit } from '../../lib/database.types'
import { dayRange } from './domain'
import { CATALOG_TTL, CHANGE_EVENT, dataChanged, invalidateCache, sharedRead } from '../../lib/dataCache'

export { CHANGE_EVENT }
function client() { if (!supabase) throw new Error('Conecte o Supabase para usar os cadastros.'); return supabase }
export function errorText(error: unknown): string {
  const e = error as { code?: string; message?: string }
  if (['PGRST205', '42P01', 'PGRST202'].includes(e.code ?? '')) return 'O núcleo operacional ainda não foi habilitado no banco. A aplicação da Fase 2 depende de aprovação.'
  if (e.code === '40001' || e.code === 'PGRST116') return 'Outro computador alterou este registro. Abra o cadastro novamente ou recarregue o atendimento antes de salvar.'
  if (e.code === '42501') return 'Acesso indisponível. É necessário um administrador ativo.'
  if (e.code === '23505') return 'Este registro já existe. Recarregue os dados para evitar duplicidade.'
  if (e.code === '23514' || e.code === '23502' || e.code === '22P02' || e.code === '22003') return 'Revise os campos obrigatórios, valores e formatos informados.'
  if (e.code === 'P0001' || error instanceof Error) return e.message ?? 'Não foi possível concluir a operação.'
  return 'Não foi possível acessar os dados. Verifique sua conexão e tente novamente.'
}
async function requireRow<T>(data: T | null, error: unknown, catalog?: string): Promise<T> {
  if (error) throw error
  if (!data) throw { code: '40001' }
  if (catalog) invalidateCache('catalog:operations:' + catalog)
  dataChanged(); return data
}
export async function searchPatients(query = '', offset = 0, activeOnly = false) {
  return sharedRead('read:patients:' + JSON.stringify([query, offset, activeOnly]), async () => {
    const { data, error } = await client().rpc('search_patients', { p_query: query, p_offset: offset, p_active_only: activeOnly })
    if (error) throw error
    return data
  })
}
export async function getPatient(id: string) {
  const { data, error } = await client().from('patients').select('*').eq('id', id).single()
  if (error) throw error
  return data
}
export type PatientInput = { full_name: string; phone: string; birth_date: string | null; cpf: string | null; admin_notes: string; active: boolean }
export async function savePatient(input: PatientInput, previous: Patient | null) {
  const query = previous ? client().from('patients').update(input).eq('id', previous.id).eq('version', previous.version) : client().from('patients').insert(input)
  const { data, error } = await query.select().maybeSingle()
  return requireRow(data, error)
}
export type CatalogRow = Pick<Professional, 'id' | 'version' | 'full_name' | 'active'> | Pick<PricedCatalog, 'id' | 'version' | 'name' | 'default_price' | 'active'>
async function allPages<T>(page: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await page(offset)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 100) break
  }
  return rows
}
export async function catalogs(includeExams = true) {
  const [professionals, consultations, exams] = await Promise.all([
    sharedRead('catalog:operations:professionals', () => allPages(offset => client().from('professionals').select('id,version,full_name,active').order('full_name').order('id').range(offset, offset + 99)), CATALOG_TTL),
    sharedRead('catalog:operations:appointment_types', () => allPages(offset => client().from('appointment_types').select('id,version,name,default_price,active').order('name').order('id').range(offset, offset + 99)), CATALOG_TTL),
    includeExams ? sharedRead('catalog:operations:exams', () => allPages(offset => client().from('exams').select('id,version,name,default_price,active').order('name').order('id').range(offset, offset + 99)), CATALOG_TTL) : Promise.resolve([]),
  ])
  return { professionals, consultations, exams }
}
export function agendaCatalogs() { return catalogs(false) }
export async function saveCatalog(table: 'professionals' | 'appointment_types' | 'exams', input: { name: string; price: number; active: boolean }, previous: Pick<CatalogRow, 'id' | 'version'> | null) {
  if (table === 'professionals') {
    const payload = { full_name: input.name, active: input.active }
    const query = previous ? client().from(table).update(payload).eq('id', previous.id).eq('version', previous.version) : client().from(table).insert(payload)
    const { data, error } = await query.select().maybeSingle(); return requireRow(data, error, table)
  }
  const payload = { name: input.name, default_price: input.price, active: input.active }
  const query = previous ? client().from(table).update(payload).eq('id', previous.id).eq('version', previous.version) : client().from(table).insert(payload)
  const { data, error } = await query.select().maybeSingle(); return requireRow(data, error, table)
}
export const APPOINTMENT_COLUMNS = 'id,version,patient_id,professional_id,appointment_type_id,start_at,status,admin_notes,cancel_reason,patient_name,professional_name,consultation_name,visit_id' as const
export type AppointmentRow = Awaited<ReturnType<typeof appointments>>[number]
export async function appointments(date: string) {
  const [start, end] = dayRange(date)
  return sharedRead('read:appointments:' + date, async () => {
    const { data, error } = await client().from('appointment_overview').select(APPOINTMENT_COLUMNS).gte('start_at', start).lt('start_at', end).order('start_at').order('id')
    if (error) throw error
    return data
  })
}
export type AppointmentInput = { patient_id: string; professional_id: string; appointment_type_id: string; start_at: string; status: AppointmentStatus; admin_notes: string; cancel_reason: string | null }
export async function saveAppointment(input: AppointmentInput, previous: Pick<Appointment, 'id' | 'version'> | null) {
  const query = previous ? client().from('appointments').update(input).eq('id', previous.id).eq('version', previous.version) : client().from('appointments').insert(input)
  const { data, error } = await query.select().maybeSingle(); return requireRow(data, error)
}
export async function startVisit(id: string) {
  const { data, error } = await client().rpc('start_visit', { p_appointment_id: id })
  return requireRow(data as Visit | null, error)
}
export async function cancelAppointment(row: AppointmentRow) {
  const {data,error}=await client().from('appointments').update({status:'cancelled',cancel_reason:'Cancelamento confirmado na agenda.'}).eq('id',row.id).eq('version',row.version).select().maybeSingle()
  return requireRow(data,error)
}
export async function appointmentRemoval(row: Pick<AppointmentRow,'id'|'version'>,confirm=false) {
  const {data,error}=await client().rpc('manage_appointment_removal',{p_id:row.id,p_version:row.version,p_confirm:confirm})
  if(error){if(['PGRST202','42883'].includes(error.code))throw new Error('A exclusão segura de agendamentos ainda não está habilitada. Nenhum registro foi apagado. Use Cancelar consulta.');throw error}
  if(confirm)dataChanged()
  return data as unknown as {allowed:boolean;deleted:boolean;version:number;reason:string}
}
export async function getVisit(id: string) {
  const [{ data: visit, error }, { data: exams, error: examsError }] = await Promise.all([
    client().from('visit_overview').select('*').eq('id', id).single(),
    client().from('visit_exams').select('*').eq('visit_id', id).eq('active', true).order('created_at'),
  ])
  if (error || examsError) throw error ?? examsError
  return { visit, exams }
}
export async function visits(patientId?: string, offset = 0) {
  return sharedRead('read:visits:' + JSON.stringify([patientId, offset]), async () => {
    let query = client().from('visit_overview').select('id,visit_at,patient_name,professional_name,consultation_name_snapshot,total_amount,status').order('visit_at', { ascending: false }).order('id').range(offset, offset + 20)
    if (patientId) query = query.eq('patient_id', patientId)
    const { data, error } = await query
    if (error) throw error
    return data
  })
}
export type VisitInput = { id: string | null; request_id: string; version: number | null; patient_id: string; professional_id: string; appointment_type_id: string; visit_at: string; base_price: string; consultation_discount: string; admin_notes: string; complete: boolean; exams: { exam_id: string; unit_price: string }[] }
export async function saveVisit(input: VisitInput) {
  const { data, error } = await client().rpc('save_visit', { p_data: input as unknown as Json })
  return requireRow(data as Visit | null, error)
}
export async function cancelVisit(visit: Visit, reason: string) {
  const { data, error } = await client().rpc('cancel_visit', { p_id: visit.id, p_version: visit.version, p_reason: reason })
  return requireRow(data as Visit | null, error)
}
