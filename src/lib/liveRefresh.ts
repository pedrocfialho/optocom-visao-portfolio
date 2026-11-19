import { CHANGE_EVENT, invalidateCatalogs } from './dataCache'

// Um único relógio para os hooks montados, mesmo com vários painéis na tela.
const listeners = new Set<() => void>()
let interval: ReturnType<typeof setInterval> | undefined
let wakeup: ReturnType<typeof setTimeout> | undefined
function emit() { listeners.forEach(listener => listener()) }
function tick() { if (document.visibilityState === 'visible') emit() }
function wake() {
  if (document.visibilityState !== 'visible') return
  // Foco + visibilitychange + online da mesma transição viram uma atualização.
  if (wakeup) return
  wakeup = setTimeout(() => { wakeup = undefined; invalidateCatalogs(); emit() }, 50)
}
export function subscribeLiveRefresh(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    interval = setInterval(tick, 30_000)
    window.addEventListener(CHANGE_EVENT, emit)
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    clearInterval(interval); clearTimeout(wakeup); interval = undefined; wakeup = undefined
    window.removeEventListener(CHANGE_EVENT, emit)
    window.removeEventListener('focus', wake)
    window.removeEventListener('online', wake)
    document.removeEventListener('visibilitychange', wake)
  }
}
