import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig({
  plugins: [vue()], base: './',
  resolve: { alias: { '@shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)), '@core': fileURLToPath(new URL('./packages/core/src', import.meta.url)) } },
  publicDir: false,
  build: { outDir: 'dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    // Auditions, installers and test reports contain HTML too. They must never
    // trigger a renderer reload in the middle of an interaction or audio test.
    watch: { ignored: ['**/.local/**', '**/release/**', '**/dist/**', '**/test-results/**', '**/playwright-report/**'] },
  }
})
