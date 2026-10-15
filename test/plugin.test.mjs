import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { compile, commands, tools } from '../server/tools.mjs'
import { createRunner } from '../server/runner.mjs'
import { createProtocol } from '../server/protocol.mjs'

const fixture = fileURLToPath(new URL('./fixture-cli.mjs', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))
function runner(key = 'fixture-secret-api-key') {
  return createRunner({ env: { PATH: process.env.PATH, HOME: process.env.HOME, MINDS_BUILDER_API_KEY: key, NODE_OPTIONS: '--require untrusted.js' }, spawnImpl: (_bin, argv, options) => spawn(process.execPath, [fixture, ...argv.slice(4)], options) })
}
const rejection = (fn, code) => assert.rejects(fn, error => error.code === code)

test('every published command has a typed mapping; mutation annotations are honest', () => {
  assert.equal(new Set(tools.map(item => item.name)).size, tools.length)
  for (const command of commands) {
    const tool = tools.find(item => item.name === command.name)
    assert.equal(tool.inputSchema.additionalProperties, false)
    assert.equal(tool.annotations.readOnlyHint, !command.mutation)
  }
  assert.equal(tools.find(item => item.name === 'circle_remove').annotations.destructiveHint, true)
})

test('typed arguments compile to literal argv with protected positional values', () => {
  const sent = compile('chat_send', { alias: 'main', text: '--builder-api-key nope; $(touch /tmp/owned)', wait: true })
  assert.deepEqual(sent.argv, ['send', '--wait', '--timeout', '30000', '--', 'main', '--builder-api-key nope; $(touch /tmp/owned)'])
  assert.deepEqual(compile('circle_add', { mind: 'mind-1', email: ['a@example.com', 'b@example.com'] }).argv, ['circle', 'add', '--mind', 'mind-1', '--email', 'a@example.com', '--email', 'b@example.com'])
  assert.deepEqual(compile('circle_remove', { mind: 'mind-1', email: ['a@example.com'], dry_run: true }).argv.slice(-1), ['--dry-run'])
  assert.deepEqual(compile('mind_skills_equip', { mind: 'mind-1', id: ['one', 'two'] }).argv.slice(-4), ['--id', 'one', '--id', 'two'])
  assert.deepEqual(compile('minds_help', { tool: 'mind_awaken' }).argv, ['mind', 'awaken', '--help'])
  assert.deepEqual(compile('chat_events', {}).argv, ['events', '--timeout', '5000', '--max-events', '20'])
})

test('invalid commands, flags, intervals, limits and credential arguments are rejected', () => {
  const invalid = [
    ['arbitrary_shell', {}], ['minds_list', { human_id: 'other' }], ['minds_list', { builder_api_key: 'secret' }],
    ['usage_show', { mind: 'mind', interval: 'day' }], ['usage_by_tool', { mind: 'mind', interval: '1d' }],
    ['chat_history', { alias: 'main', limit: 201 }], ['chat_send', { alias: 'main', text: 'x', timeout: 60001 }],
    ['circle_add', { mind: 'mind', email: [] }], ['mind_awaken', { name: 'Nova' }],
    ['chat_create', { mind: 'mind', alias: '--flag' }], ['minds_list', null], ['minds_list', { toString: 'x' }],
    ['mind_show', { mind: 'x\0y' }],
    ['bazaar_search', { query: 'notion', search: 'unsupported-flag' }],
  ]
  for (const [name, args] of invalid) assert.throws(() => compile(name, args))
})

test('runner passes secrets only in environment, strips inherited code options, redacts output and cleans temporary files', async () => {
  const run = runner()
  const result = await run('chat_send', { alias: 'main', text: 'hello; $(touch /tmp/owned)' })
  assert.equal(result.ok, true)
  assert.equal(result.data.credential_configured, true)
  assert.equal(result.data.node_options, null)
  assert.equal(result.data.leak_test, '[REDACTED]')
  assert.equal(result.data.apiKey, '[REDACTED]')
  assert.equal(JSON.stringify(result).includes('fixture-secret-api-key'), false)
  assert.equal(result.data.args.includes('fixture-secret-api-key'), false)
  assert.equal(result.data.args.at(-1), 'hello; $(touch /tmp/owned)')
  assert.equal(existsSync(result.data.cwd), false)
  const doctor = await run('minds_doctor', {})
  assert.equal(doctor.data.checks[0].message, 'Builder API key configured.')
})

test('public tools work without credentials; account tools fail before process execution', async () => {
  const run = runner(undefined)
  // Explicit empty value overrides the helper's default.
  const publicRun = runner('')
  assert.equal((await publicRun('bazaar_search', { query: 'notion' })).ok, true)
  assert.equal((await publicRun('minds_help', {})).ok, true)
  await rejection(() => publicRun('minds_list', {}), 'AUTH_REQUIRED')
  await rejection(() => runner('${MINDS_BUILDER_API_KEY}')('minds_list', {}), 'AUTH_REQUIRED')
  assert.equal((await run('minds_help', {})).ok, true)
})

test('attachments use generated private paths, validate shape, and never accept caller file paths', async () => {
  const run = runner()
  const result = await run('chat_send', { alias: 'main', text: 'see file', attachments: [{ url: 'https://example.com/file.pdf', fileName: 'file.pdf', mimeType: 'application/pdf' }] })
  const index = result.data.args.indexOf('--attachments')
  assert.ok(index > 0)
  assert.equal(existsSync(result.data.args[index + 1]), false)
  await rejection(() => run('chat_send', { alias: 'main', text: 'x', attachments: [{ path: '/etc/passwd', fileName: 'x', mimeType: 'x' }] }), 'BAD_INPUT')
  await rejection(() => run('chat_send', { alias: 'main', text: 'x', attachments: [{ url: 'https://user:password@example.com/file', fileName: 'x', mimeType: 'x' }] }), 'BAD_INPUT')
  await rejection(() => run('chat_send', { alias: 'main', text: 'x', attachments: [{ content: 'not base64', fileName: 'x', mimeType: 'x' }] }), 'BAD_INPUT')
})

test('events are parsed as NDJSON, and uncertain mutations are never retried', async () => {
  const run = runner()
  assert.equal((await run('chat_events', { alias: 'main' })).data.items.length, 2)
  const timeout = await run('chat_send', { alias: 'main', text: 'uncertain', wait: true })
  assert.equal(timeout.ok, false)
  assert.equal(timeout.delivery, 'unknown')
  assert.match(timeout.recovery, /No retry/)
  const invalid = await run('chat_send', { alias: 'main', text: 'invalid-json' })
  assert.equal(invalid.code, 'INVALID_CLI_OUTPUT')
  assert.equal(invalid.delivery, 'unknown')
})

test('MCP lifecycle, discovery, validation, tool errors and results', async () => {
  const protocol = createProtocol(runner())
  const request = (id, method, params) => protocol({ jsonrpc: '2.0', id, method, params })
  assert.equal((await request(0, 'tools/list')).error.code, -32000)
  const init = await request(1, 'initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'test' }, capabilities: {} })
  assert.equal(init.result.protocolVersion, '2025-11-25')
  assert.equal(await protocol({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
  assert.equal((await request(2, 'tools/list')).result.tools.length, tools.length)
  const result = await request(3, 'tools/call', { name: 'chat_send', arguments: { alias: 'main', text: 'hello' } })
  assert.equal(result.result.isError, false)
  assert.equal(result.result.structuredContent.source, 'minds-cli')
  const invalid = await request(4, 'tools/call', { name: 'minds_list', arguments: { human_id: 'other' } })
  assert.equal(invalid.result.isError, true)
  assert.equal((await request(5, 'tools/call', { name: 'arbitrary_shell' })).error.code, -32602)
  assert.equal((await protocol([])).error.code, -32600)
})

test('real stdio subprocess emits only newline-delimited MCP JSON', async () => {
  const child = spawn(process.execPath, [joinPath('server/stdio.mjs')], { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', diagnostic = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { diagnostic += chunk })
  child.stdin.end([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'test' }, capabilities: {} } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'minds_list', arguments: {} } }),
    '{invalid json',
  ].join('\n') + '\n')
  const [code] = await once(child, 'close')
  assert.equal(code, 0)
  assert.equal(diagnostic, '')
  const rows = output.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(rows.length, 4)
  assert.equal(rows[1].result.tools.length, tools.length)
  assert.equal(rows[2].result.structuredContent.code, 'AUTH_REQUIRED')
  assert.equal(rows[3].error.code, -32700)
})
function joinPath(path) { return fileURLToPath(new URL(path, new URL('../', import.meta.url))) }

test('package manifest, secret variable and MCP executable paths agree', () => {
  const manifest = JSON.parse(readFileSync(`${root}.cursor-plugin/plugin.json`))
  const mcp = JSON.parse(readFileSync(`${root}mcp.json`)).mcpServers.hellominds
  assert.equal(manifest.name, 'hellominds')
  assert.ok(manifest.variables.properties.MINDS_BUILDER_API_KEY)
  assert.equal(mcp.env.MINDS_BUILDER_API_KEY, '${MINDS_BUILDER_API_KEY}')
  assert.ok(existsSync(mcp.args[0].replace('${CURSOR_PLUGIN_ROOT}', root)))
  assert.ok(existsSync(`${root}${manifest.logo}`))
})
