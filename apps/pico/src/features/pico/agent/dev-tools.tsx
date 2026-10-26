import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleXIcon,
  GitCompareIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  registerToolRenderer,
  toolArgs,
  toolDetails,
  type ToolRendererProps,
} from "@/features/pico/tool-renderers/registry"
import { DiffView } from "@/features/pico/tool-renderers/show"
import { cn } from "@/lib/utils"

function argText(block: ToolRendererProps["block"], ...keys: Array<string>) {
  const args = toolArgs(block)
  return keys
    .map((key) => args[key])
    .filter(
      (value): value is string | number =>
        typeof value === "string" || typeof value === "number"
    )
    .map(String)
    .join(" ")
}

// -----------------------------------------------------------------------------
// git

type GitStatusDetails = {
  branch?: string
  ahead: number
  behind: number
  files: Array<{ path: string; index: string; worktree: string }>
}

registerToolRenderer("git_status", {
  summary(block) {
    const details = toolDetails<GitStatusDetails>(block)
    if (!details.files) return undefined
    const changed = details.files.length
    return `${details.branch ?? "detached"} · ${changed ? `${changed} changed` : "clean"}${details.ahead ? ` · ↑${details.ahead}` : ""}${details.behind ? ` · ↓${details.behind}` : ""}`
  },
})

registerToolRenderer("git_diff", {
  summary(block) {
    const args = toolArgs(block)
    const scope = args.staged
      ? "staged"
      : typeof args.ref === "string"
        ? `against ${args.ref}`
        : "unstaged"
    const paths = Array.isArray(args.paths) ? args.paths.join(", ") : ""
    return [scope, paths].filter(Boolean).join(" · ")
  },
  Body({ block }) {
    const details = toolDetails<{ patch: string; truncated: boolean }>(block)
    if (!details.patch)
      return (
        <pre className="text-xs whitespace-pre-wrap text-muted-foreground">
          {block.output}
        </pre>
      )
    return (
      <div className="space-y-2">
        <DiffView patch={details.patch} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {details.truncated ? <span>The diff is cut.</span> : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              emitPicoEvent("pico:open-sidebar-tab", { tab: "review" })
            }
          >
            <GitCompareIcon /> Open Changes
          </Button>
        </div>
      </div>
    )
  },
})

registerToolRenderer("git_commit", {
  summary: (block) => argText(block, "message").split("\n")[0],
})
registerToolRenderer("git_log", {
  summary: (block) => argText(block, "ref", "path") || "recent commits",
})
registerToolRenderer("git_branch", {
  summary: (block) => argText(block, "create", "switch") || "list branches",
})

// -----------------------------------------------------------------------------
// GitHub

type CheckDetails = {
  total: number
  passed: number
  failed: number
  pending: number
  done: boolean
  checks: Array<{
    name: string
    state: string
    bucket?: string
    link?: string
    workflow?: string
  }>
}

function CheckIcon({ bucket }: { bucket?: string }) {
  if (bucket === "pass")
    return <CircleCheckIcon className="size-3.5 text-emerald-600" />
  if (bucket === "fail" || bucket === "cancel")
    return <CircleXIcon className="size-3.5 text-destructive" />
  return <CircleDotIcon className="size-3.5 text-amber-500" />
}

registerToolRenderer("gh_checks", {
  summary(block) {
    const details = toolDetails<CheckDetails>(block)
    if (details.total === undefined) return argText(block, "pr")
    return `${details.passed} passed · ${details.failed} failed · ${details.pending} pending`
  },
  Body({ block }) {
    const details = toolDetails<CheckDetails>(block)
    if (!details.checks)
      return <pre className="text-xs whitespace-pre-wrap">{block.output}</pre>
    return (
      <ul className="space-y-1 text-xs">
        {details.checks.map((check) => (
          <li
            key={`${check.workflow}:${check.name}`}
            className="flex items-center gap-2"
          >
            <CheckIcon bucket={check.bucket} />
            <span className="min-w-0 flex-1 truncate">
              {check.workflow ? `${check.workflow} / ` : ""}
              {check.name}
            </span>
            {check.link ? (
              <a
                href={check.link}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                details
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    )
  },
})

registerToolRenderer("gh_pr", {
  summary: (block) => argText(block, "action", "pr", "title"),
})
registerToolRenderer("gh_issue", {
  summary: (block) => argText(block, "action", "number", "title"),
})
registerToolRenderer("gh_run_log", {
  summary: (block) => argText(block, "run_id", "pr") || "newest run",
})

// -----------------------------------------------------------------------------
// Tests

type TestReport = {
  runner: string
  command: string
  exitCode: number | null
  passed: number
  failed: number
  skipped: number
  total: number
  durationMs: number
  failures: Array<{
    name: string
    file?: string
    line?: number
    message: string
  }>
  outputTail: string
}

registerToolRenderer("run_tests", {
  summary(block) {
    const partial = toolDetails<TestReport>(block)
    if (partial.passed === undefined)
      return argText(block, "filter", "command") || "all tests"
    const report = partial as TestReport
    const ok = report.failed === 0 && report.exitCode === 0
    return `${ok ? "PASS" : "FAIL"} · ${report.passed} passed · ${report.failed} failed${report.skipped ? ` · ${report.skipped} skipped` : ""} · ${(report.durationMs / 1000).toFixed(1)}s`
  },
  Body({ block }) {
    const partial = toolDetails<TestReport>(block)
    if (partial.passed === undefined)
      return <pre className="text-xs whitespace-pre-wrap">{block.output}</pre>
    const report = partial as TestReport
    return (
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className="text-emerald-700 dark:text-emerald-400"
          >
            {report.passed} passed
          </Badge>
          <Badge
            variant="outline"
            className={cn(report.failed > 0 && "text-destructive")}
          >
            {report.failed} failed
          </Badge>
          {report.skipped ? (
            <Badge variant="outline">{report.skipped} skipped</Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {report.runner} · {(report.durationMs / 1000).toFixed(1)}s
          </span>
        </div>
        <code className="block truncate text-xs text-muted-foreground">
          $ {report.command}
        </code>
        {report.failures.length > 0 ? (
          <ul className="space-y-2">
            {report.failures.map((failure, index) => (
              <li
                key={`${failure.name}:${index}`}
                className="rounded-md border border-destructive/30 bg-destructive/5 p-2"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <CircleXIcon className="size-3.5 shrink-0 text-destructive" />
                  <span className="min-w-0 truncate">{failure.name}</span>
                </div>
                {failure.file ? (
                  <div className="text-xs text-muted-foreground">
                    {failure.file}
                    {failure.line ? `:${failure.line}` : ""}
                  </div>
                ) : null}
                {failure.message ? (
                  <pre className="mt-1 max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
                    {failure.message}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        ) : report.exitCode !== 0 ? (
          <pre className="max-h-64 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
            {report.outputTail}
          </pre>
        ) : null}
      </div>
    )
  },
})

// -----------------------------------------------------------------------------
// Language servers

registerToolRenderer("lsp", {
  summary(block) {
    const args = toolArgs(block)
    const action = typeof args.action === "string" ? args.action : ""
    if (action === "diagnostics") {
      const paths = Array.isArray(args.paths)
        ? args.paths.join(", ")
        : "changed files"
      const first = block.output.split("\n")[0] ?? ""
      return block.running
        ? `diagnostics ${paths}`
        : `diagnostics ${paths} · ${first}`
    }
    if (action === "symbols")
      return `symbols ${argText(block, "query", "path")}`
    const where = [
      typeof args.path === "string" ? args.path : "",
      typeof args.line === "number" ? `:${args.line}` : "",
    ].join("")
    const symbol = typeof args.symbol === "string" ? args.symbol : ""
    const renamed =
      typeof args.new_name === "string" ? ` → ${args.new_name}` : ""
    return [action, where, symbol + renamed].filter(Boolean).join(" ")
  },
})

// The old lsp tools, in earlier transcripts.
for (const name of [
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_rename",
]) {
  registerToolRenderer(name, {
    summary(block) {
      const args = toolArgs(block)
      const where = [
        typeof args.path === "string" ? args.path : "",
        typeof args.line === "number" ? `:${args.line}` : "",
      ].join("")
      const symbol = typeof args.symbol === "string" ? args.symbol : ""
      const renamed =
        typeof args.new_name === "string" ? ` → ${args.new_name}` : ""
      return [where, symbol + renamed].filter(Boolean).join(" ")
    },
  })
}

registerToolRenderer("lsp_diagnostics", {
  summary(block) {
    const args = toolArgs(block)
    const paths = Array.isArray(args.paths)
      ? args.paths.join(", ")
      : "changed files"
    const first = block.output.split("\n")[0] ?? ""
    return block.running ? paths : `${paths} · ${first}`
  },
})

registerToolRenderer("lsp_symbols", {
  summary: (block) => argText(block, "query", "path"),
})
