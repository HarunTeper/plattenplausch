import Alpine from 'alpinejs'
import './style.css'
import { draft } from './draft.js'
import { ranking } from './ranking.js'
import { confirm } from './confirm.js'

// KILL-SWITCH: this app used to ship a PWA service worker, which served stale
// builds (blank confirm page, flip-flopping ranking versions). We removed it.
// Any visitor who still has the old SW installed must have it unregistered, or
// they'd keep getting the cached old version forever. This self-heals them.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister())
  })
  if (window.caches && caches.keys) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
  }
}

window.Alpine = Alpine
Alpine.data('draft', draft)
Alpine.data('ranking', ranking)
Alpine.data('confirm', confirm)
Alpine.start()
