# Agent rename: names that the web client derived

Phase 2 of `agent-rename.md`. The plan's tables do not name these wire names, so the client derived them with the plan's rules (`sessionId` → `agentId`, `sessions` → `agents`, `session` → `agent`, `children` → `subagents`, `directory` → `project` for the sidebar group, `run` → `turn`). Compare this list with the server's list at merge time. A name that is different on the two sides fails only at run time.

## Query parameters

| Old                                     | New              | Where (client)                                                                                   |
| --------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `session` (API request)                 | `agent`          | `app-shell-utils.ts` (`buildRequestUrl`, `agentId`)                                              |
| `sessionKey`                            | `agentKey`       | `use-app-shell-prompt-mutations.ts`, `use-app-shell-agent-mutations.ts`                          |
| `session` (page URL, notification link) | `agent`          | `lib/pico/machine.ts` (`machinePageUrl`), `routes/index.tsx` (search schema and `pico:open-url`) |
| `directory` (index requests)            | `project`        | `app-shell-sidebar-store.ts`, `app-shell-agents-dialog.tsx` (`/api/project-agents-indexes`)      |
| `sidebarDirectory` (`/events`)          | `sidebarProject` | `use-app-shell-agent-sync.ts`                                                                    |

The server reads `sessionPath` as a query parameter too (`api.ts` `target()`, `server.ts` terminal scope). The client does not send it. By the rule it is `agentPath`.

## Request bodies

| Old                                                                                    | New                                                | Where (client)                                                                                                          |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `directory` (`/api/project-agents/cleanup`)                                            | `project`                                          | `app-shell-agent-dialogs.tsx`, `DeleteOldProjectAgentsRequest` in `lib/pico/api.ts`                                     |
| `includeActiveSession`                                                                 | `includeActiveAgent`                               | `lib/pico/api.ts` (`DeleteOldProjectAgentsRequest`)                                                                     |
| `sessionKey`                                                                           | `agentKey`                                         | `use-app-shell-prompt-mutations.ts`, `use-app-shell-agent-mutations.ts`, `app-shell.tsx`, `use-app-shell-agent-sync.ts` |
| `directories`, `pinnedSessionKeys`, `collapsedDirectories` (`POST /api/sidebar-state`) | `projects`, `pinnedAgentKeys`, `collapsedProjects` | `sidebar-sync.ts`                                                                                                       |

## Response fields (`lib/pico/api.ts`)

| Old                                                                                                      | New                                                |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `sessionId`                                                                                              | `agentId`                                          |
| `sessionKey`                                                                                             | `agentKey`                                         |
| `sessionPath`                                                                                            | `agentPath`                                        |
| `sessionFile`                                                                                            | `agentFile`                                        |
| `previousSessionFile` (clone)                                                                            | `previousAgentFile`                                |
| `sessions` (index snapshot, archived list)                                                               | `agents`                                           |
| `directory` (index snapshot, cleanup, archived entry, restore)                                           | `project`                                          |
| `directories` (indexes response)                                                                         | `projects`                                         |
| `directoryIndexes`                                                                                       | `projectIndexes`                                   |
| `deletedSessionIds` (cleanup)                                                                            | `deletedAgentIds`                                  |
| `matchingSessions` (cleanup)                                                                             | `matchingAgents`                                   |
| `appliesToActiveSessionAfterRestart` (`/api/settings/performance`)                                       | `appliesToActiveAgentAfterRestart`                 |
| `directories`, `pinnedSessionKeys`, `collapsedDirectories` (`/api/sidebar-state`, `sidebar_state` event) | `projects`, `pinnedAgentKeys`, `collapsedProjects` |

## Event fields

| Old                                                                  | New                                                        | Event                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `sessionId`, `sessionKey`, `sessionPath`                             | `agentId`, `agentKey`, `agentPath`                         | `agent_status`, `agent_done`, `agent_extensions`, `auto_agent_naming_error` |
| `activeSessionPath`, `activeSessionId`, `activeSessionKey`           | `activeAgentPath`, `activeAgentId`, `activeAgentKey`       | `agents`                                                                    |
| `directories`, `directoryStates`, `directoryIndexes`                 | `projects`, `projectStates`, `projectIndexes`              | `agents`                                                                    |
| `sessionId`                                                          | `agentId`                                                  | `conversation_delta`                                                        |
| `sessionKey`                                                         | `agentKey`                                                 | `state_sync`                                                                |
| `sessionId`, `sessionKey`, `sessionFile`, `sessionName`, `directory` | `agentId`, `agentKey`, `agentFile`, `agentName`, `project` | `state_sync` agent state (`AgentState` in `lib/pico/index.ts`)              |

## Hub machine summary (`/api/machines/events`, `features/pico/machine-store.ts`)

| Old                        | New        |
| -------------------------- | ---------- |
| `summary.directories`      | `projects` |
| `summary.sessions`         | `agents`   |
| `directory` (each summary) | `project`  |

## Agent panel state (`/api/agent/extensions`)

| Old                                        | New               | Where (client)              |
| ------------------------------------------ | ----------------- | --------------------------- |
| `sessionId` (response)                     | `agentId`         | `agent/agent-extensions.ts` |
| `state.session` (parent, worktree)         | `state.agent`     | `agent/agent-lineage.tsx`   |
| `state.children`                           | `state.subagents` | `agent/subagents.tsx`       |
| `sessionId` (each job in `/api/resources`) | `agentId`         | `resources-dialog.tsx`      |

## Tool arguments and details

| Old                                       | New                        | Tool                                                               |
| ----------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `details.sessionId`                       | `details.agentId`          | `spawn_subagent` (`agent/subagents.tsx`)                           |
| `scope: "children"`, `scope: "directory"` | `"subagents"`, `"project"` | `agents` list. The renderer only shows the value, so either works. |

## Settings (`/api/settings/agent`)

These are in the plan's table; listed here because the client uses them: `maxSubagents`, `maxSubagentDepth`, `notifyTurnDone`.

## Client-only names (not on the wire)

- Mobile tab value `"session"` → `"conversation"`, label "Session" → "Conversation" (`app-shell.tsx`, `app-shell-desktop-layout.tsx`, `use-app-shell-shortcuts.ts`).
- DOM event details: `pico:open-agent` and `pico:agent-extensions` take `{ agentId }`. `pico:sidebar-state` lists `"projects" | "pinnedAgentKeys" | "collapsedProjects"`.
- Command palette IDs: `new-agent`, `open-agents`, `conversation-tree`, `fork-conversation`, `clone-conversation`, `compact-conversation`, `rename-agent`, `delete-agent`, `delete-selected-agents`, `add-project`.
- Data attributes and CSS variables: `data-sidebar-agent-item`, `data-sidebar-agent-group`, `--sidebar-agent-gap`, `--agent-text-left`, and the others.
- Query keys: `["pico", "agent-extensions", …]`, `["pico", "project-agents-index", …]`, `["pico", "archived-agents", …]`, `["pico", "agent-tree", …]`.

## Stored names that stay

- `localStorage`: `pico-pinned-sessions`, `pico-sidebar-session-previews`, `pico-session-done-sound`, `pico-session-done-desktop-notifications`, `pico-draft-directory`, `pico-sidebar-directories`, `pico-collapsed-directories`, `pico-recent-directories`, `pico-machine-collapsed-directories:<id>`.
- Keys in stored records: `__pico_pinned_sessions__`, `__pico_directories__` (collapsed groups), the `session:` prefix of prompt draft keys, and the Agent panel section key `children` (open sections).
- The sound file `/sounds/session-done.mp3` (in `public/`).
- pi's tree entry type `session_info`, and the browser's `sessionStorage`.
