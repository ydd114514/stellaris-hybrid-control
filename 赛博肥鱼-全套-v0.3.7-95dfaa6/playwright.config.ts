import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
export default defineConfig({
  testDir: './tests/e2e', timeout: 30000,
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || (existsSync('/Applications/Microsoft Edge.app') ? 'msedge' : undefined), baseURL: 'http://127.0.0.1:5173', viewport: { width: 1512, height: 982 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
  reporter: [['list'], ['html', { open: 'never' }]]
})
