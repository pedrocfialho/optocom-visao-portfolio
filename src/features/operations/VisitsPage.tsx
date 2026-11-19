import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from './api'
import { currency, displayDate, visitLabels } from './domain'
import { LoadState, PageHeader, Pager, useLoad } from './shared'

export function VisitsPage() {
  const [offset, setOffset] = useState(0)
  const list = useLoad(() => api.visits(undefined, offset), [offset])
  return <><PageHeader title="Atendimentos" subtitle="Histórico administrativo de consultas, exames e descontos."><Link className="button primary" to="/novo-atendimento">+ Novo atendimento</Link></PageHeader><LoadState state={list} /><section className="panel"><div className="table-scroll"><table><thead><tr><th>Data / hora</th><th>Paciente</th><th>Profissional</th><th>Consulta</th><th>Total</th><th>Status</th></tr></thead><tbody>{list.data?.slice(0, 20).map(v => <tr key={v.id}><td>{displayDate(v.visit_at)}</td><td><Link to={`/novo-atendimento?id=${v.id}`}>{v.patient_name}</Link></td><td>{v.professional_name}</td><td>{v.consultation_name_snapshot}</td><td>{currency(v.total_amount)}</td><td><span className={`badge ${v.status === 'completed' ? 'confirmed' : 'neutral'}`}>{visitLabels[v.status]}</span></td></tr>)}</tbody></table></div>{list.data?.length === 0 && <p className="empty-text">Nenhum atendimento registrado.</p>}<Pager offset={offset} count={list.data?.length ?? 0} change={setOffset} /></section></>
}
