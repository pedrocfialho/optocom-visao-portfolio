// Dados sintéticos de portfólio: nenhum dado do ambiente real.
// Dados sintéticos em PGlite descartável; todas as chamadas Supabase interceptadas.
import {expect,test,type Page} from '@playwright/test'
import {operationalApi} from './support/operational-api'
import {clinicParts} from '../src/features/operations/domain'
async function login(page:Page){await page.goto('/login');await page.getByLabel('E-mail',{exact:true}).fill('admin@example.test');await page.getByLabel('Senha',{exact:true}).fill('senha-sintetica-local');await page.getByRole('button',{name:'Entrar no sistema',exact:true}).click();await expect(page.getByRole('heading',{name:'OPTOCOM Visão',exact:true})).toBeVisible()}
async function setup(page:Page){
 const backend=await operationalApi(page,true,true,true,true)
 async function scalar<T=string>(sql:string,args:unknown[]=[]):Promise<T>{const {rows}=await backend.db.query<Record<string,T>>(sql,args);return Object.values(rows[0])[0]}
 const pro=await scalar("insert into professionals(full_name) values('Profissional Exemplo') returning id"),type=await scalar("insert into appointment_types(name,default_price) values('Consulta Exemplo',100) returning id")
 return {...backend,scalar,pro,type}
}
async function newAppointment(page:Page,name:string,newPatient=true){
 await page.getByRole('button',{name:'+ Novo agendamento',exact:true}).click()
 await page.getByRole('combobox',{name:'Paciente',exact:true}).fill(name)
 await page.getByRole('option',{name:newPatient?`+ Agendar novo paciente: ${name}`:new RegExp('^'+name)}).click()
 await page.getByLabel('Profissional',{exact:true}).selectOption({label:'Profissional Exemplo'})
 await page.getByLabel('Tipo de consulta',{exact:true}).selectOption({label:'Consulta Exemplo'})
 await page.getByLabel('Horário',{exact:true}).fill('14:00')
}
test('nome → agenda → completar o mesmo cadastro → atendimento, sem efeitos financeiros',async({page},info)=>{
 test.setTimeout(120000);const data=await setup(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 try{
  await login(page);await page.goto('/agenda');await newAppointment(page,'Ana Exemplo')
  expect(await data.scalar<number>('select count(*)::int from patients')).toBe(0)
  await page.getByRole('button',{name:'Salvar agendamento',exact:true}).click();await expect(page.getByText('Agendamento salvo com sucesso.')).toBeVisible()
  const before=await data.scalar<{id:string;patient_id:string;version:number}>('select to_jsonb(a) from appointments a limit 1')
  expect(await data.scalar('select phone from patients where id=$1',[before.patient_id])).toBeNull()
  expect(await data.scalar('select registration_pending from patients where id=$1',[before.patient_id])).toBe(true)
  // Telefone informado por outro fluxo não conclui o cadastro rápido.
  await data.db.query("update patients set phone='51999990001' where id=$1",[before.patient_id])
  await page.getByRole('button',{name:'Atualizar agenda',exact:true}).click()
  const row=page.locator('.agenda-row').filter({hasText:'Ana Exemplo'});await expect(row.getByText('Cadastro pendente',{exact:true})).toBeVisible()
  await row.getByRole('button',{name:'Editar agendamento',exact:true}).click()
  await page.getByLabel('Observação administrativa (opcional)',{exact:true}).fill('Rascunho administrativo Exemplo')
  await page.getByRole('button',{name:'Completar cadastro',exact:true}).click()
  const completion=page.getByRole('dialog',{name:'Completar cadastro',exact:true});await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(completion.getByLabel('Nome completo')).toHaveValue('Ana Exemplo')
  await expect(completion.getByLabel('Telefone (opcional)')).not.toHaveAttribute('required')
  await expect(completion.getByLabel('Telefone (opcional)')).toHaveValue('51999990001')
  // Concluir o formulário sem telefone também deve produzir cadastro completo.
  await completion.getByLabel('Telefone (opcional)').fill('')
  await completion.getByRole('button',{name:'Salvar paciente',exact:true}).click()
  const appointment=page.getByRole('dialog',{name:'Agendamento',exact:true});await expect(appointment).toBeVisible();await expect(appointment.getByText('Cadastro atualizado. O agendamento foi preservado.')).toBeVisible()
  await expect(appointment.getByLabel('Observação administrativa (opcional)',{exact:true})).toHaveValue('Rascunho administrativo Exemplo')
  expect(await data.scalar<number>('select count(*)::int from patients')).toBe(1)
  expect(await data.scalar('select phone from patients where id=$1',[before.patient_id])).toBeNull()
  expect(await data.scalar('select registration_pending from patients where id=$1',[before.patient_id])).toBe(false)
  expect(await data.scalar('select to_jsonb(a) from appointments a limit 1')).toEqual(before)
  await appointment.getByRole('button',{name:'Fechar edição',exact:true}).click();await expect(row.getByText('Cadastro pendente')).toHaveCount(0)
  await page.screenshot({path:info.outputPath('cadastro-completo-agenda.png'),fullPage:true})
  await row.getByRole('button',{name:'Iniciar atendimento',exact:true}).click();await expect(page.getByRole('heading',{name:'Atendimento',exact:true})).toBeVisible()
  expect(await data.scalar('select patient_id from visits limit 1')).toBe(before.patient_id)
  expect(await data.scalar<number>('select count(*)::int from finance_movements')).toBe(0)
  expect(await data.scalar<number>('select count(*)::int from finance_payments')).toBe(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(errors).toEqual([]);expect(data.unexpected).toEqual([])
 }finally{await data.close()}
})
test('existente e homônimo: selecionar sem duplicar, criar distinto, excluir e cancelar pendente',async({page},info)=>{
 test.setTimeout(120000);const data=await setup(page)
 try{
  const existing=await data.scalar("insert into patients(full_name,phone) values('Carlos Exemplo','51999990002') returning id")
  await login(page);await page.goto('/agenda');await newAppointment(page,'Carlos Exemplo',false)
  await page.getByRole('button',{name:'Salvar agendamento',exact:true}).click();await expect(page.getByText('Agendamento salvo com sucesso.')).toBeVisible()
  expect(await data.scalar<number>('select count(*)::int from patients')).toBe(1)
  expect(await data.scalar('select patient_id from appointments limit 1')).toBe(existing)
  await newAppointment(page,'Carlos Exemplo');await page.getByRole('button',{name:'Salvar agendamento',exact:true}).click();await expect(page.getByText('Agendamento salvo com sucesso.')).toBeVisible()
  expect(await data.scalar<number>('select count(*)::int from patients')).toBe(2)
  const pending=page.locator('.agenda-row').filter({has:page.getByText('Cadastro pendente',{exact:true})})
  await pending.getByRole('button',{name:'Editar agendamento',exact:true}).click()
  const modal=page.getByRole('dialog',{name:'Agendamento',exact:true});await expect(modal.getByRole('button',{name:'Excluir agendamento',exact:true})).toBeVisible()
  page.once('dialog',d=>d.accept());await modal.getByRole('button',{name:'Excluir agendamento',exact:true}).click();await expect(page.getByText('Agendamento excluído definitivamente. A auditoria foi preservada.')).toBeVisible()
  expect(await data.scalar<number>('select count(*)::int from patients')).toBe(2)
  await newAppointment(page,'Daniela Exemplo');await page.getByRole('button',{name:'Salvar agendamento',exact:true}).click();await expect(page.locator('.agenda-row').filter({hasText:'Daniela Exemplo'})).toBeVisible()
  const cancelRow=page.locator('.agenda-row').filter({hasText:'Daniela Exemplo'});page.once('dialog',d=>d.accept());await cancelRow.getByRole('button',{name:'Cancelar consulta',exact:true}).click()
  await page.getByLabel('Status na agenda').selectOption('cancelled');await expect(page.locator('.agenda-cancelled')).toContainText('Daniela Exemplo');await expect(page.locator('.agenda-cancelled')).toContainText('Cadastro pendente')
  await page.screenshot({path:info.outputPath('cancelamento-pendente.png'),fullPage:true})
  await page.locator('.agenda-cancelled').getByRole('button',{name:'Editar agendamento',exact:true}).click();await expect(modal.getByRole('button',{name:'Excluir agendamento',exact:true})).toHaveCount(0)
  await modal.getByRole('button',{name:'Fechar edição',exact:true}).click()
  await page.getByLabel('Status na agenda').selectOption('all')
  const remaining=await data.scalar<string>('select id from appointments where patient_id<>$1 and status=$2',[existing,'cancelled'])
  expect(await data.scalar<string>('select status from appointments where id=$1',[remaining])).toBe('cancelled')
  expect(await data.scalar<number>('select count(*)::int from finance_movements')).toBe(0);expect(data.unexpected).toEqual([])
 }finally{await data.close()}
})
test('cadastro normal só exige nome e falha do agendamento rápido não deixa paciente solto',async({page})=>{
 test.setTimeout(120000);const data=await setup(page)
 try{
  await login(page);await page.goto('/pacientes');await page.getByRole('button',{name:'+ Novo paciente',exact:true}).click();await page.getByLabel('Nome completo').fill('Nome Mínimo Exemplo');await page.getByRole('button',{name:'Salvar paciente',exact:true}).click();await expect(page.getByText('Paciente salvo com sucesso.')).toBeVisible()
  expect(await data.scalar('select phone from patients limit 1')).toBeNull()
  expect(await data.scalar('select registration_pending from patients limit 1')).toBe(false)
  await page.getByRole('button',{name:'Fechar cadastro',exact:true}).click()
  await expect(page.getByRole('row').filter({hasText:'Nome Mínimo Exemplo'}).getByText('Cadastro pendente')).toHaveCount(0)
  await page.goto('/agenda');await newAppointment(page,'Falha Exemplo')
  // Simula catálogo desativado em outro computador após a escolha, sem dados reais.
  await data.db.query('update professionals set active=false where id=$1',[data.pro])
  await page.getByRole('button',{name:'Salvar agendamento',exact:true}).click();await expect(page.getByRole('dialog').getByText('Selecione um profissional ativo.')).toBeVisible()
  expect(await data.scalar<number>('select count(*)::int from patients')).toBe(1)
  expect(await data.scalar<number>('select count(*)::int from appointments')).toBe(0)
  await page.getByRole('button',{name:'Fechar edição',exact:true}).click()
  await data.db.query('update professionals set active=true where id=$1',[data.pro])
  // Atendimento direto com nome apenas já é válido, sem completar campos opcionais.
  const a=await data.scalar<{id:string}>('select schedule_new_patient($1::jsonb)',[JSON.stringify({full_name:'Chegada Exemplo',professional_id:data.pro,appointment_type_id:data.type,start_at:clinicParts().date+'T17:00:00Z'})])
  await page.getByRole('button',{name:'Atualizar agenda',exact:true}).click()
  const row=page.locator('.agenda-row').filter({hasText:'Chegada Exemplo'});await expect(row.getByText('Cadastro pendente')).toBeVisible();await row.getByRole('button',{name:'Iniciar atendimento',exact:true}).click();await expect(page.getByRole('heading',{name:'Atendimento',exact:true})).toBeVisible()
  expect(await data.scalar('select appointment_id from visits limit 1')).toBe(a.id)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(data.unexpected).toEqual([])
 }finally{await data.close()}
})
