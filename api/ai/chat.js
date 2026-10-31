import { normalizeEnv } from '../../server/ai-core.mjs'
import { createNodeHandler } from '../../server/ai-node.mjs'

const handler = createNodeHandler(normalizeEnv(process.env))

export default handler
