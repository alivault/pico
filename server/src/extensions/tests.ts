/**
 * The `tests` extension: `run_tests` runs the project's tests and returns a
 * structured result (counts and the failing tests), not a raw log.
 *
 * The runner comes from the project files: vitest, jest, pytest, go test, or
 * cargo test, with a machine-readable reporter where one exists. Any other
 * command runs as is, and the result has only its exit code and output.
 */
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"

import { clip, cwdOf, runCommand, tail } from "./util.ts"

export type TestFailure = {
  name: string
  file?: string
  line?: number
  message: string
}

export type TestReport = {
  runner: string
  command: string
  exitCode: number | null
  passed: number
  failed: number
  skipped: number
  total: number
  durationMs: number
  failures: TestFailure[]
  /** The end of the output, for errors before any test ran. */
  outputTail: string
  timedOut?: boolean
}

type Runner = "vitest" | "jest" | "pytest" | "go" | "cargo" | "command"

type Plan = {
  runner: Runner
  command: string[] | string
  /** A file the runner writes its report to. */
  reportFile?: string
}

function packageJson(cwd: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(
      readFileSync(join(cwd, "package.json"), "utf8")
    ) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function packageRunner(cwd: string) {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return ["pnpm", "exec"]
  if (existsSync(join(cwd, "yarn.lock"))) return ["yarn"]
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock")))
    return ["bunx"]
  return ["npx", "--no-install"]
}

/** The runner of a project, from its files. */
export function detectRunner(cwd: string): Runner | undefined {
  const pkg = packageJson(cwd)
  if (pkg) {
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    }
    const script = String(
      (pkg.scripts as Record<string, string> | undefined)?.test ?? ""
    )
    if ("vitest" in deps || /\bvitest\b/.test(script)) return "vitest"
    if ("jest" in deps || /\bjest\b/.test(script)) return "jest"
    if (script) return "command"
  }
  if (
    existsSync(join(cwd, "pytest.ini")) ||
    existsSync(join(cwd, "conftest.py")) ||
    (existsSync(join(cwd, "pyproject.toml")) &&
      /pytest/.test(readFileSync(join(cwd, "pyproject.toml"), "utf8")))
  )
    return "pytest"
  if (existsSync(join(cwd, "go.mod"))) return "go"
  if (existsSync(join(cwd, "Cargo.toml"))) return "cargo"
  return undefined
}

function plan(
  cwd: string,
  runner: Runner,
  filter: string | undefined,
  command: string | undefined
): Plan {
  const report = join(tmpdir(), `pico-tests-${randomBytes(4).toString("hex")}`)
  switch (runner) {
    case "vitest":
      return {
        runner,
        command: [
          ...packageRunner(cwd),
          "vitest",
          "run",
          "--reporter=json",
          `--outputFile=${report}.json`,
          ...(filter ? [filter] : []),
        ],
        reportFile: `${report}.json`,
      }
    case "jest":
      return {
        runner,
        command: [
          ...packageRunner(cwd),
          "jest",
          "--json",
          `--outputFile=${report}.json`,
          ...(filter ? [filter] : []),
        ],
        reportFile: `${report}.json`,
      }
    case "pytest":
      return {
        runner,
        command: [
          "python3",
          "-m",
          "pytest",
          "-q",
          `--junitxml=${report}.xml`,
          ...(filter ? ["-k", filter] : []),
        ],
        reportFile: `${report}.xml`,
      }
    case "go":
      return {
        runner,
        command: [
          "go",
          "test",
          "-json",
          ...(filter ? ["-run", filter] : []),
          "./...",
        ],
      }
    case "cargo":
      return {
        runner,
        command: [
          "cargo",
          "test",
          "--no-fail-fast",
          ...(filter ? [filter] : []),
        ],
      }
    default: {
      const pkg = packageJson(cwd)
      const manager = existsSync(join(cwd, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(cwd, "yarn.lock"))
          ? "yarn"
          : "npm"
      return {
        runner: "command",
        command:
          command ??
          (pkg
            ? `${manager} test${filter ? ` -- ${filter}` : ""}`
            : "make test"),
      }
    }
  }
}

type JestJson = {
  numPassedTests?: number
  numFailedTests?: number
  numPendingTests?: number
  numTodoTests?: number
  numTotalTests?: number
  testResults?: Array<{
    name?: string
    message?: string
    status?: string
    assertionResults?: Array<{
      fullName?: string
      title?: string
      status?: string
      failureMessages?: string[]
      location?: { line?: number }
    }>
  }>
}

const ANSI_CODES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

function cleanMessage(message: string) {
  return clip(message.replace(ANSI_CODES, "").trim(), 2000)
}

/** Parse the JSON report of vitest or jest. */
export function parseJestJson(json: JestJson, cwd: string) {
  const failures: TestFailure[] = []
  for (const file of json.testResults ?? []) {
    const path = file.name ? relative(cwd, file.name) : undefined
    const failedAssertions = (file.assertionResults ?? []).filter(
      (assertion) => assertion.status === "failed"
    )
    for (const assertion of failedAssertions) {
      failures.push({
        name: assertion.fullName ?? assertion.title ?? "(unnamed)",
        ...(path ? { file: path } : {}),
        ...(assertion.location?.line ? { line: assertion.location.line } : {}),
        message: cleanMessage((assertion.failureMessages ?? []).join("\n")),
      })
    }
    if (
      failedAssertions.length === 0 &&
      file.status === "failed" &&
      file.message
    )
      failures.push({
        name: "(test file failed to run)",
        ...(path ? { file: path } : {}),
        message: cleanMessage(file.message),
      })
  }
  const skipped = (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0)
  return {
    passed: json.numPassedTests ?? 0,
    failed: Math.max(json.numFailedTests ?? 0, failures.length),
    skipped,
    total: json.numTotalTests ?? 0,
    failures,
  }
}

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** Parse a JUnit XML report, as pytest writes it. */
export function parseJunit(xml: string) {
  const failures: TestFailure[] = []
  let passed = 0
  let skipped = 0
  let total = 0
  for (const match of xml.matchAll(
    /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g
  )) {
    total += 1
    const attributes = match[1] ?? ""
    const body = match[2] ?? ""
    const attr = (name: string) =>
      new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1]
    const failure =
      /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(
        body
      )
    if (failure) {
      const message =
        /message="([^"]*)"/.exec(failure[2] ?? failure[5] ?? "")?.[1] ?? ""
      failures.push({
        name: decodeXml(`${attr("classname") ?? ""}::${attr("name") ?? ""}`),
        ...(attr("file") ? { file: decodeXml(attr("file")!) } : {}),
        ...(attr("line") ? { line: Number(attr("line")) } : {}),
        message: cleanMessage(decodeXml(`${message}\n${failure[3] ?? ""}`)),
      })
    } else if (/<skipped\b/.test(body)) skipped += 1
    else passed += 1
  }
  return { passed, failed: failures.length, skipped, total, failures }
}

/** Parse `go test -json` output. */
export function parseGoJson(output: string) {
  const outputByTest = new Map<string, string[]>()
  const failures: TestFailure[] = []
  let passed = 0
  let skipped = 0
  for (const line of output.split("\n")) {
    if (!line.startsWith("{")) continue
    let event: {
      Action?: string
      Test?: string
      Package?: string
      Output?: string
    }
    try {
      event = JSON.parse(line) as typeof event
    } catch {
      continue
    }
    if (!event.Test) continue
    const key = `${event.Package}.${event.Test}`
    if (event.Action === "output") {
      const lines = outputByTest.get(key) ?? []
      lines.push(event.Output ?? "")
      outputByTest.set(key, lines)
    } else if (event.Action === "pass") passed += 1
    else if (event.Action === "skip") skipped += 1
    else if (event.Action === "fail")
      failures.push({
        name: `${event.Package} ${event.Test}`,
        message: cleanMessage((outputByTest.get(key) ?? []).join("")),
      })
  }
  return {
    passed,
    failed: failures.length,
    skipped,
    total: passed + failures.length + skipped,
    failures,
  }
}

/** Parse the text output of `cargo test`. */
export function parseCargo(output: string) {
  const failures: TestFailure[] = []
  let passed = 0
  let skipped = 0
  for (const match of output.matchAll(
    /^test (\S+) \.\.\. (ok|FAILED|ignored)$/gm
  )) {
    if (match[2] === "ok") passed += 1
    else if (match[2] === "ignored") skipped += 1
    else failures.push({ name: match[1]!, message: "" })
  }
  for (const failure of failures) {
    const section = new RegExp(
      `---- ${failure.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} stdout ----\\n([\\s\\S]*?)(?=\\n---- |\\nfailures:|$)`
    ).exec(output)
    failure.message = cleanMessage(section?.[1] ?? "")
  }
  return {
    passed,
    failed: failures.length,
    skipped,
    total: passed + failures.length + skipped,
    failures,
  }
}

export function formatReport(report: TestReport) {
  const head = `${report.failed === 0 && report.exitCode === 0 ? "PASS" : "FAIL"} — ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped (${report.total} total) in ${(report.durationMs / 1000).toFixed(1)}s [${report.runner}]${report.timedOut ? " (timed out)" : ""}`
  const failures = report.failures.slice(0, 15).map(
    (failure) =>
      `✗ ${failure.name}${failure.file ? ` (${failure.file}${failure.line ? `:${failure.line}` : ""})` : ""}\n${failure.message
        .split("\n")
        .slice(0, 12)
        .map((line) => `    ${line}`)
        .join("\n")}`
  )
  const extra =
    report.failures.length > 15
      ? [`…and ${report.failures.length - 15} more failures`]
      : []
  const noTests =
    report.total === 0 ||
    (report.exitCode !== 0 && report.failures.length === 0)
      ? [`Output:\n${report.outputTail}`]
      : []
  return [head, `$ ${report.command}`, ...failures, ...extra, ...noTests].join(
    "\n"
  )
}

export async function runTests(
  cwd: string,
  options: {
    runner?: Runner
    filter?: string
    command?: string
    timeoutMs?: number
    signal?: AbortSignal
  }
): Promise<TestReport> {
  const runner = options.command
    ? "command"
    : (options.runner ?? detectRunner(cwd) ?? "command")
  const testPlan = plan(cwd, runner, options.filter, options.command)
  const started = Date.now()
  const result = await runCommand(testPlan.command, {
    cwd,
    timeoutMs: options.timeoutMs ?? 15 * 60_000,
    env: { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const durationMs = Date.now() - started
  const output = `${result.stdout}\n${result.stderr}`
  let counts = {
    passed: 0,
    failed: result.code === 0 ? 0 : 1,
    skipped: 0,
    total: 0,
    failures: [] as TestFailure[],
  }
  try {
    if (testPlan.reportFile && existsSync(testPlan.reportFile)) {
      const text = await readFile(testPlan.reportFile, "utf8")
      counts =
        runner === "pytest"
          ? parseJunit(text)
          : parseJestJson(JSON.parse(text) as JestJson, cwd)
    } else if (runner === "go") counts = parseGoJson(result.stdout)
    else if (runner === "cargo") counts = parseCargo(output)
  } catch {
    // Keep the exit-code-only result.
  } finally {
    if (testPlan.reportFile) await rm(testPlan.reportFile, { force: true })
  }
  return {
    runner,
    command: Array.isArray(testPlan.command)
      ? testPlan.command.join(" ")
      : testPlan.command,
    exitCode: result.code,
    ...counts,
    durationMs,
    outputTail: clip(tail(output.replace(ANSI_CODES, "").trim(), 40), 4000),
    ...(result.timedOut ? { timedOut: true } : {}),
  }
}

const reportSchema = Type.Object({
  runner: Type.String(),
  command: Type.String(),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  passed: Type.Number(),
  failed: Type.Number(),
  skipped: Type.Number(),
  total: Type.Number(),
  durationMs: Type.Number(),
  failures: Type.Array(
    Type.Object({
      name: Type.String(),
      file: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number()),
      message: Type.String(),
    })
  ),
  outputTail: Type.String(),
  timedOut: Type.Optional(Type.Boolean()),
})

export function createTestsExtension() {
  const tool = defineTool({
    name: "run_tests",
    description: [
      "Run the project's tests and get a structured result: counts and the failing tests with their messages.",
      "The runner is detected (vitest, jest, pytest, go test, cargo test); set runner or command to override. filter selects tests by name or file.",
    ].join(" "),
    parameters: Type.Object({
      filter: Type.Optional(Type.String()),
      runner: Type.Optional(
        Type.Union(
          ["vitest", "jest", "pytest", "go", "cargo"].map((runner) =>
            Type.Literal(runner)
          )
        )
      ),
      command: Type.Optional(
        Type.String({ description: "Run this command instead" })
      ),
      cwd: Type.Optional(Type.String()),
      timeout: Type.Optional(Type.Number({ description: "Seconds" })),
    }),
    structuredOutputSchema: reportSchema,
    replay: "safe",
    async execute(args, api, context) {
      const cwd = args.cwd?.trim() || (await cwdOf(api, context))
      const report = await runTests(cwd, {
        ...(args.runner ? { runner: args.runner as Runner } : {}),
        ...(args.filter ? { filter: args.filter } : {}),
        ...(args.command ? { command: args.command } : {}),
        ...(args.timeout ? { timeoutMs: args.timeout * 1000 } : {}),
        ...(context.abortSignal ? { signal: context.abortSignal } : {}),
      })
      return {
        output: [{ type: "text", text: formatReport(report) }],
        structuredOutput: report as never,
        details: report as never,
        ...(report.failed > 0 || report.exitCode !== 0
          ? { isError: true }
          : {}),
      }
    },
  })
  return defineExtension({ name: "tests", tools: [tool] })
}
