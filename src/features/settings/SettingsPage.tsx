import { ShieldCheck, Database, Users, Clock3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { APP_TIMEZONE } from '../../lib/format'
import { CatalogLinks } from '../operations/shared'

export function SettingsPage() {
  return <><div className="toolbar"><div><span className="eyebrow">GESTÃO</span><h1>Configurações</h1><p>Organização e acesso da equipe OPTOCOM.</p></div><span className="badge neutral">Núcleo operacional</span></div><CatalogLinks /><p><a href="/configuracoes/financeiro">Formas de pagamento, contas e taxas</a></p><div className="grid-three">
    <section className="panel setting-card"><Database /><h2>Conexão com o banco</h2><span className={`badge ${supabase ? 'confirmed' : 'pending'}`}>{supabase ? 'Cliente configurado' : 'Configuração pendente'}</span><p>PostgreSQL centralizado no Supabase, com permissões de acesso no banco.</p></section>
    <section className="panel setting-card"><Users /><h2>Administradores</h2><span className="badge confirmed">3 acessos individuais previstos</span><p>Os convites e perfis são preparados pelo provisionamento seguro. Não há criação pública de contas.</p></section>
    <section className="panel setting-card"><Clock3 /><h2>Data e hora</h2><span className="badge neutral">{APP_TIMEZONE}</span><p>Datas exibidas no horário de São Paulo. Registros do banco usam instantes com fuso horário.</p></section>
  </div><section className="panel security-panel"><ShieldCheck size={25} /><div><h2>Segurança desde a fundação</h2><p>Login individual, validação do perfil ativo e políticas de acesso no PostgreSQL. A sessão deste navegador é encerrada ao fechar a aba.</p><p className="fine-print">Cadastros, agenda, atendimentos e financeiro compartilham histórico e permissões de acesso.</p></div></section></>
}

