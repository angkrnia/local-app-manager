import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** Injects a strict CSP into production builds only (dev needs Vite's HMR preamble). */
function productionCspPlugin(): Plugin {
  return {
    name: 'tunnel-manager-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />\n  </head>`
      )
    }
  }
}

export default defineConfig({
  main: {
    // zod and electron-updater are pure JS; bundling them lets the packaged app ship
    // without node_modules, keeping app.asar tiny (~2 MB).
    plugins: [externalizeDepsPlugin({ exclude: ['zod', 'electron-updater'] })],
    resolve: { alias: sharedAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  renderer: {
    base: './',
    plugins: [react(), tailwindcss(), productionCspPlugin()],
    resolve: {
      alias: {
        ...sharedAlias,
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
