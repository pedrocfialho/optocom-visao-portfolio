import { useEffect, useRef } from 'react'
import type { Patient } from '../../lib/database.types'
import type { PatientInput } from './api'
import { clinicParts } from './domain'

export const emptyPatientForm = { full_name: '', phone: '', birth_date: '', cpf: '', admin_notes: '', active: true }
export type PatientFormValue = typeof emptyPatientForm
export function patientForm(patient: Patient | null): PatientFormValue {
  return patient ? { full_name: patient.full_name, phone: patient.phone ?? '', birth_date: patient.birth_date ?? '', cpf: patient.cpf ?? '', admin_notes: patient.admin_notes, active: patient.active } : { ...emptyPatientForm }
}
export function patientInput(form: PatientFormValue): PatientInput {
  const full_name = form.full_name.trim(), phone = form.phone.trim()
  if (full_name.length < 2 || full_name.length > 160) throw new Error('Informe um nome entre 2 e 160 caracteres.')
  if (phone && (!/^.{1,25}$/.test(phone) || phone.replace(/\D/g, '').length < 8 || phone.replace(/\D/g, '').length > 15)) throw new Error('Informe um telefone com 8 a 15 dígitos ou deixe em branco.')
  if (form.birth_date && form.birth_date > clinicParts().date) throw new Error('A data de nascimento não pode estar no futuro.')
  const cpf = form.cpf.replace(/\D/g, '') || null
  if (cpf && cpf.length !== 11) throw new Error('Informe os 11 dígitos do CPF ou deixe em branco.')
  return { ...form, full_name, phone: phone || null, birth_date: form.birth_date || null, cpf }
}
export function PatientFields({ form, onChange, focus = false }: { form: PatientFormValue; onChange: (value: PatientFormValue) => void; focus?: boolean }) {
  const name = useRef<HTMLInputElement>(null)
  useEffect(() => { if (focus) name.current?.focus({ preventScroll: true }) }, [focus])
  return <><div className="form-grid">
    <div className="span-two"><label htmlFor="patient-name">Nome completo</label><input ref={name} autoComplete="off" id="patient-name" required minLength={2} maxLength={160} value={form.full_name} onChange={e => onChange({ ...form, full_name: e.target.value })} /></div>
    <div className="span-two"><label htmlFor="patient-phone">Telefone (opcional)</label><input autoComplete="off" id="patient-phone" type="tel" maxLength={25} value={form.phone} onChange={e => onChange({ ...form, phone: e.target.value })} /></div>
    <div><label htmlFor="patient-birth">Data de nascimento (opcional)</label><input autoComplete="off" id="patient-birth" type="date" max={clinicParts().date} value={form.birth_date} onChange={e => onChange({ ...form, birth_date: e.target.value })} /></div>
    <div><label htmlFor="patient-cpf">CPF (opcional)</label><input autoComplete="off" id="patient-cpf" inputMode="numeric" maxLength={14} value={form.cpf} onChange={e => onChange({ ...form, cpf: e.target.value })} /></div>
    <div className="span-two"><label htmlFor="patient-notes">Observação administrativa (opcional)</label><textarea id="patient-notes" maxLength={2000} value={form.admin_notes} onChange={e => onChange({ ...form, admin_notes: e.target.value })} /></div>
  </div><label className="check-label"><input autoComplete="off" type="checkbox" checked={form.active} onChange={e => onChange({ ...form, active: e.target.checked })} />Paciente ativo</label></>
}
