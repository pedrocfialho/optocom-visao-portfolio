import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pager } from '../operations/shared'
import * as api from './api'
import { CatalogEditor } from './SettingsPage'
import { currency,dateLabel } from './domain'
import { FinanceHeader,FinanceLinks,FinanceState,useFinance } from './shared'
export function SuppliersPage(){const catalogs=useFinance(api.catalogs),[offset,setOffset]=useState(0),balances=useFinance(()=>api.supplierBalances(offset),[offset]);return <><FinanceHeader title="Fornecedores" subtitle="Cadastro, inativação e histórico financeiro sem exclusão definitiva."/><FinanceLinks/><FinanceState state={catalogs}/>{catalogs.data&&!catalogs.error&&<CatalogEditor kind="suppliers" catalogs={catalogs.data} onSaved={()=>{catalogs.refresh();balances.refresh()}}/>}<section className="panel finance-section"><h2>Histórico por fornecedor</h2><FinanceState state={balances}/>{balances.data&&<><div className="table-scroll"><table><thead><tr><th>Fornecedor</th><th>Total pago</th><th>Pendente</th><th>Último pagamento</th><th>Histórico</th></tr></thead><tbody>{balances.data.slice(0,20).map(s=><tr key={s.id}><td>{s.name}</td><td>{currency(s.paid_amount)}</td><td>{currency(s.pending_amount)}</td><td>{dateLabel(s.last_payment)}</td><td><Link className="button" to={`/saidas?fornecedor=${s.id}`}>Histórico de {s.name}</Link></td></tr>)}</tbody></table></div><Pager offset={offset} count={balances.data.length} change={setOffset}/></>}</section></>}
