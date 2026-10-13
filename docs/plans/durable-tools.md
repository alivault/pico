# Plan: More capability in Pico through pi-durable

Status: implemented in seven commits (Phase 0 to Phase 6). See the notes at the end for the differences from this plan. Scope: all ideas from the agent review, with two changes:

- **YOLO mode.** No approval wrapper and no `request_approval`. Tools run at once.
- **Worktrees are optional.** A new session (from the UI or from `spawn_session`)
  can use a new git worktree. The default is no worktree.

## Verified API facts

I checked these in `@earendil-works/pi-durable@1.2.0`:

| Need                                | API                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Durable timer                       | `TaskRuntime.sleep(until, ctx)` in a task phase                              |
| Durable background work             | `createTask(..., { ownership: { kind: "conversation" }, background: true })` |
| Per-conversation state              | `defineDoc({ scope: "conversation" })`                                       |
| Project state for many sessions     | `defineDocFamily({ scope: "session", family: true })`                        |
| UI data from a tool                 | `api.details(value)` and the result `details`                                |
| No repeat of a side effect on rerun | `api.memo(name, value)` with `replay: "safe"`                                |
| Talk to another conversation        | `api.conversation(id).submit({ requestId })`, `submission.wait()`            |
| Live task list                      | `harness.watchTaskGraph()`                                                   |
| Per-session extension set           | `conversation.configure({ extensions })`                                     |
| MCP OAuth                           | `pi-mcp/dist/oauth/*` (flow, provider, discovery)                            |

Pi-durable has no `waitForIdle` on a handle. Use `submission.wait()` or a task
that waits.

## Design rules

1. **One extension per feature** in `server/src/extensions/`, like `web-access.ts`.
   Each extension has a name, so profiles can select it.
2. **State lives in documents**, not in server memory. A server restart must not
   lose a todo list, a timer, a question, or a child-session link.
3. **Every tool with an external effect uses `memo`** and `replay: "safe"`, so a
   rerun after a crash finds the earlier result. Examples: spawn, send, commit,
   PR create, notify, schedule.
4. **The model gets short text. The UI gets `details`.** A diagram, a test report
   or a screenshot goes to the client in `details`. The model sees one summary line.
5. **Follow-ups use a `requestId`.** A timer, a watch or a child report submits
   to a session with a fixed `requestId`, so a restart cannot send it two times.
6. **YOLO.** No `beforeTool` blocks. Pico stays a single-user tool behind Tailscale.

## Phase 0: Foundation (do first)

### 0.1 Host bridge for extensions

Extensions need Pico services (`Sessions`, `Terminals`, git, events), but
`openRuntime()` runs before `Sessions` exists.

- Add `server/src/extensions/host.ts` with a `PicoHost` interface and a late
  binding: `host.bind({ sessions, terminals, events, paths })`.
- `openRuntime()` takes the host object and gives it to each extension factory.
- A tool that runs before `bind()` waits for it (restart recovery).

### 0.2 Session metadata for new links

Extend `SessionMeta` in `server/src/core/sessions.ts`:

```ts
parent?: string            // session that spawned this one
spawnedByCall?: string     // tool call ID, for the UI link
depth?: number             // limit for nested spawns
profile?: string           // tool profile name
worktree?: { repoRoot: string; path: string; branch: string }
```

Sessions from `spawn_session` are **ownerless** conversations with a
`SessionDoc`, so `Sessions.load()` already finds them and the sidebar can show
them. `parent` shows them as children.

### 0.3 Client renderer registry for tool results

`src/features/pico/conversation-view.tsx` (2800 lines) renders tools inline.

- Add `src/features/pico/tool-renderers/` with `registry.tsx`: `toolName -> renderer`.
  A renderer can replace the whole card (`Card`, always open), only the body
  (`Body`), or only the header summary.
- The tool card asks the registry first, then uses the existing `bash`,
  `write`, and `edit` views, then the generic block. The existing views stay in
  `conversation-view.tsx`, because they share many helpers with it.

Every later phase adds one renderer file here.

### 0.4 Session side panels

Add a "Session" tab group in `right-sidebar.tsx` for: Todo, Timers and watches,
Jobs, Child sessions, Memory, Preview. Each panel reads a document through one
generic route:

- `GET /api/session/doc?session=&kind=` and an SSE update on change
  (`harness.watchDoc()` → the existing `events.ts` stream).

### 0.5 Tests

Add `server/test/extensions/*.test.ts` with the durable faux provider. Each
extension test covers: normal call, restart in the middle, and fork behavior.

## Phase 1: Visible quick wins

### 1.1 `todo` (extension `todo`)

- Doc `pico.todo`: `{ items: [{ id, text, status: "pending"|"active"|"done"|"blocked", note? }] }`,
  `history: "rewindable"`, `fork: "asOf"` (tree navigation shows the list as it was).
- Tool `todo` with ops `set | add | update | remove | clear`. Result returns the list.
- Section `todo`: the open items, short. It survives compaction because it is a section.
- UI: a checklist panel, and a compact progress chip above the composer.
  The user can tick or edit items (route writes the doc).

### 1.2 `ask_user` (extension `ask`)

- Doc `pico.questions`: `{ pending: { [callId]: Question }, answered: {...} }`.
  `Question` = `{ prompt, kind: "choice"|"multi"|"text"|"form", options?, fields?, createdAt }`.
- Tool `ask_user`, `replay: "safe"`:
  1. `memo` the question into the doc.
  2. Observe the doc until the answer exists (`api` is a `DocumentObserver`).
  3. Return the answer as text, and `details` for the UI.
- A restart reruns the tool. The memo finds the same question, so it waits again.
  If the answer was committed before the crash, the rerun finds it and returns at once.
- Route `POST /api/session/answer { session, callId, value }` commits the answer.
- UI: an inline card in the transcript and a badge on the session in the sidebar
  ("needs input"). Reuse parts of `app-shell-ui-request-dialog.tsx`.
- If the user sends a normal message while a question is open, it is a steer.
  The tool returns "user replied in chat" and the model reads the steer.
- Triggers a `notify` (Phase 3.5) when it lands.

### 1.3 `show` (extension `render`)

- Tool `show { kind: "mermaid"|"chart"|"table"|"html"|"markdown"|"image"|"diff", title?, data | path }`.
- `details` holds the payload. `output` is "Shown <kind>: <title>".
- Size limit on `details` (for example 512 KB). For larger data, use a scratchpad reference.
- Client renderers, all lazy loaded:
  - `mermaid` (package `mermaid`).
  - `chart`: Vega-Lite spec (`vega-embed`).
  - `table`: the existing table styles, sortable.
  - `html`: sandboxed `<iframe sandbox="allow-scripts" srcdoc>`, no same-origin.
  - `image`: from a path through `/api/files/read`, with the existing lightbox.
  - `diff`: the existing `@pierre/diffs` view.

## Phase 2: Durability

### 2.1 `schedule` (extension `schedule`)

- Task definition `pico.timer`, in the extension's `tasks`:
  phases `sleep → fire → (loop if recurring) → done`.
  - `sleep`: `runtime.sleep(fireAt)`.
  - `fire`: submit `{ type: "input", content: message, requestId: "timer:<taskId>:<n>", whenBusy: followUp }`
    to the conversation, then compute the next `fireAt` for a repeating timer.
- Created with `background: true`, so Esc and idle waits do not include it.
- Tools: `schedule { at | in | every, message }`, `schedule_list`, `schedule_cancel { id }`.
  `schedule` uses `memo` for the task ID.
- Accept `in: "20m"`, ISO time, and simple cron (`every: "0 9 * * 1-5"`, package `croner`).
- UI panel: pending timers with time left and a cancel button (`watchTaskGraph`
  filtered to `pico.timer` for this conversation).
- A timer that was due while the server was down fires once at startup, not many times.

### 2.2 `watch` (extension `watch`)

- Task `pico.watch`: phases `check → sleep → check … → fire`.
- Kinds of check:
  - `command`: run with `env.exec`, match on exit code or regex on output.
  - `url`: HTTP status or body regex.
  - `file`: mtime or content hash changes.
  - `ci`: `gh pr checks` or `gh run view` (sugar over `command`, Phase 4.2).
- Fields: `interval` (minimum 15 s), `timeout`, `message` (the follow-up text).
  The follow-up includes the last check output.
- Tools: `watch`, `watch_list`, `watch_cancel`. The same UI panel as timers.

### 2.3 `background_job` (extension `jobs`)

A process cannot survive a server restart. The record of it can.

- Doc `pico.jobs`: `{ [jobId]: { command, cwd, status, exitCode?, startedAt, endedAt?, logPath, terminalId?, notifyOnExit } }`.
- Run each job in a PTY of the existing `services/terminal.ts`, so the user can
  open it live in the terminal panel. Also tee output to `~/.pico/jobs/<id>.log`.
- Tools: `job_start { command, cwd?, notify_on_exit? }`, `job_status`,
  `job_output { id, tail?, grep? }`, `job_stop`, `job_list`.
- On exit with `notify_on_exit`, submit a follow-up with the exit code and the
  last lines (`requestId: "job:<id>:exit"`).
- At startup, mark each `running` job without a live process as `lost`. Report
  it to the session once.
- UI: a Jobs panel; one click opens the PTY in the terminal panel.

### 2.4 `scratchpad` (extension `scratchpad`)

- Files under `~/.pico/scratch/<conversationId>/<id>`. Index in doc `pico.scratch`
  (`fork: "current"`).
- Tools: `scratch_put { name?, content | from_tool_result }`,
  `scratch_get { id, offset?, limit?, grep? }`, `scratch_list`, `scratch_delete`.
- Optional `afterTool` hook: when a tool output is larger than N KB, save it to
  the scratchpad and replace the output with the head plus the scratch ID.
  Setting: off by default.
- Codemode `store/load` stays as it is. Scratch is for large text.

## Phase 3: Multiple sessions

### 3.1 Optional worktrees for new sessions

- New `server/src/services/worktree.ts`:
  - `create(repoRoot, branch?, base?)` → `git worktree add -b pico/<slug> <path> <base>`.
  - Path: `~/.pico/worktrees/<repo-name>/<slug>` (outside the repo, so tools do
    not see sibling worktrees).
  - `remove(path, { force })`, `list(repoRoot)`, `isClean(path)`.
  - Copy files that git ignores but the project needs? Setting with a glob list,
    default `[".env*"]`. Off when empty.
- `Sessions.create(cwd, { worktree?: { branch?, base? } })` creates the worktree,
  then the session with `cwd = worktree path` and `meta.worktree`.
- `POST /api/session/new` accepts `worktree`. The new-session UI gets a
  "New worktree" switch and an optional branch name. Default off. The switch is
  disabled when the directory is not a git repo.
- Sidebar: a branch icon on worktree sessions. Group worktree sessions under
  their main repo directory (match on `repoRoot`).
- Archive a worktree session: a dialog with "Keep worktree" (default) or
  "Remove worktree" (only when clean, or with force).
- Git panel works without change, because it uses the session `cwd`.

### 3.2 `spawn_session` and friends (extension `sessions`)

Based on durable example `23-subagent-background.ts`, but children are normal
Pico sessions.

- `spawn_session { goal, cwd?, model?, thinking?, profile?, worktree?: boolean | { branch?, base? }, name?, wait?: boolean }`
  - `replay: "safe"`. `memo` the child session ID.
  - Creates the child through `host.sessions.create()` with `parent`, `depth`,
    and an optional worktree. Submits `goal` with `requestId: "spawn:<callId>"`.
  - `wait: false` (default): return the child ID at once. A background reporter
    task `pico.child-report` waits for the child submission, then posts the
    answer back to the parent as a follow-up (`requestId: "report:<child>:<n>"`).
  - `wait: true`: wait for the submission and return the final answer.
  - `details: { sessionId }`. The UI shows a card with a live status and an
    "Open" link.
- `send_to_session { id, message, mode: "steer"|"followUp", wait? }`.
- `read_session { id, last?: number, include_tools?: boolean }`: the last
  assistant messages as text.
- `list_sessions { scope: "children"|"directory"|"all" }`.
- `wait_for_sessions { ids, timeout? }`: waits for all, returns each answer.
- `stop_session { id }`: `abort()` on the child.
- Limits: `depth <= 3` and at most N live children for each parent (setting).
- A child with no worktree shares the parent `cwd`. The tool description says
  this, and suggests `worktree: true` for parallel edits.

Reviewer pattern: the parent calls `spawn_session { profile: "review", cwd: <builder cwd> }`
with "review the diff of session X". The child uses `read_session` and `git_diff`.

### 3.3 Child sessions in the UI

- Sidebar: children nest under the parent, collapsed, with a status dot.
- Session header: a "Spawned by <parent>" link.
- Child panel in the right sidebar: status, last message, open, stop.

## Phase 4: Developer workflow

### 4.1 `git` tools (extension `git`)

Thin tools on `services/git.ts`, with structured output:
`git_status`, `git_diff { path?, staged?, ref? }`, `git_log { n?, path? }`,
`git_commit { message, paths?, all? }`, `git_branch { create?, switch? }`,
`git_push`, `git_pull`.

- `details` carries file lists and ref names, so the client links to the git panel diff view.
- `git_commit` and `git_push` use `memo` (a rerun does not commit two times).

### 4.2 `github` (extension `github`)

Through the `gh` CLI (no new token storage). If `gh` is missing or not signed
in, the tools return a clear error.

- `gh_pr { action: view|list|create|checkout|comment|merge, ... }`
- `gh_issue { action: view|list|create|comment, ... }`
- `gh_checks { pr? }`: structured check states.
- `gh_run_log { run_id, failed_only: true }`: the failed step logs, trimmed.
- `watch` kind `ci` uses `gh_checks`. That gives the "fix CI until green" loop:
  push → `watch ci` → follow-up on fail → fix → push.

### 4.3 `run_tests` (extension `tests`)

- Detect the runner from the project files: vitest, jest, node test, pytest,
  go test, cargo test. A project setting can override the command.
- Run with a machine reporter (vitest/jest JSON, pytest junit XML, `go test -json`,
  cargo libtest JSON where available). Parse into
  `{ passed, failed, skipped, durationMs, failures: [{ name, file, line, message }] }`.
- `structuredOutputSchema`, so codemode scripts get the object.
- `output`: counts plus the first failures. `details`: the full report for a test panel renderer.

### 4.4 LSP tools (extension `lsp`)

- `server/src/services/lsp.ts`: one language server for each (root, language),
  started on first use, stopped after 10 minutes idle. Uses `vscode-jsonrpc`.
- Servers, when found on `PATH` or in the project: `typescript-language-server`,
  `pyright-langserver`, `rust-analyzer`, `gopls`. Settings can add more.
- Tools: `lsp_diagnostics { path? }`, `lsp_definition`, `lsp_references`,
  `lsp_hover`, `lsp_symbols { query }`, `lsp_rename { path, line, column, new_name }`.
  Positions are 1-based line and column, or a symbol name with a path.
- `lsp_rename` applies the workspace edit with the same file locks as `edit`
  (by env id and path) and returns the changed files.
- Optional `afterTool` hook on `edit`/`write`: append new diagnostics for the
  changed file. Setting, off by default.

## Phase 5: Web client surfaces

### 5.1 `preview_url` (extension `preview`)

- Tool `preview_url { url | job_id + port, path? }`. With a job, wait until the
  port answers.
- Doc `pico.preview`: `{ url, port?, jobId? }`.
- Remote access: the phone cannot reach `localhost:5173` on the server. Pico
  opens a **separate port for each preview**, from a range (default
  4100–4199), that forwards HTTP and WebSocket traffic (for HMR) to the dev
  server. Paths stay at `/`, so apps that use absolute paths work. The preview
  listener binds to the same host as Pico. Allow only local targets.
- UI: a Preview panel (iframe) with reload, open in new tab, and a device width toggle.
- Optional: `preview_screenshot` through the durable browser (5.3), so the
  model can see the page.

### 5.2 `notify` (extension `notify`) and push

- Server: Web Push with VAPID keys in `~/.pico/push.json`. Subscriptions in
  the settings file. Package `web-push`.
- Client: a service worker (`public/sw.js`) and a "Enable notifications on this
  device" switch in settings. iOS needs HTTPS and an installed PWA; document
  Tailscale Serve for this.
- Optional fallback: an `ntfy` topic URL in settings.
- Tool `notify { title, body, level? }`, with `memo`.
- Automatic events (each one a setting): run finished, `ask_user` pending,
  job exit, watch fired, child session finished.
- Clicking the notification opens the session.

### 5.3 Durable browser (extension `browser`)

- `playwright-core` with the installed Chrome (no browser download).
  One browser process, one context for each conversation.
- Doc `pico.browser`: open tabs (URL, title). The cookies and storage state
  go to `~/.pico/browser/<conversationId>.json` after each action.
  After a restart, the context is created again from that file and the tabs reopen.
- Tools: `browser_open { url }`, `browser_snapshot` (accessibility tree with refs),
  `browser_act { ref | selector, action: click|type|select|press|scroll, value? }`,
  `browser_screenshot { full_page? }` (image result, and `details` for the UI),
  `browser_eval { expression }`, `browser_close`.
- Headless by default. Setting for headed mode on the server machine.

## Phase 6: Platform

### 6.1 Memory (extension `memory`)

- Doc family `pico.memory`, `scope: "session"`, key = repo root (or `cwd` when
  not a repo). A `global` key for facts that are not project-specific.
- Value: `{ facts: [{ id, text, tags?, updatedAt, source: "agent"|"user" }] }`.
- Tool `memory { op: add|update|remove|list|search, ... }`.
- Section `memory`: the facts for the project, with a token limit. When the
  list is too long, show the newest and tell the model to use `search`.
- UI: a Memory panel. The user can add, edit and delete. Route writes the doc.
- Forks and child sessions see the same memory (it is keyed by project, not by conversation).

### 6.2 Tool profiles

- Settings: `profiles: { [name]: { extensions: string[], instructions?: string } }`.
  Built-in profiles:
  - `full`: all extensions (default).
  - `research`: prompt, web-access, memory, todo, scratchpad, render, ask.
  - `read-only`: `read`, `bash` removed, git read tools, LSP, web. This is a
    capability choice for the agent, not an approval system.
  - `review`: read-only plus `read_session`, `git_diff`, `gh_pr`.
- `Sessions.setProfile(id, name)` → `conversation.configure({ extensions })`.
- UI: a profile picker next to the model picker, and in the new-session dialog.
- `spawn_session { profile }` uses the same names.
- Each new extension must be in the registry by name before profiles can
  select it (Phase 0.1 makes this true).

### 6.3 `memo` audit of Pico tools

- `web-access`: keep `replay: "safe"` (no side effects).
- `mcp`: MCP tools can have side effects. Keep `unsafe` as the default, and add
  a per-server setting `replaySafe: true` for read-only servers.
- All new tools in this plan: follow design rule 3. Add a restart test for each one.
- Update the README sentence about exactly-once effects: say which tools are safe.

### 6.4 MCP OAuth in the UI

- Use `pi-mcp`'s `oauth/flow` and `oauth/provider`. Store tokens where `pi-mcp`
  expects them.
- `GET /api/mcp/servers`: status for each server (connected, failed, needs auth).
- `POST /api/mcp/:server/auth/start` → returns the authorization URL.
  Callback route `/api/mcp/oauth/callback`. On success, reconnect and call
  `mcp.onChange` (the runtime already reinstalls the extension).
- UI: an MCP section in settings with a "Sign in" button for each server.
- Remote case: the redirect URI must use the address the browser uses
  (Tailscale host), not `127.0.0.1`.

## Order of work

| Step | Work                                                                         | Depends on                        |
| ---- | ---------------------------------------------------------------------------- | --------------------------------- |
| 1    | Phase 0 (host bridge, meta fields, renderer registry, doc route, test setup) | none                              |
| 2    | `todo`, `ask_user`, `show`                                                   | 0                                 |
| 3    | `schedule`, `background_job`, `scratchpad`                                   | 0                                 |
| 4    | `notify` and Web Push                                                        | 2 (ask_user event), 3 (job event) |
| 5    | `watch`                                                                      | 3                                 |
| 6    | Worktree service and new-session switch                                      | 0                                 |
| 7    | `spawn_session` family and child UI                                          | 3, 6                              |
| 8    | `git`, `github`, `run_tests`                                                 | 5 for the CI loop                 |
| 9    | Memory, tool profiles                                                        | 7 (profiles for children)         |
| 10   | `preview_url` with a port for each preview                                   | 3                                 |
| 11   | LSP tools                                                                    | none after 0                      |
| 12   | Durable browser                                                              | 1.3 renderers                     |
| 13   | `memo` audit, MCP OAuth, README update                                       | all                               |

Each step is one PR, with `pnpm check` green and restart tests for its tasks.

## Risks and open questions

1. **Prompt cache.** The `todo` and `memory` sections change often. Durable sends
   only changed sections, but each change still adds a system entry. Put these
   sections last. Measure the cache hit rate after step 2.
2. **Spawn storms in YOLO mode.** No approvals means a loop can spawn many
   sessions or jobs. The depth limit, the child limit and a job limit are the
   only guards. Add a "Stop all children" button.
3. **`ask_user` holds the run open.** The session stays busy while it waits.
   Check that the busy state does not block other routes (rename, move) and that
   Esc cancels the question cleanly.
4. **Shared `cwd` without a worktree.** Parallel children can edit the same
   files. This is the user's choice, because worktrees are optional.
5. **Pi-durable is experimental (1.2.0, pinned).** Task definitions get a
   `version` and a `migrate` from the start, so stored timers and watches
   survive later changes.
6. **New dependencies:** `croner`, `mermaid`, `vega-embed`, `web-push`,
   `vscode-jsonrpc`, `playwright-core`. All lazy loaded or server-only. Check
   the package size before release.
7. **Preview proxy security.** The proxy exposes local dev servers to anyone who
   can reach Pico. This is the same trust model as the terminals, but say it in
   the README.

## Implementation notes

The code follows this plan, with these differences:

- **Tool renderers (0.3):** the existing `bash`, `write`, and `edit` views stay
  in `conversation-view.tsx`; the card asks the registry first.
- **Agent panel (0.4):** the panel reads one route,
  `GET /api/session/extensions`, which returns the state of every extension.
  A `session_extensions` event tells clients to read it again.
- **`ask_user` (1.2):** a chat message answers the open question and also
  reaches the model as a steer, so the transcript keeps the message.
- **Scratchpad (2.4):** entries are files with a metadata file each, not a
  document, because an `afterTool` hook can read documents but cannot commit
  them.
- **Jobs (2.3):** jobs run in shared terminals of the `Terminals` service; a
  job tab in the terminal panel attaches to the job's terminal.
- **Notifications (5.2):** the server notifies when a run finishes and when a
  question waits. Job exits, watches, and child reports arrive as follow-up
  messages, so their runs notify when they finish.
- **Previews (5.1):** a separate port for each preview, as decided after the
  plan.
- **Tool profiles (6.2):** the picker is in the new-session view and the Agent
  tab, not next to the model picker.
- **MCP OAuth (6.4):** tokens go to `~/.pico/mcp-oauth.json`, because
  `pi-mcp` leaves storage to the application.
- **Language servers (4.4):** Pico ships `typescript-language-server` and
  TypeScript, so TypeScript and JavaScript work without setup.
