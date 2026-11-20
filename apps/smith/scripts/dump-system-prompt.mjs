#!/usr/bin/env node
/**
 * Write the system prompt and the tools of one conversation as a Markdown
 * file. The prompt sections and tool changes are stored as `pi.system`
 * entries in Pico's database; this script merges them in order.
 *
 * Usage: node scripts/dump-system-prompt.mjs [conversationId] [out.md]
 * Without a conversation ID, it uses the newest conversation with a prompt.
 */
import { writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

const database = join(
  process.env.PICO_DATA_DIR ?? join(homedir(), ".pico"),
  "pico.sqlite"
)
const db = new DatabaseSync(database, { readOnly: true })

const conversation =
  process.argv[2] ??
  db
    .prepare(
      "select conversation_id as id from entries where json_extract(record, '$.kind') = 'pi.system' order by id desc limit 1"
    )
    .get()?.id
if (conversation === undefined) {
  console.error("No system prompt found.")
  process.exit(1)
}
const out = process.argv[3] ?? `/tmp/pico-system-prompt-${conversation}.md`

const rows = db
  .prepare(
    "select record from entries where conversation_id = ? and json_extract(record, '$.kind') = 'pi.system' order by id"
  )
  .all(Number(conversation))

/** @type {Map<string, string>} */
const sections = new Map()
/** @type {Map<string, { name: string, description: string, parameters: unknown }>} */
const tools = new Map()
for (const row of rows) {
  for (const message of JSON.parse(String(row.record)).model ?? []) {
    for (const [key, value] of Object.entries(message.sections ?? {})) {
      if (value == null) sections.delete(key)
      else sections.set(key, value)
    }
    for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool)
    for (const name of message.toolsRemoved ?? []) tools.delete(name)
  }
}

const fence = (text, lang = "text") => `\`\`\`\`${lang}\n${text}\n\`\`\`\``
const size = (value) =>
  typeof value === "string" ? value.length : JSON.stringify(value).length
const tokens = (chars) => `~${Math.round(chars / 4)}`

const sectionChars = [...sections.values()].reduce((n, v) => n + v.length, 0)
const toolChars = [...tools.values()].reduce((n, t) => n + size(t), 0)

const lines = [
  `# System prompt of conversation ${conversation}`,
  "",
  `From ${rows.length} system entries in \`${database}\`.`,
  "",
  "| Part | Characters | Tokens |",
  "|---|---:|---:|",
  ...[...sections].map(
    ([key, value]) =>
      `| section \`${key}\` | ${value.length} | ${tokens(value.length)} |`
  ),
  ...[...tools.values()].map(
    (tool) =>
      `| tool \`${tool.name}\` | ${size(tool)} | ${tokens(size(tool))} |`
  ),
  `| **total** | **${sectionChars + toolChars}** | **${tokens(sectionChars + toolChars)}** |`,
  "",
  "## Sections",
  "",
  ...[...sections].flatMap(([key, value]) => [
    `### ${key}`,
    "",
    fence(value),
    "",
  ]),
  "## Tools",
  "",
  ...[...tools.values()].flatMap((tool) => [
    `### ${tool.name}`,
    "",
    tool.description,
    "",
    fence(JSON.stringify(tool.parameters, null, 2), "json"),
    "",
  ]),
]

writeFileSync(out, lines.join("\n"))
console.log(out)
