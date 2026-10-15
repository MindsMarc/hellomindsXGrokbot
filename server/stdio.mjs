#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { createRunner } from './runner.mjs'
import { createProtocol } from './protocol.mjs'

const handle = createProtocol(createRunner())
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
// Serialize commands: unrelated concurrent mutations must not overlap locally.
for await (const line of lines) {
  let response
  try {
    if (Buffer.byteLength(line) > 1500000) throw new Error('Request too large')
    response = await handle(JSON.parse(line))
  } catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid or oversized JSON message.' } } }
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
}
