import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { normalizeEnv } from './server/ai-core.mjs'
import { createNodeHandler } from './server/ai-node.mjs'

function aiProxy(env: { key: string; base: string; model: string }): Plugin {
  const handler = createNodeHandler(env)
  return {
    name: 'aegis-ai-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ai', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ai', handler)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = normalizeEnv(loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), aiProxy(env)],
    server: { port: 5173, host: true },
  }
})
