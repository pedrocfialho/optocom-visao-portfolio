import { LayoutDashboard, CalendarDays, Plus, Users, ClipboardList, TrendingUp, TrendingDown, Clock3, CircleDollarSign, CheckCheck, ArrowLeftRight, Landmark, Truck, ChartNoAxesCombined, Settings } from 'lucide-react'

export const navigation = [
  { group: 'Principal', path: 'dashboard', title: 'Dashboard', description: 'Uma visão geral da sua clínica.', icon: LayoutDashboard, phase: 3 },
  { group: 'Principal', path: 'agenda', title: 'Agenda', description: 'Horários do dia e status dos pacientes.', icon: CalendarDays, phase: 2 },
  { group: 'Principal', path: 'novo-atendimento', title: 'Novo Atendimento', description: 'Consulta, desconto e exames em uma única tela.', icon: Plus, phase: 2 },
  { group: 'Principal', path: 'pacientes', title: 'Pacientes', description: 'Cadastro e histórico administrativo.', icon: Users, phase: 2 },
  { group: 'Principal', path: 'atendimentos', title: 'Atendimentos', description: 'Histórico administrativo de consultas, exames e descontos.', icon: ClipboardList, phase: 2 },
  { group: 'Financeiro', path: 'financeiro', title: 'Visão geral', description: 'Resultado operacional e movimentação de caixa.', icon: ArrowLeftRight, phase: 3 },
  { group: 'Financeiro', path: 'entradas', title: 'Entradas', description: 'Receitas operacionais e entradas financeiras separadas.', icon: TrendingUp, phase: 3 },
  { group: 'Financeiro', path: 'saidas', title: 'Saídas', description: 'Despesas operacionais e saídas financeiras.', icon: TrendingDown, phase: 3 },
  { group: 'Financeiro', path: 'contas-a-pagar', title: 'Contas a Pagar', description: 'Previsibilidade dos próximos vencimentos.', icon: Clock3, phase: 3 },
  { group: 'Financeiro', path: 'contas-a-receber', title: 'Contas a Receber', description: 'Cartões e pagamentos pendentes.', icon: CircleDollarSign, phase: 3 },
  { group: 'Financeiro', path: 'fornecedores', title: 'Fornecedores', description: 'Cadastro e histórico financeiro.', icon: Truck, phase: 3 },
  { group: 'Financeiro', path: 'emprestimos', title: 'Empréstimos', description: 'Valor recebido, parcelas informadas e saldo restante.', icon: Landmark, phase: 3 },
  { group: 'Financeiro', path: 'fechamento-diario', title: 'Fechamento Diário', description: 'Conferência das entradas e do caixa físico.', icon: CheckCheck, phase: 3 },
  { group: 'Financeiro', path: 'relatorios', title: 'Relatórios', description: 'Indicadores, pagamentos e despesas por período.', icon: ChartNoAxesCombined, phase: 3 },
  { group: 'Gestão', path: 'configuracoes', title: 'Configurações', description: 'Organização e acesso da equipe OPTOCOM.', icon: Settings, phase: 1 },
] as const
