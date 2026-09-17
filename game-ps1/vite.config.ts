import { defineConfig } from 'vite'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))
// Story pages are authored independently; include each once its HTML exists.
const storyEntries = ['blue-blood.html', 'end-consort.html', 'player.html'].map(page).filter(existsSync)
// The portal hall (kanshan-hall experience + iframe host) ships as its own page.
const portalEntry = existsSync(page('portal.html')) ? [page('portal.html')] : []

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: [page('index.html'), page('stories.html'), ...storyEntries, ...portalEntry],
    },
  },
})
