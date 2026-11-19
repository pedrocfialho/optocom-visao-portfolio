import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthProvider'
import { App } from './app/App'
import './styles/global.css'
import './styles/operations.css'
import './styles/finance.css'

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Não registrar dados de sessão ou de pacientes. */ }
  render() {
    return this.state.failed ? <main className="loading"><h1>Não foi possível abrir o sistema.</h1><p>Recarregue a página para tentar novamente.</p><button className="button" onClick={() => window.location.reload()}>Recarregar</button></main> : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></AppErrorBoundary></StrictMode>)
