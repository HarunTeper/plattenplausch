import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        name: 'Plattenplausch — TT Fantasy League',
        short_name: 'Plattenplausch',
        description: 'Draft your TTBL fantasy team within 100 points and climb the table.',
        lang: 'de',
        theme_color: '#ff5a1f',
        background_color: '#0b1b2b',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell + roster. The ranking gviz response is cached at
        // runtime (StaleWhileRevalidate) so the last view survives an outage.
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'ranking-gviz',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
