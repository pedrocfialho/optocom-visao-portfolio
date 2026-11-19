// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {test,expect,type Page} from '@playwright/test'
import {operationalApi} from './support/operational-api'
import {clinicInstant,clinicParts} from '../src/features/operations/domain'
import {addDays} from '../src/features/finance/domain'
async function login(page:Page){await page.goto('/login');await page.getByLabel('E-mail',{exact:true}).fill('admin@example.test');await page.getByLabel('Senha',{exact:true}).fill('senha-sintetica-local');await page.getByRole('button',{name:'Entrar no sistema',exact:true}).click();await expect(page.getByRole('heading',{name:'OPTOCOM Visão',exact:true})).toBeVisible()}
async function seed(backend:Awaited<ReturnType<typeof operationalApi>>){
 const scalar=async<T=unknown>(sql:string,args:unknown[]=[])=>Object.values((await backend.db.query<Record<string,T>>(sql,args)).rows[0])[0]
 const pro=await scalar<string>("insert into professionals(full_name) values('Profissional agenda') returning id"),type=await scalar<string>("insert into appointment_types(name,default_price) values('Consulta agenda',100) returning id")
 return {scalar,async add(name:string,date:string,time:string){const patient=await scalar<string>('insert into patients(full_name,phone) values($1,$2) returning id',[name,'51999990001']);return scalar<string>('insert into appointments(patient_id,professional_id,appointment_type_id,start_at) values($1,$2,$3,$4) returning id',[patient,pro,type,clinicInstant(date,time)])}}
}
test('agenda: cancelar consulta futura e do dia, confirmação, histórico e Dashboard',async({page},info)=>{
 test.setTimeout(90000);const backend=await operationalApi(page,true,true,true,true),data=await seed(backend),today=clinicParts().date,future=addDays(today,1),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 try{
  const futureId=await data.add('Consulta futura',future,'14:30'),todayId=await data.add('Consulta do dia',today,'10:00')
  await login(page);await expect(page.getByRole('heading',{name:'Agendados',exact:true}).locator('..').locator('.value')).toHaveText('1')
  await page.goto('/agenda');await page.getByLabel('Dia da agenda').fill(future)
  page.once('dialog',async d=>{expect(d.message()).toContain(`Cancelar a consulta de Consulta futura em ${future.split('-').reverse().join('/')} às 14:30?`);await d.dismiss()})
  await page.getByRole('button',{name:'Cancelar consulta',exact:true}).click();expect(await data.scalar('select status from appointments where id=$1',[futureId])).toBe('scheduled')
  await page.getByRole('button',{name:'Editar agendamento',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('dialog',{name:'Agendamento',exact:true}).getByRole('button',{name:'Cancelar consulta',exact:true}).click()
  await expect(page.getByText('Consulta cancelada com sucesso. O histórico foi preservado.')).toBeVisible();await expect(page.locator('.agenda-row')).toHaveCount(0)
  await page.getByLabel('Status na agenda').selectOption('cancelled');await expect(page.locator('.agenda-cancelled')).toContainText('Consulta futura');await expect(page.locator('.agenda-cancelled .badge')).toHaveText('Cancelada');await expect(page.getByRole('button',{name:'Iniciar atendimento',exact:true})).toHaveCount(0);await page.screenshot({path:info.outputPath('agenda-cancelada.png'),fullPage:true})
  await page.getByLabel('Dia da agenda').fill(today);await page.getByLabel('Status na agenda').selectOption('current');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancelar consulta',exact:true}).click();await expect(page.locator('.agenda-row')).toHaveCount(0)
  expect(await data.scalar("select count(*)::int from audit_log where entity_type='appointments' and action='update' and after_json->>'status'='cancelled'")).toBe(2);expect(await data.scalar('select count(*)::int from appointments where id in ($1,$2)',[futureId,todayId])).toBe(2)
  await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Agendados',exact:true}).locator('..').locator('.value')).toHaveText('0');expect(errors).toEqual([]);expect(backend.unexpected).toEqual([])
 }finally{await backend.close()}
})
test('agenda: exclusão auditada sem vínculos, bloqueio com vínculo e edição normal',async({page},info)=>{
 test.setTimeout(90000);const backend=await operationalApi(page,true,true,true,true),data=await seed(backend),date=clinicParts().date,errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 try{
  const free=await data.add('Engano sem vínculo',date,'09:00'),linked=await data.add('Consulta vinculada',date,'10:00'),edit=await data.add('Consulta editável',date,'11:00');await data.scalar('select start_visit($1)',[linked]);await login(page);await page.goto('/agenda')
  const row=(name:string)=>page.locator('.agenda-row').filter({hasText:name})
  await row('Engano sem vínculo').getByRole('button',{name:'Editar agendamento',exact:true}).click();const modal=page.getByRole('dialog',{name:'Agendamento',exact:true});await expect(modal.getByRole('button',{name:'Excluir agendamento',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('agenda-acoes.png')})
  const dismissed=page.waitForEvent('dialog').then(async d=>{expect(d.message()).toContain('exclusão é definitiva');await d.dismiss()});await modal.getByRole('button',{name:'Excluir agendamento',exact:true}).click();await dismissed;await expect(modal.getByRole('button',{name:'Excluir agendamento',exact:true})).toBeEnabled();expect(await data.scalar('select count(*)::int from appointments where id=$1',[free])).toBe(1)
  const accepted=page.waitForEvent('dialog').then(d=>d.accept());await modal.getByRole('button',{name:'Excluir agendamento',exact:true}).click();await accepted;await expect(page.getByText('Agendamento excluído definitivamente. A auditoria foi preservada.')).toBeVisible();await expect(row('Engano sem vínculo')).toHaveCount(0)
  expect(await data.scalar("select count(*)::int from audit_log where entity_id=$1 and after_json->>'deleted'='true'",[free])).toBe(1)
  await row('Consulta vinculada').getByRole('button',{name:'Editar agendamento',exact:true}).click();await expect(modal.getByText(/Exclusão bloqueada: há atendimento vinculado/)).toBeVisible();await expect(modal.getByRole('button',{name:'Excluir agendamento',exact:true})).toHaveCount(0);await modal.getByRole('button',{name:'Cancelar consulta',exact:true}).click();await expect(modal.getByText(/Este agendamento tem atendimento vinculado/)).toBeVisible();expect(await data.scalar('select status from appointments where id=$1',[linked])).toBe('scheduled');await modal.getByRole('button',{name:'Fechar janela',exact:true}).click()
  await row('Consulta editável').getByRole('button',{name:'Editar agendamento',exact:true}).click();await page.getByLabel('Horário',{exact:true}).fill('11:30');await page.getByLabel('Observação administrativa (opcional)',{exact:true}).fill('Edição normal');await page.getByRole('button',{name:'Salvar agendamento',exact:true}).click();await expect(page.getByText('Agendamento salvo com sucesso.')).toBeVisible();await expect(row('Consulta editável')).toContainText('11:30')
  await row('Consulta editável').getByRole('button',{name:'Editar agendamento',exact:true}).click();await expect(modal.getByText(/Este agendamento possui histórico ou vínculos/)).toBeVisible();await expect(modal.getByRole('button',{name:'Excluir agendamento',exact:true})).toHaveCount(0);expect(await data.scalar('select admin_notes from appointments where id=$1',[edit])).toBe('Edição normal');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);expect(backend.unexpected).toEqual([])
 }finally{await backend.close()}
})

test('agenda sem migration nova: bloqueia exclusão e mantém cancelamento disponível',async({page})=>{
 test.setTimeout(90000);const backend=await operationalApi(page,true,true),data=await seed(backend)
 try{
  const id=await data.add('Consulta compatível',clinicParts().date,'09:00');await login(page);await page.goto('/agenda');await page.getByRole('button',{name:'Editar agendamento',exact:true}).click();const modal=page.getByRole('dialog',{name:'Agendamento',exact:true})
  await expect(modal.getByText(/A exclusão segura de agendamentos ainda não está habilitada/)).toBeVisible();await expect(modal.getByRole('button',{name:'Excluir agendamento',exact:true})).toHaveCount(0)
  page.once('dialog',d=>d.accept());await modal.getByRole('button',{name:'Cancelar consulta',exact:true}).click();await expect(page.getByText('Consulta cancelada com sucesso. O histórico foi preservado.')).toBeVisible();expect(await data.scalar('select status from appointments where id=$1',[id])).toBe('cancelled');expect(backend.unexpected).toEqual([])
 }finally{await backend.close()}
})
