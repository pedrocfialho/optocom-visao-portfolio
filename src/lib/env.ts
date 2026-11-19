export type PublicConfig = { url: string; key: string }

export function readPublicConfig(env: Record<string, unknown>): PublicConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim()
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  if (!url && !key) return null
  if (!url || !key) throw new Error('Preencha as duas variáveis públicas de ambiente do Supabase.')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('A conexão com o Supabase deve usar HTTPS.')
  }
  if (key.startsWith('sb_secret_')) throw new Error('Uma chave secreta não pode ser usada no frontend.')
  if (!key.startsWith('sb_publishable_')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.role !== 'anon') throw new Error('role')
    } catch {
      throw new Error('Use a chave pública publishable ou a chave anon, nunca service_role.')
    }
  }
  return { url: parsed.origin, key }
}
