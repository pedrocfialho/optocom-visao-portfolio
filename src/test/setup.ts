// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
if (typeof window !== 'undefined') window.scrollTo = vi.fn()
if(typeof HTMLDialogElement!=='undefined'){
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
 HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
}
if(typeof HTMLElement!=='undefined'&&!HTMLElement.prototype.scrollIntoView)HTMLElement.prototype.scrollIntoView=vi.fn()
afterEach(cleanup)
