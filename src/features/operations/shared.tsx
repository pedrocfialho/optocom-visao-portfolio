import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import * as api from './api'
import type { Patient } from '../../lib/database.types'
import { useRemoteData } from '../../lib/useRemoteData'

export function useLoad<T>(loader: () => Promise<T>, keys: unknown[] = [], live = true, enabled = true) {
  const state = useRemoteData(loader, keys, live, enabled)
  return { ...state, error: state.error ? api.errorText(state.error) : '' }
}
export function LoadState({ state }: { state: { error: string; loading: boolean; refresh: () => void } }) {
  if (state.error) return <div className="notice error" role="alert">{state.error}<button className="button" onClick={state.refresh}>Recarregar dados</button></div>
  return state.loading ? <p className="muted" role="status">Atualizando dados…</p> : null
}
export function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <div className="toolbar"><div><span className="eyebrow">NÚCLEO DA CLÍNICA</span><h1>{title}</h1><p>{subtitle}</p></div><div className="inline-actions">{children}</div></div>
}
export function CatalogLinks() {
  return <nav className="catalog-links" aria-label="Cadastros da clínica"><Link to="/configuracoes/profissionais">Profissionais</Link><Link to="/configuracoes/consultas">Tipos de consulta</Link><Link to="/configuracoes/exames">Exames</Link></nav>
}
export function Pager({ offset, count, change }: { offset: number; count: number; change: (offset: number) => void }) {
  return <div className="pager"><button className="button" disabled={offset === 0} onClick={() => change(Math.max(0, offset - 20))}>Anterior</button><span>Página {offset / 20 + 1}</span><button className="button" disabled={count <= 20} onClick={() => change(offset + 20)}>Próxima</button></div>
}
export function PatientPicker({ id, name, onChange, disabled = false }: { id: string; name: string; onChange: (patient: Pick<Patient, 'id' | 'full_name'>) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Patient[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  function select(patient: Patient) { onChange(patient); setOpen(false); setQuery(''); setResults([]); setError('') }
  const [highlight, setHighlight] = useState(0)
  useEffect(() => {
    if (id || !open || query.trim().length < 2) return
    let ignore = false
    const timer = setTimeout(() => { void api.searchPatients(query, 0, true).then(data => { if (!ignore) { setResults(data); setError(''); setHighlight(0) } }).catch(e => { if (!ignore) setError(api.errorText(e)) }) }, 300)
    return () => { ignore = true; clearTimeout(timer) }
  }, [query, id, open])
  return <div className="patient-picker"><label htmlFor="patient-search">Paciente</label>{id ? <div className="selected-patient"><span>{name}</span>{!disabled && <button type="button" className="button" onClick={() => { onChange({ id: '', full_name: '' }); setOpen(true); setQuery(''); setResults([]); setError('') }}>Trocar paciente</button>}</div> : <><input autoComplete="off" id="patient-search" role="combobox" aria-expanded={open} aria-controls="patient-results" aria-autocomplete="list" aria-activedescendant={open && results.length ? `patient-option-${highlight}` : undefined} placeholder="Pesquisar por nome ou telefone" value={query} disabled={disabled} onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setResults([]); setError(''); setOpen(true) }} onKeyDown={e => {
    if (e.key === 'Escape') {setOpen(false);setQuery('');setResults([]);setError('')}
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(i => Math.min(results.length - 1, i + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(i => Math.max(0, i - 1)) }
    if (e.key === 'Enter' && open) { e.preventDefault(); const selected = results[highlight]; if (selected) select(selected) }
  }} />{open && <div id="patient-results" role="listbox" aria-label="Pacientes encontrados" className="patient-results">{results.map((p, i) => <button type="button" id={`patient-option-${i}`} role="option" aria-selected={i === highlight} key={p.id} onClick={() => select(p)}><strong>{p.full_name}</strong><small>{p.phone}</small></button>)}{!results.length && <p>{query.trim().length<2?'Digite ao menos 2 caracteres para pesquisar pacientes ativos.':'Nenhum paciente ativo encontrado. Cadastre-o em Pacientes.'}</p>}</div>}</>}{error && <p role="alert" className="form-error">{error}</p>}</div>
}
