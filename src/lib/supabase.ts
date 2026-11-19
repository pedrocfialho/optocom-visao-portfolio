import { createClient } from '@supabase/supabase-js'
import { readPublicConfig } from './env'
import type { Database } from './database.types'
import { initialPasswordFlow } from '../features/auth/passwordFlow'

// A importação captura o tipo do callback antes de createClient inicializar.
export { initialPasswordFlow }

function configure() {
  try {
    // Seleção explícita: não incorporar outras variáveis VITE_ ao bundle.
    const config = readPublicConfig({
      VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    })
    return {
      client: config ? createClient<Database>(config.url, config.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.sessionStorage },
      }) : null,
      error: null,
    }
  } catch (error) {
    return { client: null, error: error instanceof Error ? error.message : 'Configuração inválida.' }
  }
}

export const { client: supabase, error: configurationError } = configure()
