import { tools, ToolError } from './tools.mjs'
const versions = ['2025-11-25', '2025-06-18', '2025-03-26']
export function createProtocol(run) {
  let initialized = false
  const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
  return async request => {
    if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || ('id' in request && !(typeof request.id === 'string' || typeof request.id === 'number'))) return error(null, -32600, 'Invalid request.')
    const { id, method, params = {} } = request
    if (id === undefined) return undefined
    if (method === 'initialize') {
      if (!params || !versions.includes(params.protocolVersion) || !params.clientInfo || typeof params.clientInfo.name !== 'string' || !params.capabilities || typeof params.capabilities !== 'object') return error(id, -32602, 'Unsupported version or invalid initialization parameters.')
      initialized = true
      return { jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'hellominds-cli', version: '0.1.0' }, instructions: 'Minds CLI tools use your configured Builder API key. Authorize mutations with the user. Never retry uncertain mutations automatically. History is newest-first; attribute Mind replies. Keys belong in secure configuration, not chat.' } }
    }
    if (!initialized) return error(id, -32000, 'Initialize the MCP connection first.')
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } }
    if (method !== 'tools/call') return error(id, -32601, 'Method not found.')
    if (!params || typeof params.name !== 'string' || !tools.some(tool => tool.name === params.name)) return error(id, -32602, 'Unknown tool.')
    let data
    try { data = await run(params.name, params.arguments ?? {}) }
    catch (failure) { data = { ok: false, code: failure instanceof ToolError ? failure.code : 'INTERNAL_ERROR', message: failure instanceof ToolError ? failure.message : 'The CLI operation could not be completed.' } }
    return { jsonrpc: '2.0', id, result: { isError: data.ok === false, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } }
  }
}
