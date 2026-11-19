// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { expect, test } from '@playwright/test'

// Fixtures locais: todas as chamadas Supabase destes testes são interceptadas.
// Nenhum convite, usuário, senha ou perfil é criado no projeto real.
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'invite-test@example.test',
  aud: 'authenticated', role: 'authenticated',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
  created_at: '2026-10-30T12:00:00Z', identities: [],
}
function callback(type: string) {
  const payload = { sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test-signature`
  return `/#${new URLSearchParams({ access_token: token, refresh_token: 'test-only-refresh-token', type, token_type: 'bearer', expires_in: '3600' })}`
}

test('convite no Site URL define senha antes do perfil e mantém a clínica bloqueada', async ({ page }, testInfo) => {
  let profileRequests = 0
  let passwordUpdates = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(/https:\/\/[^/]+\.supabase\.co\/.*/, async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/auth/v1/user') {
      if (request.method() === 'PUT') passwordUpdates++
      await route.fulfill({ json: user })
    } else if (path === '/rest/v1/users_profile') {
      profileRequests++
      await route.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Table not found' } })
    } else await route.abort()
  })
  await page.goto(callback('invite'))
  await expect(page.getByLabel('Nova senha', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/definir-senha$/)
  expect(profileRequests).toBe(0)
  await page.reload()
  await expect(page.getByLabel('Nova senha', { exact: true })).toBeVisible()
  expect(profileRequests).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('definir-senha.png'), fullPage: true })
  await page.getByLabel('Nova senha', { exact: true }).fill('senha-somente-teste-1234')
  await page.getByLabel('Confirme a senha').fill('senha-somente-teste-1234')
  await page.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(page.getByText(/Senha definida com sucesso/)).toBeVisible()
  await expect(page.getByText(/estrutura de perfis ainda não está disponível/)).toBeVisible()
  expect(passwordUpdates).toBe(1)
  expect(profileRequests).toBeGreaterThan(0)
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('perfil-pendente.png'), fullPage: true })
  await page.goto('/dashboard')
  await expect(page.getByText(/estrutura de perfis ainda não está disponível/)).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await page.getByRole('link', { name: 'Definir ou alterar minha senha' }).click()
  await expect(page.getByLabel('Nova senha', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('URL de definição de senha sem sessão válida não libera formulário nem sistema', async ({ page }) => {
  await page.route(/https:\/\/[^/]+\.supabase\.co\/.*/, route => route.abort())
  await page.goto('/definir-senha')
  await expect(page.getByText(/Abra um convite ou link de recuperação válido/)).toBeVisible()
  await expect(page.getByLabel('Nova senha', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('navigation')).toHaveCount(0)
})
