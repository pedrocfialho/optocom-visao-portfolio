import { Modal } from '../../components/Modal'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Patient } from '../../lib/database.types'
import * as api from './api'
import { currency, displayDate, visitLabels } from './domain'
import { emptyPatientForm, PatientFields, patientForm, patientInput } from './PatientFields'
import { LoadState, PageHeader, Pager, useLoad } from './shared'
import { useRecordRemoval } from '../../lib/useRecordRemoval'
import { confirmAction } from '../../lib/confirmAction'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

const empty = emptyPatientForm
export function PatientsPage() {
  const [search, setSearch] = useState(''), [offset, setOffset] = useState(0), [showInactive, setShowInactive] = useState(false)
  const removal = useRecordRemoval(api.errorText)
  const query = useDebouncedValue(search, 300)
  const list = useLoad(() => api.searchPatients(query, offset, !showInactive), [query, offset, showInactive], true, query === search)
  const [selected, setSelected] = useState<Patient | null>(null), [editing, setEditing] = useState(false)
  const [form, setForm] = useState(empty), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [historyOffset, setHistoryOffset] = useState(0)
  const history = useLoad(() => selected ? api.visits(selected.id, historyOffset) : Promise.resolve([]), [selected?.id, historyOffset])
  function choose(patient: Patient | null) {
    setSelected(patient); setEditing(true); setMessage(''); setHistoryOffset(0); setSearch(''); setOffset(0); removal.clear()
    setForm(patientForm(patient))
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy || removal.busy) return; if (selected?.active && !form.active && !confirmAction('Inativar paciente', selected.full_name, 'O cadastro será ocultado das buscas normais. Todo o histórico será preservado.')) return; setBusy(true); setMessage('')
    try {
      const saved = await api.savePatient(patientInput(form), selected)
      setSelected(saved); setMessage('Paciente salvo com sucesso.')
    } catch (error) { setMessage(api.errorText(error)) } finally { setBusy(false) }
  }
  return <><PageHeader title="Pacientes" subtitle="Cadastro e histórico administrativo, sem prontuário clínico."><button className="button primary" onClick={() => choose(null)} disabled={busy || removal.busy || !!list.error}>+ Novo paciente</button></PageHeader><LoadState state={list} />
    <div><section className="panel"><label htmlFor="patient-filter">Pesquisar por nome ou telefone</label><input autoComplete="off" id="patient-filter" type="search" value={search} onChange={e => { setSearch(e.target.value); setOffset(0) }} placeholder="Digite nome ou telefone" maxLength={100} /><label className="checkbox"><input autoComplete="off" type="checkbox" checked={showInactive} onChange={e => { setShowInactive(e.target.checked); setOffset(0) }} />Mostrar também pacientes inativos</label><div className="inline-actions"><span>{search || showInactive ? 'Filtros ativos' : 'Exibindo pacientes ativos'}</span></div><div className="table-scroll"><table><thead><tr><th>Paciente</th><th>Telefone</th><th>Situação</th></tr></thead><tbody>{list.data?.slice(0, 20).map(p => <tr key={p.id}><td><button className="row-link" disabled={busy || removal.busy} onClick={() => choose(p)}>{p.full_name}</button>{p.registration_pending&&<small className="patient-pending">Cadastro pendente</small>}</td><td>{p.phone || '—'}</td><td><span className={`badge ${p.active ? 'confirmed' : 'neutral'}`}>{p.active ? 'Ativo' : 'Inativo'}</span></td></tr>)}</tbody></table></div>{list.data?.length === 0 && <p className="empty-text">Nenhum paciente encontrado.</p>}<Pager offset={offset} count={list.data?.length ?? 0} change={setOffset} /></section>
    {editing && <Modal title="Cadastro de paciente" busy={busy || removal.busy} wide onClose={() => {setEditing(false);setSelected(null);setForm(empty);setMessage('')}}><section className="panel"><h2>{selected ? 'Consultar / editar paciente' : 'Novo paciente'}</h2><form autoComplete="off" onSubmit={submit}><fieldset disabled={busy || removal.busy}><PatientFields form={form} onChange={setForm} /><button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar paciente'}</button><button type="button" className="button" onClick={() => { setEditing(false); setSelected(null); setForm(empty); setMessage('') }}>Fechar cadastro</button>{selected && <button type="button" className="button danger" onClick={() => void removal.remove('patients', selected.id, selected.version, () => { setEditing(false); setSelected(null); setForm(empty); list.refresh() })}>Excluir paciente</button>}</fieldset>{message && <p role="status">{message}</p>}</form>
    {selected && <section className="patient-history"><h2>Histórico administrativo de atendimentos</h2><LoadState state={history} />{history.data?.length === 0 && <p>Este paciente ainda não possui atendimentos.</p>}{history.data?.slice(0, 20).map(v => <div className="history-item" key={v.id}><Link to={`/novo-atendimento?id=${v.id}`}>{displayDate(v.visit_at)} · {v.consultation_name_snapshot}</Link><p>{v.professional_name} · {visitLabels[v.status]} · {currency(v.total_amount)}</p></div>)}<Pager offset={historyOffset} count={history.data?.length ?? 0} change={setHistoryOffset} /></section>}</section></Modal>}</div>{removal.message && <p className="notice" role="status">{removal.message}</p>}</>
}
