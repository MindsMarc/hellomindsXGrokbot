// Offline child-process fixture: never contacts HelloMinds.
const args = process.argv.slice(2)
const key = process.env.MINDS_BUILDER_API_KEY
if (args.includes('--help')) {
  console.log('fixture Minds CLI help'); process.exit(0)
}
if (args.includes('invalid-json')) {
  console.log('not JSON'); process.exit(0)
}
if (args.includes('uncertain')) {
  console.log(JSON.stringify({ ok: false, error: { message: 'Reply timed out' } })); process.exit(3)
}
if (args[0] === 'events') {
  console.log(JSON.stringify({ type: 'message', alias: 'main' }))
  console.log(JSON.stringify({ type: 'message', alias: 'main' })); process.exit(0)
}
if (args[0] === 'doctor') {
  console.log(JSON.stringify({ ok: true, checks: [{ name: 'builder_api_key', ok: true, message: `key suffix ${key?.slice(-4)}` }] })); process.exit(0)
}
console.log(JSON.stringify({ ok: true, args, credential_configured: Boolean(key), leak_test: key, apiKey: key, node_options: process.env.NODE_OPTIONS ?? null, cwd: process.cwd() }))
