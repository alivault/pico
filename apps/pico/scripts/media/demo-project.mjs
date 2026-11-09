/**
 * The demo project of the website media: `tiny-tasks`, a small task list
 * for the terminal. It is a Git repository with one bug: `daysUntilDue`
 * subtracts the dates the wrong way round, so `tasks list --overdue` shows
 * nothing. Its tests pass, because no test covers the filters yet.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const FILES = {
  "package.json": `{
  "name": "tiny-tasks",
  "version": "0.3.0",
  "type": "module",
  "description": "A small task list for the terminal",
  "bin": { "tasks": "./src/cli.js" },
  "scripts": { "test": "node --test" }
}
`,
  "README.md": `# tiny-tasks

A small task list for the terminal.

\`\`\`sh
tasks add "Ship the release" --due 2026-11-01
tasks list --overdue
tasks done 3
\`\`\`
`,
  "src/store.js": `import { readFileSync, writeFileSync, existsSync } from "node:fs"

export function loadTasks(path) {
  if (!existsSync(path)) return []
  return JSON.parse(readFileSync(path, "utf8"))
}

export function saveTasks(path, tasks) {
  writeFileSync(path, JSON.stringify(tasks, null, 2) + "\\n")
}

export function addTask(tasks, title, due) {
  const id = tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1
  return [...tasks, { id, title, due: due ?? null, done: false }]
}

export function completeTask(tasks, id) {
  return tasks.map((task) => (task.id === id ? { ...task, done: true } : task))
}
`,
  "src/filters.js": `/** Days from \`today\` to the due date of a task. */
export function daysUntilDue(task, today) {
  const due = new Date(\`\${task.due}T00:00:00\`)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((start - due) / 86_400_000)
}

/** Open tasks with a due date before today. */
export function overdueTasks(tasks, today = new Date()) {
  return tasks.filter(
    (task) => !task.done && task.due && daysUntilDue(task, today) < 0
  )
}

/** Open tasks due in the next \`days\` days, today included. */
export function upcomingTasks(tasks, days = 7, today = new Date()) {
  return tasks.filter((task) => {
    if (task.done || !task.due) return false
    const left = daysUntilDue(task, today)
    return left >= 0 && left <= days
  })
}
`,
  "src/format.js": `import { daysUntilDue } from "./filters.js"

export function formatTask(task, today = new Date()) {
  const box = task.done ? "[x]" : "[ ]"
  if (!task.due || task.done) return \`\${box} \${task.id}. \${task.title}\`
  const left = daysUntilDue(task, today)
  const when =
    left < 0 ? \`\${-left}d overdue\` : left === 0 ? "due today" : \`due in \${left}d\`
  return \`\${box} \${task.id}. \${task.title} (\${when})\`
}
`,
  "src/cli.js": `#!/usr/bin/env node
import { homedir } from "node:os"
import { join } from "node:path"
import { addTask, completeTask, loadTasks, saveTasks } from "./store.js"
import { overdueTasks, upcomingTasks } from "./filters.js"
import { formatTask } from "./format.js"

const file = process.env.TASKS_FILE ?? join(homedir(), ".tasks.json")
const [command, ...args] = process.argv.slice(2)
let tasks = loadTasks(file)

if (command === "add") {
  const dueIndex = args.indexOf("--due")
  const due = dueIndex === -1 ? undefined : args[dueIndex + 1]
  tasks = addTask(tasks, args[0], due)
  saveTasks(file, tasks)
} else if (command === "done") {
  tasks = completeTask(tasks, Number(args[0]))
  saveTasks(file, tasks)
} else {
  const shown = args.includes("--overdue")
    ? overdueTasks(tasks)
    : args.includes("--upcoming")
      ? upcomingTasks(tasks)
      : tasks
  for (const task of shown) console.log(formatTask(task))
}
`,
  "test/store.test.js": `import { test } from "node:test"
import assert from "node:assert/strict"
import { addTask, completeTask } from "../src/store.js"

test("addTask gives each task the next id", () => {
  const tasks = addTask(addTask([], "Pay rent", "2026-10-18"), "Ship it")
  assert.deepEqual(
    tasks.map((task) => [task.id, task.title, task.due]),
    [
      [1, "Pay rent", "2026-10-18"],
      [2, "Ship it", null],
    ]
  )
})

test("completeTask marks only that task as done", () => {
  const tasks = completeTask(addTask(addTask([], "A"), "B"), 2)
  assert.deepEqual(
    tasks.map((task) => task.done),
    [false, true]
  )
})
`,
}

/** Make the demo project in `dir`, a new Git repository. */
export function createDemoProject(dir) {
  rmSync(dir, { recursive: true, force: true })
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(join(dir, path, ".."), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=Ali", "-c", "user.email=ali@example.com", ...args],
      { cwd: dir, stdio: "ignore" }
    )
  git("init", "-q", "-b", "main")
  git("add", "-A")
  git("commit", "-qm", "Add overdue and upcoming filters")
}
