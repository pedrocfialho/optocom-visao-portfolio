// Auditoria local; não conecta ao Supabase e não imprime valores de ambiente.
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises'
import {join,relative} from 'node:path'
import {createHash} from 'node:crypto'
import {loadEnv} from 'vite'
import {readPublicConfig} from '../src/lib/env.ts'
const root=process.cwd(),directory=join(root,'dist')
async function files(path){return (await Promise.all((await readdir(path,{withFileTypes:true})).map(e=>e.isDirectory()?files(join(path,e.name)):[join(path,e.name)]))).flat()}
const paths=await files(directory),env=loadEnv('production',root,''),config=readPublicConfig(env)
if(!config||new URL(config.url).protocol!=='https:')throw new Error('Configuração pública de produção ausente ou inválida.')
const issues=[],text=[]
for(const path of paths){
 const name=relative(directory,path).replaceAll('\\','/')
 if(/(?:^|\/)(?:\.env[^/]*|node_modules|supabase|scripts|backups)(?:\/|$)|\.(?:sql|pfx|p12|pem|credential\.xml|map)$/i.test(name))issues.push('Arquivo indevido no dist: '+name)
 if(/\.(?:js|css|html|svg)$/.test(name))text.push(await readFile(path,'utf8'))
}
const bundle=text.join('\n')
for(const [name,pattern] of Object.entries({secret_key:/sb_secret_[A-Za-z0-9_-]{8,}/,personal_access_token:/\bsbp_[A-Za-z0-9]{20,}/,private_key:/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/,connection_with_password:/postgres(?:ql)?:\/\/[^\s"']+:[^\s"'@]+@/,audit_canary:/optocom-audit-unreferenced-(?:public|private)-canary/}))if(pattern.test(bundle))issues.push('Padrão indevido: '+name)
for(const jwt of bundle.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)){
 try{const payload=JSON.parse(Buffer.from(jwt[0].split('.')[1],'base64url').toString());if(payload.role==='service_role')issues.push('JWT privilegiado no bundle')}catch{}
}
// Comparar variáveis privadas disponíveis em memória sem registrar seus valores.
for(const [name,value] of Object.entries(env))if(!name.startsWith('VITE_')&&/(?:PASSWORD|SERVICE_ROLE|ACCESS_TOKEN|SECRET_KEY|PRIVATE_KEY|DATABASE_URL)/i.test(name)&&value.length>=8&&bundle.includes(value))issues.push('Valor de variável privada incorporado ao bundle')
if(!bundle.includes(config.key)||!bundle.includes(config.url))issues.push('Configuração pública esperada não foi incorporada')
for(const name of ['_headers','_redirects'])if(await readFile(join(directory,name),'utf8')!==await readFile(join(root,'public',name),'utf8'))issues.push('Arquivo Cloudflare divergente: '+name)
const redirects=await readFile(join(directory,'_redirects'),'utf8')
if(!/^\/\*\s+\/index\.html\s+200\s*$/m.test(redirects))issues.push('Fallback SPA ausente')
const index=await readFile(join(directory,'index.html'),'utf8')
if(index.includes('/src/')||index.includes('/@vite/client'))issues.push('HTML de desenvolvimento no dist')
const hashes={}
for(const name of (await readdir(join(root,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort())hashes[name]=createHash('sha256').update(await readFile(join(root,'supabase/migrations',name))).digest('hex').toUpperCase()
const report={date:new Date().toISOString().slice(0,10),passed:issues.length===0,files:paths.length,public_variables:['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY'],https_project_url:true,key_kind:config.key.startsWith('sb_publishable_')?'publishable':'anon',source_maps:paths.filter(x=>x.endsWith('.map')).length,cloudflare_files_copied:true,spa_fallback:true,library_loopback_literals:(bundle.match(/http:\/\/localhost/g)??[]).length,loopback_review:'Literais internos de fallback/base de URL do React Router e Supabase Auth SDK; a aplicação usa a origem HTTPS do navegador e o projeto remoto configurado. Testes HTTPS interceptam e recusam qualquer origem inesperada.',issues,migration_hashes:hashes,limits:'Varredura estática do artefato e dos valores privados disponíveis no ambiente; não acessa credenciais protegidas do Windows nem substitui testes após a publicação.'}
await mkdir(join(root,'test-results'),{recursive:true})
await writeFile(join(root,'test-results/production-audit.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
if(issues.length)process.exitCode=1
