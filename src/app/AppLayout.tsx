import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogOut, Menu, X, ShieldCheck } from 'lucide-react'
import { Brand } from '../components/Brand'
import { PhaseNotice } from '../components/PhaseNotice'
import { navigation } from './navigation'
import { useAuth } from '../features/auth/AuthProvider'

export function AppLayout({ preview = false }: { preview?: boolean }) {
  const { state, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState('')
  const location = useLocation()
  const heading = useRef<HTMLDivElement>(null)
  const base = preview ? '/visualizar' : ''
  const title = navigation.find(item => location.pathname.endsWith('/' + item.path))?.title ?? (location.pathname.startsWith('/configuracoes/') ? 'Configurações' : 'OPTOCOM Visão')
  const name = state.status === 'authenticated' ? state.profile.full_name : 'Prévia visual'
  useEffect(() => { document.title = `${title} · OPTOCOM Visão`; setMenuOpen(false); heading.current?.focus({ preventScroll: true }); window.scrollTo(0, 0) }, [location.pathname, title])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  return <div className="app"><a className="skip-link" href="#content">Pular para o conteúdo</a>{menuOpen && <button className="menu-backdrop" aria-label="Fechar navegação" onClick={() => setMenuOpen(false)} />}
    <aside id="main-navigation" className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Navegação principal"><Brand /><button className="icon-button mobile-close" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}><X /></button><nav>{['Principal', 'Financeiro', 'Gestão'].map(group => <div key={group}><p className="nav-group">{group}</p>{navigation.filter(item => item.group === group).map(({ path, title: label, icon: Icon }) => <NavLink to={`${base}/${path}`} key={path}><Icon size={18} aria-hidden="true" /><span>{label}</span></NavLink>)}</div>)}</nav><div className="sidebar-footer"><ShieldCheck size={15} /><span>OPTOCOM Visão<small>Gestão integrada · v0.3</small></span></div></aside>
    <div className="main"><header className="topbar"><div className="topbar-title"><button className="icon-button mobile-toggle" aria-label="Abrir menu" aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu /></button><span>{title}</span></div><div className="user"><span className="user-name">{name}<small>{preview ? 'Sem acesso a dados' : 'Administrador'}</small></span><span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>{preview ? <Link className="icon-button" to="/login" aria-label="Sair da prévia"><LogOut size={18} /></Link> : <button className="icon-button" aria-label="Sair do sistema" onClick={() => void signOut().catch(e => setError(e.message))}><LogOut size={18} /></button>}</div></header>
    <main id="content" className="content" tabIndex={-1} ref={heading}>{preview && <div className="preview-banner">Prévia visual · Sem dados reais e sem operações de cadastro.</div>}{error && <p role="alert" className="notice error">{error}</p>}<PhaseNotice /><Outlet /></main><footer className="main-footer">OPTOCOM Visão <span>Gestão da Clínica</span></footer></div>
  </div>
}

