// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { expect, test } from '@playwright/test'

test('login, prévia, rotas e layout responsivo', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/pacientes')
  await expect(page.getByRole('heading', { name: 'Bem-vindo à OPTOCOM' })).toBeVisible()
  await page.getByRole('link', { name: 'Conhecer a estrutura visual' }).click()
  await expect(page.getByRole('heading', { name: 'OPTOCOM Visão', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true })
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Abrir menu' }).click()
  await page.getByRole('link', { name: 'Pacientes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible()
  await expect(page.getByText('Este módulo será implementado na Fase 2', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible()
  await page.goto('/visualizar/configuracoes')
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
