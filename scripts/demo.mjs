import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

const children = []
let shuttingDown = false

const shutdown = (code = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  setTimeout(() => process.exit(code), 300)
}

const launch = (label, args) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' })
  child.on('error', (error) => {
    console.error(`[demo] ${label} failed to start: ${error.message}`)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.log(`[demo] ${label} stopped${signal ? ` (${signal})` : ''}.`)
    shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

console.log('')
console.log('  Aegis Sentinel live capture demo')
console.log('  Decoy portal   http://localhost:4300')
console.log('  Dashboard      http://localhost:5173/app')
console.log('  Failures       http://localhost:5173/app/anomalies')
console.log('  Live dataset   http://localhost:5173/app/uploads')
console.log('')
console.log('  Try a wrong password five times, then sign in with a demo credential.')
console.log('  Ctrl+C stops both processes.')
console.log('')

launch('Portal', [path.join(root, 'portal', 'server.mjs')])
launch('Vite', [viteBin])

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
