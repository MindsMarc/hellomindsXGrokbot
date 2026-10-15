import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile, ToolError } from './tools.mjs'

export const cliVersion = '0.1.4'
const maxOutput = 1024 * 1024
export function createRunner({ env = process.env, spawnImpl = spawn } = {}) {
  const keyValue = env.MINDS_BUILDER_API_KEY?.trim()
  // Unconfigured host variables can arrive literally as ${VARIABLE}.
  const key = keyValue && !keyValue.startsWith('${') ? keyValue : undefined
  const clean = value => {
    if (typeof value === 'string') return key ? value.replaceAll(key, '[REDACTED]') : value
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, /^(authorization|access.?token|refresh.?token|api.?key|builder.?api.?key)$/i.test(name) ? '[REDACTED]' : clean(entry)]))
    return value
  }
  return async function run(name, args) {
    const { command, argv } = compile(name, args)
    if (!command.public && !key) throw new ToolError('AUTH_REQUIRED', 'Set MINDS_BUILDER_API_KEY through the secure plugin configuration, then restart the MCP server. Never paste the key in chat.')
    const cwd = await mkdtemp(join(tmpdir(), 'hellominds-cli-'))
    try {
      if (args.attachments) {
        for (const item of args.attachments) {
          if (Boolean(item.url) === Boolean(item.content)) throw new ToolError('BAD_INPUT', 'Each attachment requires exactly one of url or base64 content.')
          if (item.url) {
            let url
            try { url = new URL(item.url) } catch { throw new ToolError('BAD_INPUT', 'Invalid attachment URL.') }
            if (url.protocol !== 'https:' || url.username || url.password) throw new ToolError('BAD_INPUT', 'Attachment URLs must be HTTPS without credentials.')
          } else if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.content)) throw new ToolError('BAD_INPUT', 'Attachment content must be base64.')
        }
        const file = join(cwd, 'attachments.json')
        await writeFile(file, JSON.stringify(args.attachments), { mode: 0o600 })
        const separator = argv.indexOf('--')
        argv.splice(separator < 0 ? argv.length : separator, 0, '--attachments', file)
      }
      // Deliberately exclude NODE_OPTIONS, legacy credentials, and project .env files.
      const childEnv = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'SSL_CERT_FILE', 'SSL_CERT_DIR'].filter(name => env[name]).map(name => [name, env[name]]))
      Object.assign(childEnv, { NO_COLOR: '1', npm_config_update_notifier: 'false', npm_config_ignore_scripts: 'true' })
      if (key) childEnv.MINDS_BUILDER_API_KEY = key
      const executable = env.MINDS_CLI_BIN || (process.platform === 'win32' ? 'npx.cmd' : 'npx')
      if (process.platform === 'win32' && !env.MINDS_CLI_BIN) throw new ToolError('CLI_SETUP_REQUIRED', 'On Windows configure MINDS_CLI_BIN to a native executable launcher; shell execution is disabled.')
      const prefix = env.MINDS_CLI_BIN ? [] : ['--yes', '--package', `@animocabrands/minds-cli@${cliVersion}`, 'minds']
      const timeout = command.events ? (args.timeout ?? 5000) + 15000 : command.name === 'chat_send' && args.wait ? (args.timeout ?? 30000) + 15000 : 60000
      const response = await new Promise(resolve => {
        let child
        try { child = spawnImpl(executable, [...prefix, ...argv], { shell: false, detached: process.platform !== 'win32', cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }) }
        catch { resolve({ error: 'CLI_UNAVAILABLE' }); return }
        let bytes = 0, issue, settled = false
        const output = [], diagnostic = []
        const stop = () => {
          // npx can have a CLI child: terminate the process group, not only the launcher.
          try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL') }
          catch { child.kill('SIGKILL') }
        }
        const timer = setTimeout(() => { issue = 'CLI_TIMEOUT'; stop() }, timeout)
        const finish = data => {
          if (settled) return
          settled = true; clearTimeout(timer)
          resolve({ ...data, error: issue ?? data.error, stdout: Buffer.concat(output).toString('utf8'), stderr: Buffer.concat(diagnostic).toString('utf8') })
        }
        const collect = target => chunk => {
          bytes += chunk.length
          if (bytes > maxOutput) { issue = 'OUTPUT_LIMIT'; stop(); return }
          target.push(Buffer.from(chunk))
        }
        child.stdout.on('data', collect(output)); child.stderr.on('data', collect(diagnostic))
        child.on('error', () => finish({ error: 'CLI_UNAVAILABLE' }))
        child.on('close', code => finish({ code }))
      })
      if (response.error) return {
        ok: false, code: response.error,
        message: response.error === 'CLI_UNAVAILABLE' ? 'The Minds CLI launcher is unavailable. Check Node/npm or MINDS_CLI_BIN.' : 'The CLI did not finish within the permitted time or output budget.',
        ...(command.mutation && response.error !== 'CLI_UNAVAILABLE' ? { delivery: 'unknown', recovery: 'Inspect the affected resource or chat history before considering another mutation. No retry was performed.' } : {}),
      }
      if (command.help) return { ok: response.code === 0, source: 'minds-cli', cli_version: cliVersion, help: clean(response.stdout).slice(0, 50000) }
      let data
      try {
        data = command.events ? { items: response.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)) } : JSON.parse(response.stdout)
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
      } catch {
        return { ok: false, code: 'INVALID_CLI_OUTPUT', message: 'The CLI did not return the expected JSON.', ...(command.mutation ? { delivery: 'unknown', recovery: 'Inspect the affected resource before retrying.' } : {}) }
      }
      // doctor prints a key suffix in its successful diagnostic: remove it, too.
      if (command.name === 'minds_doctor' && Array.isArray(data.checks)) data.checks = data.checks.map(check => check.name === 'builder_api_key' ? { name: check.name, ok: check.ok, message: check.ok ? 'Builder API key configured.' : 'Builder API key missing.' } : check)
      return {
        ok: response.code === 0 && data.ok !== false, source: 'minds-cli', cli_version: cliVersion, data: clean(data),
        ...(response.stderr.trim() ? { diagnostics: clean(response.stderr).slice(0, 4096) } : {}),
        ...(command.mutation && response.code !== 0 ? { delivery: 'unknown', recovery: 'Inspect the affected resource or chat history. The operation may have been accepted. No retry was performed.' } : {}),
      }
    } finally { await rm(cwd, { recursive: true, force: true }) }
  }
}
