// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
// Somente builds locais inválidos, com valores sintéticos. Não faz conexão externa.
import {spawnSync} from 'node:child_process'
const cases=[
 ['sem configuração',{VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:''},/Build de produção exige as duas/],
 ['backend local',{VITE_SUPABASE_URL:'http://127.0.0.1:54321',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_only'},/Build de produção exige URL HTTPS remota/],
 ['backend local HTTPS',{VITE_SUPABASE_URL:'https://localhost',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_only'},/Build de produção exige URL HTTPS remota/],
 ['chave secret',{VITE_SUPABASE_URL:'https://synthetic.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_synthetic_only'},/chave secreta não pode/],
 ['JWT service_role',{VITE_SUPABASE_URL:'https://synthetic.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'header.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.synthetic'},/nunca service_role/],
]
for(const [name,values,expected] of cases){
 const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{env:{...process.env,...values},encoding:'utf8',timeout:30000})
 if(result.status===0||!expected.test(result.stdout+result.stderr))throw new Error('Proteção de build não passou: '+name)
 console.log('PASS: bloqueado build '+name)
}
console.log('PASS: 5 proteções de produção; nenhuma alteração externa.')
