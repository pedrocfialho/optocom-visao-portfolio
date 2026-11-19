// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { expect, test } from '@playwright/test'
import { operationalApi } from './support/operational-api'

test('revalidação preserva rascunho e navegação não duplica consultas da agenda', async ({ page }) => {
  test.setTimeout(120000)
  const backend = await operationalApi(page, true), calls: string[] = [], errors: string[] = []
  page.on('request', request => { const url = new URL(request.url()); if (url.hostname.endsWith('.supabase.co')) calls.push(url.pathname) })
  page.on('pageerror', error => errors.push(error.message))
  async function navigate(path: string) {
    if (await page.getByRole('button', { name: 'Abrir menu' }).isVisible()) await page.getByRole('button', { name: 'Abrir menu' }).click()
    const verified = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/users_profile')
    await page.locator('.sidebar a[href="' + path + '"]').click()
    await verified
    await expect(page.getByRole('status')).toHaveCount(0)
  }
  try {
    await page.goto('/login')
    await page.getByLabel('E-mail').fill('admin@example.test'); await page.getByLabel('Senha', { exact: true }).fill('senha-somente-teste')
    await page.getByRole('button', { name: 'Entrar no sistema' }).click()
    await expect(page.getByRole('heading', { name: 'OPTOCOM Visão', exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
    calls.length = 0
    await navigate('/agenda')
    expect(calls.filter(path => path === '/rest/v1/appointment_overview')).toHaveLength(1)
    expect(calls.filter(path => path === '/rest/v1/professionals')).toHaveLength(1)
    expect(calls.filter(path => path === '/rest/v1/appointment_types')).toHaveLength(1)
    expect(calls.filter(path => path === '/rest/v1/exams')).toHaveLength(0)
    await navigate('/pacientes')
    await page.getByRole('button', { name: '+ Novo paciente' }).click()
    await page.getByLabel('Nome completo', { exact: true }).fill('Rascunho local não salvo')
    calls.length = 0
    const checked = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/users_profile')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await checked
    await expect.poll(() => calls.filter(path => path === '/rest/v1/rpc/search_patients').length).toBe(1)
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue('Rascunho local não salvo')
    expect(backend.unexpected).toEqual([]); expect(errors).toEqual([])
  } finally { await backend.close() }
})
