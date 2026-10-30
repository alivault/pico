# Agent rename: the server contract

Phase 1 of `agent-rename.md` (branch `rename-agents-server`). This file lists every wire name that the server changed, old → new, so the web client can match them exactly. It includes the names in the plan's tables. The client's list is `agent-rename-client.md` (branch `rename-agents-client`). At the end, "Differences" compares the two lists.

## Tools (the model reads these)

| Old                                      | New                                                         |
| ---------------------------------------- | ----------------------------------------------------------- |
| `spawn_session`                          | `spawn_subagent`                                            |
| `sessions`                               | `agents`                                                    |
| `send_to_session`                        | `agents` with `action: "send"`                              |
| `sessions.stop`, `sessions.archive`      | `agents.stop`, `agents.archive`                             |
| `send_to_session` in profiles and limits | `agents.send` (an action name, checked with `deniedAction`) |
| extension `sessions`                     | extension `agents`                                          |
| `CHILD_DENIED_TOOLS`                     | `SUBAGENT_DENIED_TOOLS` (`ask_user`, `spawn_subagent`)      |

- `agents` actions: `list`, `read`, `wait`, `send`, `stop`, `archive`, `restore`, `mark_read`, `mark_unread`.
- `agents` arguments: `action`, `id`, `ids`, `scope`, `last`, `include_tools`, `timeout`, `any`, `message`, `mode` (`followUp` or `steer`), `wait` (boolean), `add`, `remove`, `machine`. The `send` action uses `id`, `message`, `mode`, `wait`, `timeout`, `add`, `remove`, `machine`, as `send_to_session` did.
- `agents` list `scope`: `children` → `subagents` (the default), `directory` → `project`. `all` and `archived` stay.
- `builder` removes `agents.send`, `agents.stop`, `agents.archive`. `reviewer` keeps `agents.send`. `WRITE_TOOLS` lists `spawn_subagent`, `agents.send`, `agents.stop`, so `read-only` removes them.
- Tool result `details`: `spawn_subagent` and `agents` `send` give `agentId` (was `sessionId`), with `title`, `status`, `worktree`, `machine`, `machineLabel` as before.
- Messages in the follow-up queue: `[Subagent s12: question] …`, `[Subagent s12: done] …`, `[Agent s12: done] …` (was `[Child session …]`, `[Session …]`). Messages to another agent: `[Message from agent s12] …`, `[Message from agent s12 on the hub] …`.
- Subagent prompt: "You are a subagent of agent s12. Your parent gave you this work…" (was "You are a child session of session s12…").

## Settings (`/api/settings/agent`)

| Old                | New                |
| ------------------ | ------------------ |
| `maxChildSessions` | `maxSubagents`     |
| `maxSpawnDepth`    | `maxSubagentDepth` |
| `notifyRunDone`    | `notifyTurnDone`   |

A saved value under an old key is not read; the default applies.

## API routes

| Old                                               | New                                     |
| ------------------------------------------------- | --------------------------------------- |
| `/api/session/*` (all 25)                         | `/api/agent/*`                          |
| `/api/sessions/archived`                          | `/api/agents/archived`                  |
| `/api/sessions/delete`                            | `/api/agents/delete`                    |
| `/api/directory-sessions`                         | `/api/project-agents`                   |
| `/api/directory-sessions-index`                   | `/api/project-agents-index`             |
| `/api/directory-sessions-indexes`                 | `/api/project-agents-indexes`           |
| `/api/directory-sessions/cleanup`                 | `/api/project-agents/cleanup`           |
| `/api/session-image/:session/:entry/:index`       | `/api/agent-image/:agent/:entry/:index` |
| `/api/machine/session/*` (7)                      | `/api/machine/agent/*`                  |
| `/api/machine/sessions`                           | `/api/machine/agents`                   |
| `/api/machine/sessions/archived`                  | `/api/machine/agents/archived`          |
| `/api/directory-search`, `/api/directory/resolve` | no change (filesystem)                  |

The 25 `/api/agent/*` routes: `new`, `select`, `history`, `answer`, `todo`, `job/stop`, `job/log`, `scratch`, `instructions`, `profile`, `extensions`, `rename`, `name`, `delete`, `draft-worktree` (GET and POST), `restore`, `move`, `read-state`, `tree` (GET and POST), `tree/label`, `fork` (GET and POST), `clone`. The 7 `/api/machine/agent/*` routes: `spawn`, `prompt`, `read`, `wait`, `stop`, `read-state`, `archive`.

The image URLs come in the conversation items (`imagePath` in `core/items.ts`). The client uses them as they are.

## Query parameters

| Old                                        | New              | Where                                                                                     |
| ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `session`                                  | `agent`          | every API route (`target()` in `api.ts`), `/events`, terminal routes, the hub proxy cache |
| `sessionPath`                              | `agentPath`      | the same                                                                                  |
| `sessionKey`                               | `agentKey`       | the same                                                                                  |
| `sidebarDirectory`                         | `sidebarProject` | `/events`                                                                                 |
| `directory`                                | `project`        | `/api/project-agents`, `-index`, `-indexes` (repeated), `/api/machine/agents`             |
| `session` (page URL in notification links) | `agent`          | `agentLink` in `server.ts`: `/?agent=s12` and `/?machine=m&agent=s12`                     |

## Request bodies

| Old                                                        | New                                                | Route                               |
| ---------------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `directory`                                                | `project`                                          | `POST /api/project-agents/cleanup`  |
| `includeActiveSession`                                     | `includeActiveAgent`                               | `POST /api/project-agents/cleanup`  |
| `directories`, `pinnedSessionKeys`, `collapsedDirectories` | `projects`, `pinnedAgentKeys`, `collapsedProjects` | `POST /api/sidebar-state`, `/merge` |

`path` (for example `pico:s12`) and `cwd` stay.

## Response fields

| Old                                                        | New                                                | Route                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `sessions`                                                 | `agents`                                           | `/api/project-agents`, `/api/agents/archived`, `/api/machine/agents`, `/api/machine/agents/archived`, the `-index` snapshot |
| `directory`                                                | `project`                                          | `/api/project-agents`, `-index`, `/cleanup`, `/api/agent/restore`, archived entries                                         |
| `directories`, `directoryIndexes`                          | `projects`, `projectIndexes`                       | `/api/project-agents-indexes`                                                                                               |
| `deletedSessionIds`, `matchingSessions`                    | `deletedAgentIds`, `matchingAgents`                | `/api/project-agents/cleanup`                                                                                               |
| `sessionKey`                                               | `agentKey`                                         | `/api/agent/new`, `/api/agent/fork`                                                                                         |
| `sessionId`, `sessionPath`                                 | `agentId`, `agentPath`                             | `/api/prompt`                                                                                                               |
| `sessionId`                                                | `agentId`                                          | `/api/agent/move`, `/api/agent/extensions`, `/api/machine/agent/*`, jobs in `/api/resources`                                |
| `sessionFile`, `previousSessionFile`                       | `agentFile`, `previousAgentFile`                   | `/api/agent/fork`, `/api/agent/clone`                                                                                       |
| `directories`, `pinnedSessionKeys`, `collapsedDirectories` | `projects`, `pinnedAgentKeys`, `collapsedProjects` | `/api/sidebar-state` (also the `sidebar_state` event)                                                                       |
| `appliesToActiveSessionAfterRestart`                       | `appliesToActiveAgentAfterRestart`                 | `/api/settings/performance`                                                                                                 |
| `activeRunCount`                                           | `activeTurnCount`                                  | `/api/system/health`                                                                                                        |

## Events

| Old                         | New                       |
| --------------------------- | ------------------------- |
| `sessions`                  | `agents`                  |
| `session_status`            | `agent_status`            |
| `session_done`              | `agent_done`              |
| `session_extensions`        | `agent_extensions`        |
| `auto_session_naming_error` | `auto_agent_naming_error` |

Event fields:

| Old                                                        | New                                                  | Events                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `sessionId`, `sessionKey`, `sessionPath`                   | `agentId`, `agentKey`, `agentPath`                   | `agent_status`, `agent_done`                                                                          |
| `sessionId`                                                | `agentId`                                            | `agent_extensions` (`"*"` for a store-wide document), `auto_agent_naming_error`, `conversation_delta` |
| `activeSessionPath`, `activeSessionId`, `activeSessionKey` | `activeAgentPath`, `activeAgentId`, `activeAgentKey` | `agents`                                                                                              |
| `directories`, `directoryStates`, `directoryIndexes`       | `projects`, `projectStates`, `projectIndexes`        | `agents` (each state keeps `path`; each index has `project`, `agents`)                                |
| `sessionKey`, `sessionId`, `sessionFile`, `sessionName`    | `agentKey`, `agentId`, `agentFile`, `agentName`      | `state_sync`                                                                                          |
| `parentSession`                                            | `parentAgent`                                        | `state_sync`                                                                                          |
| `directory`                                                | `project`                                            | `state_sync`                                                                                          |
| `kind: "children"`                                         | `kind: "subagents"`                                  | `agent_extensions`                                                                                    |

`agent_status` and `agent_done` keep their other fields (`streaming`, `unread`, `needsInput`, `waiting`, `reason`, `outcome`, `title`, …).

## Agent panel state (`GET /api/agent/extensions`)

| Old                                | New               |
| ---------------------------------- | ----------------- |
| `sessionId`                        | `agentId`         |
| `state.children`                   | `state.subagents` |
| `state.session` (parent, worktree) | `state.agent`     |

The `registerState` provider keys (`todo`, `jobs`, `scratch`, `questions`, `browser`) do not change.

## Hub machine summary (`/api/machine/summary`, `machine_summary` events, `/api/machines`)

| Old                      | New        |
| ------------------------ | ---------- |
| `summary.directories`    | `projects` |
| `summary.sessions`       | `agents`   |
| `directory` (each agent) | `project`  |

## Manifest (`/api/client/manifest`)

- `capabilities.events`: `sessions`, `session_status`, `session_done`, `session_extensions` → `agents`, `agent_status`, `agent_done`, `agent_extensions`.
- `capabilities.features`: `durable-sessions` → `durable-agents`, `session-index` → `agent-index`, `session-mutations` → `agent-mutations`, `session-tree` → `conversation-tree`, `child-sessions` → `subagents`. `directory-discovery` stays (filesystem).
- `apiContractVersion`: 1 → 2. A hub needs 2 (`MIN_API_CONTRACT_VERSION`), so it asks to update a machine with the old API instead of calling routes that are gone.

## Stored names that stay

- Document kinds: `pico.session` (`AgentMetaDoc`), `pico.queue`, `pico.delivered`, `pico.jobs`, `pico.jobs.index`, `pico.questions`, `pico.todo`, `pico.browser`, `pico.pi-imports`. `scope: "session"` in `defineDoc` (pi-durable).
- Task names `pico.child-report` and `pico.remote-child-report`, and the stored task input fields `parent`, `child`, `childTitle`.
- The ID prefix `s` (`s12`), the path prefix `pico:` (`pico:s12`), and the key prefix `session:` (`agentKey()` gives `session:s12`; pins keep it).
- Request IDs `spawn:`, `send:`, `report:`, `stall:`, `hub:`.
- `~/.pico/sidebar.json`: `directories`, `pinnedSessionKeys`, `collapsedDirectories`. `SidebarState` maps them to `projects`, `pinnedAgentKeys`, `collapsedProjects`.
- `~/.pico/viewers.json`: `selectedSession`, `activeDraft.sessionKey`, `sidebarDirectories`. `Viewers` maps them to `selectedAgent`, `agentKey`, `sidebarProjects`.
- pi's names: `AgentDoc`, `ConversationId`, `conversationId`, pi's `session` header and `session_info` entries in `import-pi.ts`, `importPiSessions`, `~/.pi/agent/sessions`.
- Not renamed (other meanings): browser sessions in `services/browser.ts`, `child_process` and process children, the conversation tree's `children`, `cwd` and the filesystem routes.

## Differences from the plan and from the client

- Page URL: the plan does not name it. The server now makes `/?agent=s12`, as the client reads it. Links in notifications that were sent before the change have `?session=` and no longer open the agent.
- `/api/session-image/…` → `/api/agent-image/:agent/…`: not in the plan's table (it is not under `/api/session/`). The client does not build this URL.
- `parentSession` → `parentAgent` in `state_sync`, and `activeRunCount` → `activeTurnCount` in `/api/system/health`: not in the client's list, because the client does not read them.
- The `apiContractVersion` change is not in the plan. It makes a hub refuse an old machine with a clear message.
- The client's list and this list agree on all other names.

## Open points

- Saved tool limits in `pico.session` (`limits.add`, `limits.remove`) and the user's custom profiles in `settings.json` can hold the old names (`spawn_session`, `send_to_session`, `sessions.stop`, extension `sessions`). They no longer match a tool. A subagent from before the change has `spawn_session` removed, not `spawn_subagent`, until its profile is applied again (a profile or limits change). The plan accepts no backwards compatibility, so the server does not convert them.
- A saved conversation keeps calls to the old tool names in its history. The model sees them in old turns, but it can only call the new tools.
