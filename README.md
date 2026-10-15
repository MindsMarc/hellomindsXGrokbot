# HelloMinds plugin for Grok Bot

Expose the [Minds CLI](https://build.hellominds.ai/en/docs/get-started/cli) as typed MCP tools plus usage guidance. This package uses the real CLI, not browser cookies, a simulated Mind, or a custom OAuth gateway.

## Requirements

- Node.js 22+ with npm/npx on the host running the MCP server.
- A Builder API key for private account operations, configured securely in the host as `MINDS_BUILDER_API_KEY`.
- Network access to npm (first CLI execution) and HelloMinds Builder services.

The wrapper invokes `@animocabrands/minds-cli@0.1.4` through npx. npm caches the package outside this repository; install scripts are disabled. The plugin itself adds no dependencies or lockfile changes. To use an already installed CLI instead, set `MINDS_CLI_BIN` to its executable path in the server environment. Its command contract must match version 0.1.4. Windows requires a native executable launcher through that setting because shell execution is disabled.

The key's existing Builder permissions govern all commands. This is a local stdio server for one host/account, not a public multi-user server. Every Bot with access to the configured plugin may be able to use that credential. Revoking the Builder key stops future authorized API calls; it does not delete conversations or reverse mutations.

## Install in the host

This is a Cursor-format plugin directory, using `.cursor-plugin/plugin.json`, `mcp.json`, and `skills/minds-cli/SKILL.md`. The server path uses the documented `${CURSOR_PLUGIN_ROOT}` expansion. Grok Bot marketplace installation and secret-variable UX still require in-app validation.

For local Cursor-format plugin development, copy this entire directory into `~/.cursor/plugins/local/hellominds`, reload the host, and configure the Builder key in the secure plugin settings. Local plugin imports may require a team policy setting. Do not put the key into this repository or normal chat.

Alternatively, register a custom stdio MCP server in a compatible host. For a standalone checkout the configuration is:

```json
{
  "mcpServers": {
    "hellominds": {
      "command": "node",
      "args": ["/path/to/hellominds-plugin/server/stdio.mjs"]
    }
  }
}
```

Use your host's secure environment configuration to supply `MINDS_BUILDER_API_KEY` to that process. Replace `/path/to/hellominds-plugin` with the absolute path to your cloned or installed plugin directory. A custom MCP-only registration provides tools; install the accompanying usage skill through the host if desired.

Public Bazaar, name checks, and help work without an account key. Account tools fail clearly when the key is missing. The wrapper runs each CLI command in a fresh temporary directory, so a repository `.env` file is not implicitly consumed.

## Tools

| Group | MCP tools |
| --- | --- |
| Diagnostics | `minds_help`, `minds_doctor` |
| Minds | `minds_list`, `mind_show`, `mind_check_name`, `mind_awaken`, `mind_enable`, `mind_disable` |
| Cognition | `cognition_balance`, `usage_show`, `usage_by_tool` |
| Circles | `circle_list`, `circle_show`, `circle_add`, `circle_remove` |
| Bazaar | `bazaar_search`, `bazaar_skills_list`, `bazaar_skills_show`, `bazaar_apps_list`, `bazaar_apps_show` |
| Equipped capabilities | `mind_skills_list`, `mind_skills_equip`, `mind_skills_unequip`, `mind_apps_list`, `mind_apps_equip`, `mind_apps_unequip` |
| Conversations | `chat_list`, `chat_show`, `chat_create`, `chat_send`, `chat_history`, `chat_events` |

MCP discovery returns the input schema for every tool. Inputs map directly to documented CLI flags: `mind`, `name`, `id`, `alias`, `interval`, and so on. Repeated emails and IDs are arrays. Use `minds_help` with a tool name for installed CLI help.

`chat_send` accepts optional `wait`, `timeout` (milliseconds, at most 60,000), and attachments. If `wait` is true without a timeout, the wrapper uses 30,000 ms. Attachment objects accept exactly one of a credential-free HTTPS `url` or base64 `content`, plus `fileName`, `mimeType`, and optional `extension`. Local file paths are deliberately not exposed; temporary attachment JSON is written with private permissions and removed after execution.

`chat_events` returns an NDJSON event sample as `data.items`, bounded to 10 seconds and 100 events. Default: five seconds or 20 events. This is not an ongoing subscription. Other output is the CLI's JSON object in `data`. stderr diagnostics are separate. `minds_help` returns `help` text.

## Example prompts

- “List my Minds and show details for Nova.”
- “Create a conversation for Nova with alias `grok-nova`, then ask it to help prepare my presentation.”
- “Read the latest replies from `grok-nova`.”
- “How much cognition did Nova use in the last week, and what is its balance?”
- “Search Bazaar for Notion apps and show the first app's tools.”
- “Preview removing this email from Nova's Circle.”

Use the real IDs and aliases returned by the API. Existing chat aliases can already point to another Mind; inspect the returned conversation before sending.

## Execution and error semantics

Commands run as argument arrays with `shell: false`. Tool callers cannot supply arbitrary command strings, authentication flags, a human-ID override, or executable paths. Credentials are injected through the subprocess environment and redacted from returned data; the diagnostic key suffix printed by `doctor` is removed too. The wrapper does not log message content or secrets.

Commands are serialized per MCP process, with bounded output and runtime. Separate host processes are not serialized against each other. Public CLI output and Mind output remain untrusted content.

There is no automatic retry or invented exactly-once guarantee. When a mutating process times out, exceeds output limits, returns invalid JSON, or exits unsuccessfully, the tool marks delivery uncertain where applicable. Inspect history/current state before deciding whether another mutation is necessary. A wait timeout may happen after the message was sent. CLI history/wait semantics do not establish a stronger reply-correlation guarantee than the upstream implementation provides.

## Verification

Run from the repository root:

```sh
node --test test/*.test.mjs
```

Tests exercise argument compilation, secret handling, attachment cleanup, events, error recovery, and MCP initialization/discovery/calls over a real stdio subprocess. Authenticated API operations use an offline child-process fixture in the automated suite. These tests are not evidence of live account access.

On 15 October 2026, all 10 automated tests and usage-skill validation passed. Separate smoke checks invoked the published CLI through this wrapper without credentials: root help succeeded and a Bazaar app search for Notion returned one real catalogue item. No authenticated command or Grok Bot installation was tested.

Before marketplace submission, install in Grok Bot and test with an authorized disposable account: configure the key, list Minds, select an existing Mind, create/inspect an alias, send once, receive a real reply, inspect usage, and revoke the key. Exercise management mutations only when explicitly authorized. Record exact versions and outcomes. Do not attest that local and in-app testing passed until both have evidence.

## Publishing

Not published or installed by this work. For marketplace submission, this repository must be public. A publisher also needs a hosted square logo URL, contact details, and in-app testing instructions/evidence. An MCP server URL is unnecessary for this local stdio implementation if submitting the public repository. Select Grok Bot on the [submission form](https://x.ai/bot/marketplace/submit-a-plugin).

Packaging references: [Cursor plugins](https://cursor.com/docs/reference/plugins) and [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio).
