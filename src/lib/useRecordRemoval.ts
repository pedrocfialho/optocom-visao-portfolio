import { useRef, useState } from 'react'
import { confirmAction } from './confirmAction'
import { manageRemoval, type RemovalTable } from './recordRemoval'
export function useRecordRemoval(errorText: (error: unknown) => string) {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  async function remove(table: RemovalTable, id: string, version: number, onRemoved: () => void) {
    if (lock.current) return
    lock.current = true; setBusy(true); setMessage('')
    try {
      const decision = await manageRemoval(table, id, version)
      const noun = table === 'patients' ? 'paciente' : 'taxa'
      const explanation = decision.linked
        ? 'Este registro possui histórico ou vínculos e não será apagado. Será inativado para impedir uso futuro, preservando o histórico e a auditoria.'
        : 'Este registro não possui vínculos. A exclusão é definitiva e será auditada. Se surgir um vínculo antes da confirmação, ele será inativado em vez de apagado.'
      if (!confirmAction(`${decision.linked ? 'Inativar' : 'Excluir'} ${noun}`, decision.name, explanation)) return
      const result = await manageRemoval(table, id, decision.version, true)
      onRemoved()
      setMessage(result.action === 'delete' ? 'Registro excluído definitivamente. A auditoria foi preservada.' : 'Registro com histórico inativado. Nenhum dado histórico foi apagado.')
    } catch (error) { setMessage(errorText(error)) } finally { lock.current = false; setBusy(false) }
  }
  return { busy, message, remove, clear: () => setMessage('') }
}
