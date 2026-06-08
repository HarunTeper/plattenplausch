import Alpine from 'alpinejs'
import './style.css'
import { draft } from './draft.js'
import { ranking } from './ranking.js'

// Register PWA service worker (vite-plugin-pwa virtual module).
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })

window.Alpine = Alpine
Alpine.data('draft', draft)
Alpine.data('ranking', ranking)
Alpine.start()
