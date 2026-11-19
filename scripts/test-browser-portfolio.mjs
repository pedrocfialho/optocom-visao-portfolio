// Testes somente locais: não herda URL de produção nem credenciais Supabase.
import {spawnSync} from 'node:child_process'
const env={...process.env}
for(const key of Object.keys(env))if(/^(?:VITE_|SUPABASE_|PLAYWRIGHT_BASE_URL$)/i.test(key))delete env[key]
const fake={VITE_SUPABASE_URL:'https://portfolio-demo.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_only'}
function run(entry,args,variables){
 const result=spawnSync(process.execPath,[entry,...args],{env:{...env,...variables},stdio:'inherit'})
 if(result.error)throw result.error
 if(result.status!==0)process.exit(result.status??1)
}
const business=['agenda-actions','auth-invite','operational','financial','performance','usability','usability-round2'].map(n=>`e2e/${n}.spec.ts`)
const playwright='node_modules/@playwright/test/cli.js'
run(playwright,['test',...business,'--workers=1','--output=test-results/business'],fake)
run(playwright,['test','e2e/foundation.spec.ts','--workers=1','--output=test-results/foundation'],{})
run('node_modules/typescript/bin/tsc',['-b'],fake)
run('node_modules/vite/bin/vite.js',['build'],fake)
run(playwright,['test','--config','playwright.production.config.ts','--output=test-results/production'],fake)
