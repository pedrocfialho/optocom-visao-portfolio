import { createClient } from '@supabase/supabase-js'
import { readAdminConfig } from './admin-config.mjs'

// Ferramenta administrativa de servidor, nunca importada pelo frontend.
// Executar somente em ambiente próprio, após configurar as variáveis do processo.
// Envia convites reais e cria perfis; não faz parte dos testes nem da prévia.
async function main() {
  const { url, key, redirectTo, admins } = readAdminConfig(process.env)
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw new Error('Não foi possível consultar usuários. Confira o projeto e a chave administrativa.')
    users.push(...data.users)
    if (data.users.length < 100) break
  }
  const { data: profiles, error: profileError } = await client.from('users_profile').select('id,active')
  if (profileError) throw new Error('Aplique a migration da Fase 1 antes de provisionar.')
  const allowedEmails = new Set(admins.map(admin => admin.email))
  if (profiles.some(profile => profile.active && !users.some(user => user.id === profile.id && allowedEmails.has(user.email?.toLowerCase())))) {
    throw new Error('Existem outros perfis ativos neste projeto. Revise manualmente antes de provisionar os três administradores.')
  }
  for (const [index, admin] of admins.entries()) {
    let user = users.find(user => user.email?.toLowerCase() === admin.email)
    if (!user) {
      const { data, error } = await client.auth.admin.inviteUserByEmail(admin.email, { redirectTo })
      if (error || !data.user) throw new Error(`Falha no convite do administrador ${index + 1}. Verifique o limite de e-mails/SMTP no Supabase e execute novamente.`)
      user = data.user
    }
    const existing = profiles.find(profile => profile.id === user.id)
    if (existing && !existing.active) throw new Error(`Administrador ${index + 1} está inativo. Reativação exige revisão manual.`)
    const { error } = await client.from('users_profile').upsert({ id: user.id, full_name: admin.full_name, role: 'admin', active: true })
    if (error) throw new Error(`Falha ao gravar o perfil ${index + 1}. O convite pode já existir; corrija a configuração e execute novamente.`)
    console.log(`Administrador ${index + 1}: perfil preparado${existing ? ' (já existente)' : ''}.`)
  }
  console.log('Três perfis preparados. Cada pessoa deve usar seu próprio convite para definir a senha.')
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
