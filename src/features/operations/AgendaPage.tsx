import { Modal } from '../../components/Modal'
import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppointmentStatus } from '../../lib/database.types'
import type { AppointmentRow } from './api'
import * as api from './api'
import { appointmentLabels, clinicInstant, clinicParts } from './domain'
import { CatalogLinks, LoadState, PageHeader, PatientPicker, useLoad } from './shared'

const initial = () => ({ patient_id: '', patient_name: '', professional_id: '', appointment_type_id: '', date: clinicParts().date, time: '09:00', status: 'scheduled' as AppointmentStatus, admin_notes: '', cancel_reason: '' })
export function AgendaPage() {
  const navigate = useNavigate()
  const [day, setDay] = useState(clinicParts().date)
  const [filter,setFilter]=useState('current')
  const actionLock=useRef(false)
  const list = useLoad(() => api.appointments(day), [day]), catalogs = useLoad(api.agendaCatalogs)
  const [previous, setPrevious] = useState<AppointmentRow | null>(null)
  const [editing, setEditing] = useState(false), [form, setForm] = useState(initial)
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const removal=useLoad(()=>api.appointmentRemoval(previous!),[previous?.id,previous?.version],false,editing&&!!previous&&!previous.visit_id)
  function close(){setEditing(false);setForm(initial());setPrevious(null)}
  function context(row:AppointmentRow){const parts=clinicParts(new Date(row.start_at));return `${row.patient_name} em ${parts.date.split('-').reverse().join('/')} às ${parts.time}`}
  async function cancel(row:AppointmentRow){
    if(actionLock.current||busy)return;actionLock.current=true
    try{
      if(row.visit_id)throw new Error('Este agendamento tem atendimento vinculado. Consulte o atendimento para avaliar o cancelamento, preservando o histórico e o financeiro.')
      if(!window.confirm(`Cancelar a consulta de ${context(row)}?\n\nO agendamento e a auditoria serão preservados. Nenhum atendimento ou valor financeiro será apagado. Alterações não salvas não serão gravadas.`))return
      setBusy(true);setMessage('');await api.cancelAppointment(row);close();setMessage('Consulta cancelada com sucesso. O histórico foi preservado.');list.refresh()
    }catch(error){setMessage(api.errorText(error))}finally{setBusy(false);actionLock.current=false}
  }
  async function remove(row:AppointmentRow){
    if(actionLock.current||busy)return;actionLock.current=true
    try{
      setBusy(true);setMessage('');const decision=await api.appointmentRemoval(row)
      if(!decision.allowed)throw new Error(decision.reason)
      if(!window.confirm(`Excluir definitivamente o agendamento de ${context(row)}?\n\nEsta exclusão é definitiva e não poderá ser desfeita. Somente o agendamento sem vínculos ou alterações históricas será apagado. A auditoria será preservada.`))return
      await api.appointmentRemoval(row,true);close();setMessage('Agendamento excluído definitivamente. A auditoria foi preservada.');list.refresh()
    }catch(error){setMessage(api.errorText(error));removal.refresh()}finally{setBusy(false);actionLock.current=false}
  }
  function choose(row: AppointmentRow | null) {
    setPrevious(row); setEditing(true); setMessage('')
    const parts = row ? clinicParts(new Date(row.start_at)) : { date: day, time: '09:00' }
    setForm(row ? { patient_id: row.patient_id, patient_name: row.patient_name, professional_id: row.professional_id, appointment_type_id: row.appointment_type_id, ...parts, status: row.status, admin_notes: row.admin_notes, cancel_reason: row.cancel_reason ?? '' } : { ...initial(), ...parts })
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if(busy)return; if(form.status==='cancelled'&&previous?.status!=='cancelled'&&!window.confirm(`Cancelar a consulta de ${form.patient_name} em ${form.date.split('-').reverse().join('/')} às ${form.time}?\n\nO agendamento, seus vínculos e a auditoria serão preservados.`))return; setBusy(true); setMessage('')
    try {
      if (!form.patient_id) throw new Error('Pesquise e selecione um paciente.')
      await api.saveAppointment({ patient_id: form.patient_id, professional_id: form.professional_id, appointment_type_id: form.appointment_type_id, start_at: clinicInstant(form.date, form.time), status: form.status, admin_notes: form.admin_notes, cancel_reason: form.status === 'cancelled' ? form.cancel_reason.trim() : null }, previous)
      setEditing(false); setDay(form.date); setMessage(form.status==='cancelled'?'Consulta cancelada com sucesso. O histórico foi preservado.':'Agendamento salvo com sucesso.')
    } catch (error) { setMessage(api.errorText(error)) } finally { setBusy(false) }
  }
  async function start(row: AppointmentRow) {
    setBusy(true); setMessage('')
    try { const visit = await api.startVisit(row.id); navigate(`/novo-atendimento?id=${visit.id}`) } catch (error) { setMessage(api.errorText(error)) } finally { setBusy(false) }
  }
  const linked = !!previous?.visit_id
  const visible=list.data?.filter(row=>filter==='all'||(filter==='current'?row.status!=='cancelled':filter==='active'?['scheduled','confirmed'].includes(row.status):row.status===filter))
  return <><PageHeader title="Agenda" subtitle="Agenda diária no horário de São Paulo."><button className="button primary" onClick={() => choose(null)} disabled={busy || !!list.error || !!catalogs.error}>+ Novo agendamento</button></PageHeader><CatalogLinks /><LoadState state={list} /><LoadState state={catalogs} />
    <section className="panel agenda-panel"><div className="date-filter"><label htmlFor="agenda-day">Dia da agenda</label><input autoComplete="off" id="agenda-day" type="date" required value={day} onChange={e => { if (e.target.value) setDay(e.target.value) }} /><label htmlFor="agenda-status-filter">Status na agenda</label><select id="agenda-status-filter" value={filter} onChange={e=>setFilter(e.target.value)}>{Object.entries({current:'Não canceladas',active:'Agendadas e confirmadas',scheduled:'Agendadas',confirmed:'Confirmadas',attended:'Atendidas',cancelled:'Canceladas',no_show:'Faltas',all:'Todas'}).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><span>{day===clinicParts().date?'Hoje':'Filtro de data ativo'}</span><button className="button" onClick={list.refresh}>Atualizar agenda</button></div>{visible?.length === 0 && <p className="empty-text">Nenhum agendamento neste dia para o filtro selecionado.</p>}{visible?.map(row => <article className={`agenda-row ${row.status==='cancelled'?'agenda-cancelled':''}`} key={row.id}><strong className="agenda-hour">{clinicParts(new Date(row.start_at)).time}</strong><div className="agenda-person"><strong>{row.patient_name}</strong><p>{row.consultation_name} · {row.professional_name}</p></div><span className={`badge ${row.status === 'confirmed' || row.status === 'attended' ? 'confirmed' : 'neutral'}`}>{row.status==='cancelled'?'Cancelada':appointmentLabels[row.status]}</span><div className="inline-actions"><button className="button" disabled={busy} onClick={() => choose(row)}>Editar agendamento</button>{!['cancelled','attended'].includes(row.status)&&<button className="button danger" disabled={busy} onClick={()=>void cancel(row)}>Cancelar consulta</button>}{['scheduled', 'confirmed', 'attended'].includes(row.status) && <button className="button primary" disabled={busy} onClick={() => void start(row)}>{row.visit_id ? 'Ver atendimento' : 'Iniciar atendimento'}</button>}</div></article>)}</section>
    {editing && <Modal title="Agendamento" busy={busy} wide onClose={() => {setEditing(false);setForm(initial());setPrevious(null)}}><section className="panel editor-panel"><h2>{previous ? 'Editar agendamento' : 'Novo agendamento'}</h2>{previous&&<div className="agenda-editor-actions"><strong>{context(previous)}</strong><div className="inline-actions">{!['cancelled','attended'].includes(previous.status)&&<button type="button" className="button danger" disabled={busy} onClick={()=>void cancel(previous)}>Cancelar consulta</button>}{!linked&&removal.data?.allowed&&!removal.error&&<button type="button" className="button danger" disabled={busy||removal.loading} onClick={()=>void remove(previous)}>Excluir agendamento</button>}</div>{linked?<p>Exclusão bloqueada: há atendimento vinculado. Preserve o histórico; consulte o atendimento para avaliar o cancelamento.</p>:<><LoadState state={removal}/>{removal.data&&!removal.data.allowed&&<p>{removal.data.reason}</p>}</>}</div>}{message&&<p className="notice" role="status">{message}</p>}{linked && <p className="notice">Este agendamento já tem atendimento. Seus vínculos e horário são preservados; cancelamentos devem ser feitos pelo atendimento.</p>}<form autoComplete="off" onSubmit={submit}><div className="form-grid"><div className="span-two"><PatientPicker key={previous?.id??'new'} id={form.patient_id} name={form.patient_name} disabled={linked} onChange={p => setForm({ ...form, patient_id: p.id, patient_name: p.full_name })} /></div><div><label htmlFor="appointment-professional">Profissional</label><select id="appointment-professional" required disabled={linked} value={form.professional_id} onChange={e => setForm({ ...form, professional_id: e.target.value })}><option value="">Selecione</option>{catalogs.data?.professionals.filter(p => p.active || p.id === form.professional_id).map(p => <option key={p.id} value={p.id}>{p.full_name}{!p.active && ' (inativo)'}</option>)}</select></div><div><label htmlFor="appointment-type">Tipo de consulta</label><select id="appointment-type" required disabled={linked} value={form.appointment_type_id} onChange={e => setForm({ ...form, appointment_type_id: e.target.value })}><option value="">Selecione</option>{catalogs.data?.consultations.filter(t => t.active || t.id === form.appointment_type_id).map(t => <option key={t.id} value={t.id}>{t.name}{!t.active && ' (inativo)'}</option>)}</select></div><div><label htmlFor="appointment-date">Data</label><input autoComplete="off" id="appointment-date" type="date" required disabled={linked} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div><div><label htmlFor="appointment-time">Horário</label><input autoComplete="off" id="appointment-time" type="time" required disabled={linked} value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></div><div><label htmlFor="appointment-status">Status</label><select id="appointment-status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as AppointmentStatus })}>{Object.entries(appointmentLabels).map(([key, label]) => <option key={key} value={key} disabled={key === 'attended' && previous?.status !== 'attended'}>{label}</option>)}</select><p className="fine-print">Atendido é definido ao concluir o atendimento.</p></div>{form.status === 'cancelled' && <div><label htmlFor="appointment-reason">Motivo do cancelamento</label><input autoComplete="off" id="appointment-reason" required minLength={3} maxLength={500} value={form.cancel_reason} onChange={e => setForm({ ...form, cancel_reason: e.target.value })} /></div>}<div className="span-two"><label htmlFor="appointment-notes">Observação administrativa (opcional)</label><textarea id="appointment-notes" maxLength={2000} value={form.admin_notes} onChange={e => setForm({ ...form, admin_notes: e.target.value })} /></div></div><div className="inline-actions"><button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar agendamento'}</button><button type="button" className="button" disabled={busy} onClick={() => {setEditing(false);setForm(initial());setPrevious(null)}}>Fechar edição</button></div></form></section></Modal>}{!editing&&message && <p className="notice feedback-notice" role="status">{message}</p>}</>
}
