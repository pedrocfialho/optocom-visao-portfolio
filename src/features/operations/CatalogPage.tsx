import { Modal } from '../../components/Modal'
import { confirmAction } from '../../lib/confirmAction'
import { useState, type FormEvent } from 'react'
import type { CatalogRow } from './api'
import * as api from './api'
import { currency, decimal, moneyCents, moneyInput } from './domain'
import { CatalogLinks, LoadState, PageHeader, useLoad } from './shared'

export type CatalogKind = 'professionals' | 'consultations' | 'exams'
const titles = { professionals: 'Profissionais', consultations: 'Tipos de consulta', exams: 'Exames' }
export function CatalogPage({ kind }: { kind: CatalogKind }) {
  const list = useLoad(api.catalogs)
  const [previous, setPrevious] = useState<CatalogRow | null>(null)
  const [name, setName] = useState(''), [price, setPrice] = useState('0,00'), [active, setActive] = useState(true), [editing, setEditing] = useState(false)
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const rows = list.data?.[kind] ?? []
  function choose(row: CatalogRow | null) { setPrevious(row); setName(row ? 'full_name' in row ? row.full_name : row.name : ''); setPrice(row && 'default_price' in row ? moneyInput(row.default_price) : '0,00'); setActive(row?.active ?? true); setMessage(''); setEditing(true) }
  async function submit(event: FormEvent) {
    event.preventDefault(); if(busy)return; if(previous?.active&&!active&&!confirmAction('Inativar cadastro',name,'O cadastro não será oferecido para novas operações; o histórico será preservado.'))return; setBusy(true); setMessage('')
    try {
      const saved = await api.saveCatalog(kind === 'consultations' ? 'appointment_types' : kind, { name: name.trim(), price: kind === 'professionals' ? 0 : Number(decimal(moneyCents(price))), active }, previous)
      setPrevious(saved); setMessage('Cadastro salvo com sucesso.')
    } catch (error) { setMessage(api.errorText(error)) } finally { setBusy(false) }
  }
  return <><PageHeader title={titles[kind]} subtitle="Cadastros compartilhados pela equipe. Registros inativos preservam o histórico."><button className="button primary" disabled={!!list.error} onClick={() => choose(null)}>+ Novo cadastro</button></PageHeader><CatalogLinks /><LoadState state={list} /><div><section className="panel"><div className="table-scroll"><table><thead><tr><th>Nome</th>{kind !== 'professionals' && <th>Valor padrão</th>}<th>Situação</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><button className="row-link" onClick={() => choose(row)}>{'full_name' in row ? row.full_name : row.name}</button></td>{'default_price' in row && <td>{currency(row.default_price)}</td>}<td>{row.active ? 'Ativo' : 'Inativo'}</td></tr>)}</tbody></table></div>{!rows.length && !list.loading && <p className="empty-text">Nenhum cadastro encontrado.</p>}</section>{editing && <Modal title={titles[kind]} busy={busy} onClose={() => {setEditing(false);setPrevious(null);setName('');setPrice('0,00');setActive(true);setMessage('')}}><section className="panel"><form autoComplete="off" onSubmit={submit}><h2>{previous ? 'Editar cadastro' : 'Novo cadastro'}</h2><label htmlFor="catalog-name">Nome</label><input autoComplete="off" id="catalog-name" required minLength={2} maxLength={kind === 'professionals' ? 160 : 120} value={name} onChange={e => setName(e.target.value)} />{kind !== 'professionals' && <><label htmlFor="catalog-price">Valor padrão (R$)</label><input autoComplete="off" id="catalog-price" required inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /><p className="fine-print">O valor pode ser zero, inclusive para consultas de retorno.</p></>}<label className="check-label"><input autoComplete="off" type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Cadastro ativo</label><button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar cadastro'}</button><button type="button" className="button" disabled={busy} onClick={() => {setEditing(false);setPrevious(null);setName('');setPrice('0,00');setActive(true);setMessage('')}}>Fechar cadastro</button>{message && <p role="status">{message}</p>}</form></section></Modal>}</div></>
}
