export function readAdminConfig(env) {
  const url = new URL(env.SUPABASE_URL || '')
  if (url.protocol !== 'https:') throw new Error('SUPABASE_URL deve usar HTTPS.')
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Informe a chave administrativa no ambiente local.')
  const appUrl = new URL(env.APP_URL || '')
  if (appUrl.protocol !== 'https:' && !(appUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(appUrl.hostname))) {
    throw new Error('APP_URL deve usar HTTPS, exceto em desenvolvimento local.')
  }
  const admins = [1, 2, 3].map(index => ({
    full_name: String(env[`ADMIN_${index}_NAME`] || '').trim(),
    email: String(env[`ADMIN_${index}_EMAIL`] || '').trim().toLowerCase(),
  }))
  if (admins.some(admin => admin.full_name.length < 2 || admin.full_name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email))) {
    throw new Error('Preencha nomes e e-mails válidos para os três administradores.')
  }
  if (new Set(admins.map(admin => admin.email)).size !== 3) throw new Error('Os três e-mails devem ser diferentes.')
  return { url: url.origin, key: env.SUPABASE_SERVICE_ROLE_KEY, redirectTo: `${appUrl.origin}/definir-senha`, admins }
}
