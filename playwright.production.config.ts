import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'./e2e-production',workers:1,
 use:{baseURL:'https://optocom-auditoria.invalid',headless:true,channel:process.env.PLAYWRIGHT_CHANNEL},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
})
