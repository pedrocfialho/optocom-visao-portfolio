import { supabase } from './supabase'
import { dataChanged, invalidateCache } from './dataCache'
export type RemovalTable = 'patients' | 'card_fee_rules'
export type RemovalDecision = { action: 'delete' | 'deactivate'; name: string; linked: boolean; version: number }
export async function manageRemoval(table: RemovalTable, id: string, version: number, confirm = false): Promise<RemovalDecision> {
  if (!supabase) throw new Error('Conecte o Supabase para usar os cadastros.')
  const { data, error } = await supabase.rpc('manage_record_removal', { p_table: table, p_id: id, p_version: version, p_confirm: confirm })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) throw new Error('A exclusão segura ainda depende da migration de usabilidade. Nenhum registro foi alterado. Você pode usar a inativação do cadastro.')
    throw error
  }
  if (confirm) { if (table === 'card_fee_rules') invalidateCache('catalog:financial'); dataChanged() }
  return data as unknown as RemovalDecision
}
