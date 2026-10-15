export class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const text = (maxLength = 200) => ({ type: 'string', minLength: 1, maxLength })
const enumeration = values => ({ type: 'string', enum: values })
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
const boolean = { type: 'boolean' }
const mind = { mind: text() }
const ids = { type: 'array', items: text(), minItems: 1, maxItems: 50 }
const catalog = { search: text(), max: integer(1, 200), sort: enumeration(['equipped', 'name', 'newest']) }
const apps = { ...catalog, tier: enumeration(['wild', 'verified']), provider: text() }
const attachment = { type: 'object', properties: { url: { type: 'string', pattern: '^https://', maxLength: 4096 }, fileName: text(), mimeType: text(), extension: text(20), content: text(500000) }, required: ['fileName', 'mimeType'], additionalProperties: false }
const definitions = []
function define(name, command, description, properties = {}, required = [], options = {}) {
  definitions.push({ name, command: command.split(' '), description, properties, required, ...options })
}
define('minds_doctor', 'doctor', 'Check CLI connectivity and account configuration.', {}, [], { public: true })
define('minds_list', 'list', 'List Minds belonging to the Builder API key account.')
define('mind_show', 'mind show', 'Read full Mind details.', mind, ['mind'])
define('mind_check_name', 'mind check-name', 'Check a proposed Mind name.', { name: text() }, ['name'], { public: true })
define('mind_awaken', 'mind awaken', 'Create a Mind. Obtain user authorization for its name and archetype before calling.', { name: text(), id: text() }, ['name', 'id'], { mutation: true })
for (const verb of ['enable', 'disable']) define(`mind_${verb}`, `mind ${verb}`, `${verb === 'enable' ? 'Enable' : 'Disable'} a selected Mind. Changes its status.`, mind, ['mind'], { mutation: true })
define('cognition_balance', 'cognition balance', 'Read the remaining cognition balance.', mind, ['mind'])
define('usage_show', 'usage show', 'Read cognition usage over time.', { ...mind, interval: enumeration(['1m', '5m', '15m', '1h', '1d', '1w', '1M']) }, ['mind'])
define('usage_by_tool', 'usage by-tool', 'Read cognition usage by tool.', { ...mind, interval: enumeration(['hour', 'day', 'week', 'month']) }, ['mind'])
define('circle_list', 'circle list', 'List circles across account Minds.')
define('circle_show', 'circle show', 'Read a Mind circle.', mind, ['mind'])
for (const verb of ['add', 'remove']) define(`circle_${verb}`, `circle ${verb}`, `${verb === 'add' ? 'Add' : 'Remove'} collaborators by email. Changes who can interact with the Mind.`, { ...mind, email: { type: 'array', items: text(320), minItems: 1, maxItems: 50 }, ...(verb === 'remove' ? { dry_run: boolean } : {}) }, ['mind', 'email'], { mutation: true, destructive: verb === 'remove' })
define('bazaar_search', 'bazaar search', 'Search public Bazaar skills and apps; result has separate skills/apps collections.', { query: text(), max: apps.max, sort: apps.sort, tier: apps.tier, provider: apps.provider }, ['query'], { public: true, positional: ['query'] })
for (const kind of ['skills', 'apps']) {
  define(`bazaar_${kind}_list`, `bazaar ${kind} list`, `Browse or search public Bazaar ${kind}. Platform equippedCount is popularity, not your equipped set.`, kind === 'apps' ? apps : catalog, [], { public: true })
  define(`bazaar_${kind}_show`, `bazaar ${kind} show`, `Read public Bazaar ${kind} detail.`, { id: text() }, ['id'], { public: true, positional: ['id'] })
  define(`mind_${kind}_list`, `mind ${kind} list`, `List ${kind} equipped on a selected Mind.`, mind, ['mind'])
  for (const verb of ['equip', 'unequip']) define(`mind_${kind}_${verb}`, `mind ${kind} ${verb}`, `${verb === 'equip' ? 'Equip' : 'Unequip'} selected ${kind}. Obtain authorization for these capability changes.`, { ...mind, id: ids }, ['mind', 'id'], { mutation: true, destructive: verb === 'unequip' })
}
define('chat_list', 'chat list', 'List conversations visible to the Builder account.')
define('chat_show', 'chat show', 'Read the selected conversation; optionally include history.', { alias: text(), history_limit: integer(1, 200) }, ['alias'], { positional: ['alias'] })
define('chat_create', 'chat create', 'Create or ensure a conversation alias for a Mind. Existing aliases resolve to their existing conversation; verify the returned Mind.', { ...mind, alias: { ...text(), pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]*$' } }, ['mind', 'alias'], { mutation: true })
define('chat_send', 'send', 'Send authorized text/attachments to a selected alias. Saves content and may consume cognition. Never automatically retry an uncertain delivery; inspect history.', { alias: text(), text: text(8000), wait: boolean, timeout: integer(1000, 60000), attachments: { type: 'array', items: attachment, minItems: 1, maxItems: 6 } }, ['alias', 'text'], { mutation: true, positional: ['alias', 'text'] })
define('chat_history', 'history', 'Read newest-first conversation history; paginate with the oldest returned fingerprint.', { alias: text(), limit: integer(1, 200), cursor: text() }, ['alias'], { positional: ['alias'] })
define('chat_events', 'events', 'Read a bounded sample of events as structured items. Not an indefinite subscription.', { alias: text(), timeout: integer(1000, 10000), max_events: integer(1, 100) }, [], { positional: ['alias'], events: true })
define('minds_help', '--help', 'Read installed CLI help, including available archetypes. Help is the installed command contract.', { tool: enumeration(definitions.map(item => item.name)) }, [], { public: true, help: true })
export const commands = definitions
export const tools = commands.map(({ name, description, properties, required, mutation, destructive }) => ({
  name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: !mutation, destructiveHint: Boolean(destructive), idempotentHint: !mutation, openWorldHint: true },
}))
function validateValue(value, rule, path) {
  let valid = true
  if (rule.type === 'string') valid = typeof value === 'string' && value.trim().length > 0 && value.length <= (rule.maxLength ?? 200) && !value.includes('\0') && (!rule.enum || rule.enum.includes(value)) && (!rule.pattern || new RegExp(rule.pattern).test(value))
  if (rule.type === 'boolean') valid = typeof value === 'boolean'
  if (rule.type === 'integer') valid = Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum
  if (rule.type === 'array') {
    valid = Array.isArray(value) && value.length >= rule.minItems && value.length <= rule.maxItems
    if (valid) value.forEach((entry, index) => validateValue(entry, rule.items, `${path}[${index}]`))
  }
  if (rule.type === 'object') {
    valid = value && typeof value === 'object' && !Array.isArray(value)
    if (valid) {
      for (const key of rule.required ?? []) if (!(key in value)) throw new ToolError('BAD_INPUT', `Missing ${path}.${key}.`)
      for (const [key, entry] of Object.entries(value)) {
        if (!Object.hasOwn(rule.properties, key)) throw new ToolError('BAD_INPUT', `Unexpected argument ${path}.${key}.`)
        validateValue(entry, rule.properties[key], `${path}.${key}`)
      }
    }
  }
  if (!valid) throw new ToolError('BAD_INPUT', `Invalid ${path}.`)
}
export function compile(name, args) {
  const command = commands.find(item => item.name === name)
  if (!command) throw new ToolError('UNKNOWN_TOOL', 'Unknown Minds CLI tool.')
  validateValue(args, { type: 'object', properties: command.properties, required: command.required }, 'arguments')
  if (command.help) return { command, argv: args.tool ? [...commands.find(item => item.name === args.tool).command, '--help'] : ['--help'] }
  const argv = [...command.command]
  for (const [key, value] of Object.entries(args)) {
    if (command.positional?.includes(key) || key === 'attachments') continue
    const flag = `--${key.replaceAll('_', '-')}`
    if (value === true) argv.push(flag)
    else if (value !== false) for (const entry of Array.isArray(value) ? value : [value]) argv.push(flag, String(entry))
  }
  if (command.name === 'chat_send' && args.wait && !args.timeout) argv.push('--timeout', '30000')
  if (command.events) {
    if (!args.timeout) argv.push('--timeout', '5000')
    if (!args.max_events) argv.push('--max-events', '20')
  }
  // End option parsing before user positional values, including text beginning with '-'.
  const positions = (command.positional ?? []).filter(key => args[key] !== undefined).map(key => args[key])
  if (positions.length) argv.push('--', ...positions)
  return { command, argv }
}
