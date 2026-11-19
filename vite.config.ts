import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readPublicConfig } from './src/lib/env.ts'

export default defineConfig(({ mode, command }) => {
  // Falhar antes de gerar arquivos se alguém configurar uma chave privilegiada.
  const config = readPublicConfig(loadEnv(mode, process.cwd(), 'VITE_'))
  if (command === 'build' && mode === 'production') {
    if (!config) throw new Error('Build de produção exige as duas variáveis públicas do Supabase.')
    const url = new URL(config.url)
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Build de produção exige URL HTTPS remota do Supabase.')
    }
  }
  return {
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs', 'supabase/**/*.test.ts'],
  },
  }
})
