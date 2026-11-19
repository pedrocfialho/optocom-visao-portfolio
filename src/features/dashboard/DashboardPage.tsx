import { CalendarDays, ArrowRight, Wallet, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { clinicDate } from '../../lib/format'
import { FinanceOverviewPage } from '../finance/OverviewPage'

const indicators = [
  ['Agendados hoje', 'Agenda do dia', ''], ['Consultas', 'Receita de consultas', 'teal'], ['Exames', 'Receita de exames', 'teal'],
  ['Receita', 'Receita operacional', 'green'], ['Despesas', 'Despesas operacionais', 'red'], ['Resultado', 'Após despesas e taxas', 'green'],
]

export function DashboardPage({ base }: { base: string }) {
  if(!base)return <FinanceOverviewPage dashboard/>
  return <><div className="toolbar"><div><span className="eyebrow">VISÃO GERAL</span><h1>OPTOCOM Visão</h1><p>{clinicDate()}</p></div><span className="badge neutral"><CalendarDays size={14} /> Hoje</span></div>
    <div className="cards">{indicators.map(([label, sub, color]) => <section className="card" key={label}><h2>{label}</h2><div className={`value ${color}`}>—</div><p>{sub}</p></section>)}</div>
    <div className="grid-two"><section className="panel"><div className="panel-heading"><h2>Próximos pacientes</h2><Link to={`${base}/agenda`}>Ver agenda <ArrowRight size={14} /></Link></div><div className="table-scroll"><table><thead><tr><th>Hora</th><th>Paciente</th><th>Serviço</th><th>Status</th></tr></thead></table></div><div className="empty"><span className="empty-icon"><CalendarDays /></span><h3>Acompanhe pela agenda</h3><p>Consulte os pacientes e horários<br />na tela Agenda.</p><span className="badge neutral">Resumo gerencial em etapa futura</span></div></section>
    <section className="panel"><div className="panel-heading"><h2>Financeiro do dia</h2><Wallet size={18} className="muted" /></div>{['Pix', 'Dinheiro', 'Débito', 'Crédito', 'Taxas financeiras'].map(label => <div className="summary-line" key={label}><span>{label}</span><strong>—</strong></div>)}<p className="fine-print">Os valores serão calculados a partir dos lançamentos reais.</p></section></div>
    <div className="grid-three">{[['A receber', 'Cartões e pagamentos pendentes', 'teal'], ['Contas a pagar · 7 dias', 'Próximos vencimentos', 'red'], ['Próximo atendimento', 'Acompanhe o próximo paciente', '']].map(([title, sub, color]) => <section className="panel forecast" key={title}><h2>{title}</h2><div className={`value ${color}`}>—</div><p>{sub}</p></section>)}</div>
    <section className="welcome-panel"><div className="welcome-icon"><Users size={26} /></div><div><h2>Uma base para organizar o cuidado.</h2><p>A identidade da OPTOCOM já está aqui. Os próximos módulos serão construídos por etapas.</p></div><Link className="button" to={`${base}/configuracoes`}>Ver configurações <ArrowRight size={16} /></Link></section>
  </>
}
