// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {test as base,expect} from '@playwright/test'
import {readFile,stat} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

// Artefato dist real, origem HTTPS sintética e headers de produção.
// Nenhuma conexão HTTP é enviada ao Supabase real ou ao domínio sintético.
const origin='https://optocom-auditoria.invalid',dist=resolve('dist')
const user={id:'00000000-0000-4000-8000-000000000001',email:'admin@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-10-30T12:00:00Z',identities:[]}
function token(){return Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test-only-signature'}
function callback(type:string){return '/#'+new URLSearchParams({access_token:token(),refresh_token:'test-only-refresh',type,token_type:'bearer',expires_in:'3600'})}
const test=base.extend<{audit:{errors:string[];unexpected:string[]}}>({audit:[async({context,page},use)=>{
 const errors:string[]=[],unexpected:string[]=[],headers:Record<string,string>={}
 for(const line of (await readFile(resolve(dist,'_headers'),'utf8')).split(/\r?\n/)){const m=line.match(/^\s+([^:]+):\s*(.+)$/);if(m)headers[m[1].toLowerCase()]=m[2]}
 page.on('pageerror',e=>errors.push(e.message))
 page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|Refused to/.test(m.text()))errors.push(m.text())})
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url())
  if(url.origin!==origin){unexpected.push(url.origin+url.pathname);await route.abort();return}
  const name=decodeURIComponent(url.pathname),candidate=resolve(dist,'.'+name)
  if(!candidate.startsWith(dist+sep)&&candidate!==dist){await route.fulfill({status:403,body:'Forbidden'});return}
  let path=candidate
  try{if(!(await stat(path)).isFile())path=resolve(dist,'index.html')}catch{path=resolve(dist,'index.html')}
  const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}
  await route.fulfill({status:200,headers:{...headers,'content-type':types[extname(path)]??'application/octet-stream'},body:await readFile(path)})
 })
 await use({errors,unexpected})
 expect(errors).toEqual([]);expect(unexpected).toEqual([])
},{auto:true}]})

test('SPA de produção abre rotas profundas, recarga e bloqueia acesso sem sessão',async({page})=>{
 await page.route(/https:\/\/[^/]+\.supabase\.co\/.*/,route=>route.abort())
 for(const path of ['/login','/recuperar-senha','/definir-senha','/dashboard']){
  const response=await page.goto(path);expect(response?.status()).toBe(200)
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
  if(path==='/recuperar-senha')await expect(page.getByRole('heading',{name:'Recuperar acesso'})).toBeVisible()
  else if(path==='/definir-senha')await expect(page.getByText('Abra um convite ou link de recuperação válido para continuar.')).toBeVisible()
  else await expect(page.getByRole('heading',{name:'Bem-vindo à OPTOCOM'})).toBeVisible()
  await page.reload();await expect(page.locator('h1,h2').first()).toBeVisible()
  expect(await page.evaluate(()=>location.protocol)).toBe('https:')
 }
})

test('recuperação usa a origem HTTPS e não revela existência de conta',async({page})=>{
 let redirect='';let calls=0
 await page.route(/https:\/\/[^/]+\.supabase\.co\/.*/,async route=>{
  const url=new URL(route.request().url())
  if(url.pathname==='/auth/v1/recover'){calls++;redirect=url.searchParams.get('redirect_to')??'';await route.fulfill({json:{}})}else await route.abort()
 })
 await page.goto('/recuperar-senha');await page.getByLabel('E-mail').fill('admin@example.test');await page.getByRole('button',{name:'Enviar instruções'}).click()
 await expect(page.getByText(/Se houver uma conta para este e-mail/)).toBeVisible()
 expect(calls).toBe(1);expect(redirect).toBe(origin+'/definir-senha')
})

for(const type of ['invite','recovery'])test('callback HTTPS de '+type+' define senha antes de exigir perfil',async({page})=>{
 let profiles=0,updates=0
 await page.route(/https:\/\/[^/]+\.supabase\.co\/.*/,async route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/auth/v1/user'){if(route.request().method()==='PUT')updates++;await route.fulfill({json:user})}
  else if(path==='/rest/v1/users_profile'){profiles++;await route.fulfill({status:404,json:{code:'PGRST205',message:'Test-only missing profile'}})}
  else await route.abort()
 })
 await page.goto(callback(type));await expect(page.getByLabel('Nova senha',{exact:true})).toBeVisible();await expect(page).toHaveURL(origin+'/definir-senha');expect(profiles).toBe(0)
 await page.reload();await expect(page.getByLabel('Nova senha',{exact:true})).toBeVisible();expect(profiles).toBe(0)
 await page.getByLabel('Nova senha',{exact:true}).fill('senha-somente-teste-1234');await page.getByLabel('Confirme a senha').fill('senha-somente-teste-1234');await page.getByRole('button',{name:'Salvar senha'}).click()
 await expect(page.getByText(/Senha definida com sucesso/)).toBeVisible();await expect(page.getByText(/estrutura de perfis ainda não está disponível/)).toBeVisible();expect(updates).toBe(1);expect(profiles).toBeGreaterThan(0)
 await expect(page.getByRole('navigation')).toHaveCount(0)
})

test('login, leitura autorizada e logout funcionam com HTTPS e CSP',async({page})=>{
 let logins=0,logouts=0
 await page.route(/https:\/\/[^/]+\.supabase\.co\/.*/,async route=>{
  const url=new URL(route.request().url()),path=url.pathname
  if(path==='/auth/v1/token'){logins++;await route.fulfill({json:{access_token:token(),refresh_token:'test-only-refresh',token_type:'bearer',expires_in:3600,user}})}
  else if(path==='/auth/v1/user')await route.fulfill({json:user})
  else if(path==='/auth/v1/logout'){logouts++;await route.fulfill({status:204})}
  else if(path==='/rest/v1/users_profile')await route.fulfill({json:{id:user.id,full_name:'Administrador Exemplo',role:'admin',active:true}})
  else if(path==='/rest/v1/recurring_expenses')await route.fulfill({json:[]})
  else if(path==='/rest/v1/rpc/finance_catalogs')await route.fulfill({json:{accounts:[],methods:[],categories:[],suppliers:[],rates:[],recurring:[]}})
  else if(path==='/rest/v1/rpc/finance_report')await route.fulfill({json:{from:'2026-11-05',to:'2026-11-05',summary:Object.fromEntries('scheduled consultations patients exams receivable payable_7 gross_revenue fees net_revenue expenses result average_ticket cash_variation consultations_revenue exams_revenue other_revenue cash_in cash_out expenses_paid fees_paid financing_cash cash_operating_result'.split(' ').map(key=>[key,0])),by_method:[],by_category:[],by_account:[]}})
  else await route.abort()
 })
 await page.goto('/login');await page.getByLabel('E-mail').fill(user.email);await page.getByLabel('Senha',{exact:true}).fill('senha-somente-teste-1234');await page.getByRole('button',{name:'Entrar no sistema'}).click()
 await expect(page.getByRole('button',{name:'Sair do sistema'})).toBeVisible();expect(logins).toBe(1)
 await page.goto('/configuracoes');await expect(page.getByRole('heading',{name:'Configurações',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Sair do sistema'}).click();await expect(page.getByRole('heading',{name:'Bem-vindo à OPTOCOM'})).toBeVisible();expect(logouts).toBe(1)
 await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Bem-vindo à OPTOCOM'})).toBeVisible()
 expect(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.endsWith('-auth-token')))).toBe(false)
})
