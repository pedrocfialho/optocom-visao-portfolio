import { Navigate, Outlet, Route, Routes, Link, useLocation } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { supabase, configurationError } from '../lib/supabase'
import { useAuth } from '../features/auth/AuthProvider'
import { LoginPage } from '../features/auth/LoginPage'
import { PasswordPage } from '../features/auth/PasswordPage'
import { navigation } from './navigation'

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const SettingsPage = lazy(() => import('../features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))
const ModulePage = lazy(() => import('../features/modules/ModulePage').then(m => ({ default: m.ModulePage })))
const AppLayout = lazy(() => import('./AppLayout').then(m => ({ default: m.AppLayout })))
const PatientsPage = lazy(() => import('../features/operations/PatientsPage').then(m => ({ default: m.PatientsPage })))
const AgendaPage = lazy(() => import('../features/operations/AgendaPage').then(m => ({ default: m.AgendaPage })))
const VisitPage = lazy(() => import('../features/operations/VisitPage').then(m => ({ default: m.VisitPage })))
const VisitsPage = lazy(() => import('../features/operations/VisitsPage').then(m => ({ default: m.VisitsPage })))
const CatalogPage = lazy(() => import('../features/operations/CatalogPage').then(m => ({ default: m.CatalogPage })))
const FinanceOverviewPage=lazy(()=>import('../features/finance/OverviewPage').then(m=>({default:m.FinanceOverviewPage})))
const FinanceSettingsPage=lazy(()=>import('../features/finance/SettingsPage').then(m=>({default:m.FinanceSettingsPage})))
const LedgerPage=lazy(()=>import('../features/finance/LedgerPage').then(m=>({default:m.LedgerPage})))
const DuesPage=lazy(()=>import('../features/finance/DuesPage').then(m=>({default:m.DuesPage})))
const ReceiptsPage=lazy(()=>import('../features/finance/ReceiptsPage').then(m=>({default:m.ReceiptsPage})))
const RecurringPage=lazy(()=>import('../features/finance/RecurringPage').then(m=>({default:m.RecurringPage})))
const LoansPage=lazy(()=>import('../features/finance/LoansPage').then(m=>({default:m.LoansPage})))
const SuppliersPage=lazy(()=>import('../features/finance/SuppliersPage').then(m=>({default:m.SuppliersPage})))
const ReportsPage=lazy(()=>import('../features/finance/ReportsPage').then(m=>({default:m.ReportsPage})))
const ClosingPage=lazy(()=>import('../features/finance/ClosingPage').then(m=>({default:m.ClosingPage})))

function Protected() {
  const { state } = useAuth()
  if (state.status === 'loading') return <main className="loading" role="status">Validando acesso à clínica…</main>
  return state.status === 'authenticated' ? <Outlet /> : <Navigate to="/login" replace />
}

function moduleRoutes(preview: boolean) {
  const base = preview ? '/visualizar' : ''
  const operational = { pacientes: <PatientsPage />, agenda: <AgendaPage />, 'novo-atendimento': <VisitPage />, atendimentos: <VisitsPage />,financeiro:<FinanceOverviewPage/>,entradas:<LedgerPage key="income" direction="income"/>,saidas:<LedgerPage key="expense" direction="expense"/>, 'contas-a-pagar':<DuesPage key="payable"/>, 'contas-a-receber':<DuesPage key="receivable" receivable/>,fornecedores:<SuppliersPage/>,emprestimos:<LoansPage/>,relatorios:<ReportsPage/>, 'fechamento-diario':<ClosingPage/> }
  return <><Route index element={<Navigate to={`${base}/dashboard`} replace />} />{!preview && <><Route path="configuracoes/profissionais" element={<CatalogPage key="professionals" kind="professionals" />} /><Route path="configuracoes/consultas" element={<CatalogPage key="consultations" kind="consultations" />} /><Route path="configuracoes/exames" element={<CatalogPage key="exams" kind="exams" />} /><Route path="configuracoes/financeiro" element={<FinanceSettingsPage/>}/><Route path="financeiro/recorrentes" element={<RecurringPage/>}/><Route path="financeiro/recebimentos" element={<ReceiptsPage/>}/><Route path="financeiro/receber" element={<ReceiptsPage/>}/><Route path="movimentacoes" element={<Navigate to="/financeiro" replace/>}/></>}{navigation.map(item => <Route key={item.path} path={item.path} element={item.path === 'dashboard' ? <DashboardPage base={base} /> : item.path === 'configuracoes' ? <SettingsPage /> : !preview && item.path in operational ? operational[item.path as keyof typeof operational] : <ModulePage item={item} />} />)}<Route path="*" element={<section className="panel"><h1>Página não encontrada</h1><Link to={`${base}/dashboard`}>Voltar ao Dashboard</Link></section>} /></>
}

export function App() {
  const { state } = useAuth()
  const { pathname } = useLocation()
  if (state.status === 'passwordSetup' && pathname !== '/definir-senha') return <Navigate to="/definir-senha" replace />
  return <Suspense fallback={<main className="loading" role="status">Carregando a clínica…</main>}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/recuperar-senha" element={<PasswordPage mode="request" />} /><Route path="/definir-senha" element={<PasswordPage mode="update" />} />
    <Route path="/visualizar" element={!supabase && !configurationError ? <AppLayout preview /> : <Navigate to="/login" replace />}>{moduleRoutes(true)}</Route>
    <Route element={<Protected />}><Route path="/" element={<AppLayout />}>{moduleRoutes(false)}</Route></Route>
  </Routes></Suspense>
}
