import { Modal } from '../../components/Modal'
import { validatePayments } from '../finance/paymentRules'
import { confirmAction } from '../../lib/confirmAction'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { VisitOverview } from '../../lib/database.types'
import * as api from './api'
import { clinicInstant, clinicParts, currency, decimal, moneyCents, moneyInput, visitLabels, visitTotal } from './domain'
import { CatalogLinks, LoadState, PageHeader, PatientPicker, useLoad } from './shared'
import * as financeApi from '../finance/api'
import { useFinance } from '../finance/shared'
import { PaymentEditor,emptyPaymentBundle } from '../finance/PaymentEditor'

type ExamInput = { exam_id: string; name: string; price: string }
const initial = () => ({ patient_id: '', patient_name: '', professional_id: '', appointment_type_id: '', ...clinicParts(), base: '0,00', discount: '0,00', admin_notes: '' })
export function VisitPage() {
  const [params, setParams] = useSearchParams()
  const id = params.get('id')
  const requestId = useRef(crypto.randomUUID())
  const savedId = useRef<string | null>(null)
  const catalogs = useLoad(api.catalogs)
  const financeCatalogs=useFinance(financeApi.catalogs)
  const [payments,setPayments]=useState(emptyPaymentBundle)
  const automation=useFinance(()=>financeApi.cardSettlementReport(payments.applied_on,payments.applied_on),[payments.applied_on])
  const [visit, setVisit] = useState<VisitOverview | null>(null), [form, setForm] = useState(initial), [items, setItems] = useState<ExamInput[]>([])
  const [selectedExam, setSelectedExam] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [loading, setLoading] = useState(!!id), [busy, setBusy] = useState(false), [reason, setReason] = useState(''), [cancelOpen, setCancelOpen] = useState(false)
  const [loadKey, setLoadKey] = useState(0)
  useEffect(() => {
    let ignore = false
    requestId.current = crypto.randomUUID()
    setMessage(current => id && id === savedId.current ? current : ''); setError(''); setVisit(null); setForm(initial()); setItems([]); setCancelOpen(false); setReason('');setPayments(emptyPaymentBundle())
    if (!id) { setLoading(false); return }
    setLoading(true)
    void api.getVisit(id).then(({ visit: v, exams }) => {
      if (ignore) return
      setVisit(v); setForm({ patient_id: v.patient_id, patient_name: v.patient_name, professional_id: v.professional_id, appointment_type_id: v.appointment_type_id, ...clinicParts(new Date(v.visit_at)), base: moneyInput(v.base_price), discount: moneyInput(v.consultation_discount), admin_notes: v.admin_notes })
      setItems(exams.map(e => ({ exam_id: e.exam_id, name: e.exam_name_snapshot, price: moneyInput(e.unit_price_snapshot) })))
    }).catch(e => { if (!ignore) setError(api.errorText(e)) }).finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [id, loadKey])
  const readOnly = !!visit && visit.status !== 'draft'
  const linked = !!visit?.appointment_id
  let totals = { consultation: 0, total: 0 }, validation = ''
  try { totals = visitTotal(form.base, form.discount, items.map(e => e.price)) } catch (e) { validation = api.errorText(e) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(busy)return
    const complete = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'complete'
    setBusy(true); setMessage('')
    try {
      if (!form.patient_id) throw new Error('Selecione um paciente.')
      if (validation) throw new Error(validation)
      if(complete&&financeCatalogs.data&&!financeCatalogs.error){const paymentError=validatePayments(payments,totals.total/100);if(paymentError)throw new Error(paymentError)}
      const input={ id: visit?.id ?? null, request_id: requestId.current, version: visit?.version ?? null, patient_id: form.patient_id, professional_id: form.professional_id, appointment_type_id: form.appointment_type_id, visit_at: clinicInstant(form.date, form.time), base_price: decimal(moneyCents(form.base)), consultation_discount: decimal(moneyCents(form.discount)), admin_notes: form.admin_notes, complete, exams: items.map(e => ({ exam_id: e.exam_id, unit_price: decimal(moneyCents(e.price)) })) }
      const saved=complete&&financeCatalogs.data&&!financeCatalogs.error?(await financeApi.finishVisit(input,payments)).visit:await api.saveVisit(input)
      savedId.current = saved.id
      if (id !== saved.id) setParams({ id: saved.id }, { replace: true })
      const detail = await api.getVisit(saved.id)
      setVisit(detail.visit)
      setMessage(complete ? 'Atendimento concluído com sucesso.' : 'Rascunho salvo com sucesso.')
    } catch (e) { setMessage(api.errorText(e)) } finally { setBusy(false) }
  }
  async function cancel(event: FormEvent) {
    event.preventDefault(); if (!visit || busy) return; if(!confirmAction('Cancelar atendimento',form.patient_name,'O atendimento será cancelado com o motivo informado. O histórico será preservado.'))return
    setBusy(true); setMessage('')
    try { await api.cancelVisit(visit, reason); const detail = await api.getVisit(visit.id); setVisit(detail.visit); setCancelOpen(false); setMessage('Atendimento cancelado. O histórico foi preservado.') } catch (e) { setMessage(api.errorText(e)) } finally { setBusy(false) }
  }
  function addExam() {
    const exam = catalogs.data?.exams.find(e => e.id === selectedExam)
    if (!exam || items.some(e => e.exam_id === exam.id)) return
    setItems([...items, { exam_id: exam.id, name: exam.name, price: moneyInput(exam.default_price) }]); setSelectedExam('')
  }
  return <><PageHeader title={visit ? 'Atendimento' : 'Novo Atendimento'} subtitle="Consulta, desconto, exames e recebimento vinculado.">{visit && <span className="badge confirmed">{visitLabels[visit.status]}</span>}<Link className="button" to="/atendimentos">Histórico de atendimentos</Link></PageHeader><CatalogLinks /><LoadState state={catalogs} />{loading && <p role="status">Carregando atendimento…</p>}{error && <div className="notice error" role="alert">{error}<button className="button" onClick={() => setLoadKey(i => i + 1)}>Recarregar atendimento</button></div>}
    {!loading && !error && <div className="visit-layout"><form autoComplete="off" className="panel" onSubmit={submit}><fieldset disabled={readOnly || busy || !!catalogs.error}><legend>Paciente e consulta</legend><PatientPicker id={form.patient_id} name={form.patient_name} disabled={linked || readOnly} onChange={p => setForm({ ...form, patient_id: p.id, patient_name: p.full_name })} /><div className="form-grid"><div><label htmlFor="visit-professional">Profissional responsável</label><select id="visit-professional" required disabled={linked || readOnly} value={form.professional_id} onChange={e => setForm({ ...form, professional_id: e.target.value })}><option value="">Selecione</option>{catalogs.data?.professionals.filter(p => p.active || p.id === form.professional_id).map(p => <option key={p.id} value={p.id}>{p.full_name}{!p.active && ' (inativo)'}</option>)}</select></div><div><label htmlFor="visit-type">Tipo de consulta</label><select id="visit-type" required disabled={linked || readOnly} value={form.appointment_type_id} onChange={e => { const t = catalogs.data?.consultations.find(t => t.id === e.target.value); setForm({ ...form, appointment_type_id: e.target.value, base: t ? moneyInput(t.default_price) : '0,00', discount: '0,00' }) }}><option value="">Selecione</option>{catalogs.data?.consultations.filter(t => t.active || t.id === form.appointment_type_id).map(t => <option key={t.id} value={t.id}>{t.name}{!t.active && ' (inativo)'}</option>)}</select></div><div><label htmlFor="visit-date">Data</label><input autoComplete="off" id="visit-date" type="date" required disabled={linked || readOnly} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div><div><label htmlFor="visit-time">Horário</label><input autoComplete="off" id="visit-time" type="time" required disabled={linked || readOnly} value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></div><div><label htmlFor="visit-base">Valor da consulta (R$)</label><input autoComplete="off" id="visit-base" inputMode="decimal" required value={form.base} onChange={e => setForm({ ...form, base: e.target.value })} /><p className="fine-print">Preço aplicado neste atendimento; pode ser zero.</p></div><div><label htmlFor="visit-discount">Desconto da consulta (R$)</label><input autoComplete="off" id="visit-discount" inputMode="decimal" required value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} /></div></div></fieldset>
    <fieldset disabled={readOnly || busy || !!catalogs.error}><legend>Exames</legend>{items.length === 0 && <p>Nenhum exame adicionado.</p>}{items.map((item, index) => <div className="exam-row" key={item.exam_id}><span>{item.name}</span><div><label htmlFor={`exam-price-${index}`}>Valor de {item.name} (R$)</label><input autoComplete="off" id={`exam-price-${index}`} inputMode="decimal" required value={item.price} onChange={e => setItems(items.map((x, i) => i === index ? { ...x, price: e.target.value } : x))} /></div>{!readOnly && <button className="button" type="button" onClick={() => setItems(items.filter((_, i) => i !== index))} aria-label={`Remover ${item.name}`}>Remover</button>}</div>)}{!readOnly && <div className="add-exam"><div><label htmlFor="visit-exam">Adicionar exame</label><select id="visit-exam" value={selectedExam} onChange={e => setSelectedExam(e.target.value)}><option value="">Selecione um exame</option>{catalogs.data?.exams.filter(e => e.active && !items.some(i => i.exam_id === e.id)).map(e => <option key={e.id} value={e.id}>{e.name} · {currency(e.default_price)}</option>)}</select></div><button type="button" className="button" onClick={addExam} disabled={!selectedExam}>+ Adicionar exame</button></div>}</fieldset>
    <fieldset disabled={readOnly || busy}><legend>Observação administrativa</legend><label htmlFor="visit-notes">Observação (opcional)</label><textarea id="visit-notes" maxLength={2000} value={form.admin_notes} onChange={e => setForm({ ...form, admin_notes: e.target.value })} /></fieldset>{!readOnly && financeCatalogs.data && !financeCatalogs.error && <PaymentEditor automationAvailable={automation.error?null:!!automation.data} catalogs={financeCatalogs.data} value={payments} onChange={setPayments} total={totals.total/100} disabled={busy}/ >}{!readOnly && <div className="inline-actions"><button className="button" type="submit" value="draft" formNoValidate disabled={busy || !!validation || !!catalogs.error}>Salvar rascunho</button><button className="button primary" type="submit" value="complete" disabled={busy || !!validation || !!catalogs.error}>{busy ? 'Salvando…' : 'Concluir atendimento'}</button></div>}</form>
    <aside className="panel visit-summary"><h2>Resumo do atendimento</h2><div className="summary-line"><span>Consulta após desconto</span><strong>{currency(totals.consultation / 100)}</strong></div><div className="summary-line"><span>Exames</span><strong>{currency((totals.total - totals.consultation) / 100)}</strong></div><div className="total-line"><span>Total</span><strong>{currency(totals.total / 100)}</strong></div>{validation && <p className="form-error" role="alert">{validation}</p>}<p className="fine-print">Consulta final + soma dos exames. O valor é conferido pelo banco ao salvar.</p>{visit?.status === 'completed' && <p className="notice">Concluído. O registro permanece disponível no histórico. <Link to={`/financeiro/receber?visit=${visit.id}`}>Consultar / registrar recebimento</Link></p>}{visit?.cancel_reason && <p className="notice">Cancelamento: {visit.cancel_reason}</p>}{visit && visit.status !== 'cancelled' && <button className="button danger" onClick={() => {setReason('');setCancelOpen(!cancelOpen)}} disabled={busy}>Cancelar atendimento</button>}{cancelOpen && <Modal title="Cancelar atendimento" busy={busy} onClose={() => {setCancelOpen(false);setReason('')}}><form autoComplete="off" onSubmit={cancel} className="cancel-form"><label htmlFor="cancel-visit-reason">Motivo do cancelamento</label><textarea id="cancel-visit-reason" required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /><button className="button danger" disabled={busy}>Confirmar cancelamento</button></form></Modal>}</aside></div>}{message && <p className="notice feedback-notice" role="status">{message}</p>}</>
}

