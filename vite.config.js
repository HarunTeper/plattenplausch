import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// The Vite "app root" is `src/` (where the HTML lives). `public/` (icons etc.)
// and `vite.config.js` stay at the repo root via the explicit options below.
export default defineConfig({
  root: 'src',
  // `.env` lives at the project root, but Vite defaults envDir to `root` (src/).
  // Point it back to the project root so VITE_* vars load in dev and build.
  envDir: __dirname,
  publicDir: resolve(__dirname, 'public'),
  // GitLab Pages serves from a project subpath unless a custom domain is used.
  // A custom HTTPS domain (required for the service worker) serves from '/'.
  // Override at build time with VITE_BASE if deploying under a subpath.
  base: process.env.VITE_BASE || '/',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        ranking: resolve(__dirname, 'src/ranking.html'),
        confirm: resolve(__dirname, 'src/confirm.html'),
      },
    },
  },
  // No service worker / PWA: it served stale builds (blank confirm page,
  // flip-flopping ranking versions) for near-zero benefit (submit + ranking both
  // need fresh network anyway). main.js carries a kill-switch that unregisters
  // any SW already installed on returning visitors so they self-heal.
})
