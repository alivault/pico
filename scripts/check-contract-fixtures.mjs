#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { currentRouteInventory } from "./update-route-inventory.mjs"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fixturesDir = join(root, "apps", "apple", "Fixtures")

async function fixture(name) {
  return JSON.parse(await readFile(join(fixturesDir, `${name}.json`), "utf8"))
}

function invariant(condition, message) {
  if (!condition) throw new Error(`Contract fixture invariant failed: ${message}`)
}

const [
  manifest,
  initial,
  patch,
  sessions,
  piEvents,
  terminalEvents,
  gitStatus,
  picoEvents,
  apiResponses,
  expectedRoutes,
  actualRoutes,
] = await Promise.all([
    fixture("client_manifest"),
    fixture("state_sync_initial"),
    fixture("state_sync_patch"),
    fixture("sessions_event"),
    fixture("pi_rpc_events"),
    fixture("terminal_events"),
    fixture("git_status_response"),
    fixture("pico_events"),
    fixture("api_responses"),
    fixture("route_inventory"),
    currentRouteInventory(),
  ])

invariant(
  JSON.stringify(actualRoutes) === JSON.stringify(expectedRoutes),
  "route inventory is stale; run node scripts/update-route-inventory.mjs"
)

invariant(manifest.ok === true, "manifest must be successful")
invariant(
  manifest.apiContractVersion === 1,
  "manifest API contract version must remain explicit"
)
invariant(
  manifest.capabilities.events.includes("state_sync"),
  "manifest must advertise state_sync"
)
invariant(
  manifest.capabilities.endpoints.includes("/events"),
  "manifest must advertise /events"
)

invariant(initial.type === "state_sync", "initial event type")
invariant(Array.isArray(initial.items), "initial state must contain full items")
invariant(patch.type === "state_sync", "patch event type")
invariant(
  patch.itemsPatch.previousLength === initial.items.length,
  "patch previousLength must match initial items"
)
invariant(
  patch.itemsPatch.start + patch.itemsPatch.deleteCount <= initial.items.length,
  "patch replacement range must be valid"
)

invariant(sessions.type === "sessions", "sessions event type")
for (const directory of sessions.directories) {
  invariant(
    sessions.directoryIndexes[directory]?.directory === directory,
    `sessions index must exist for ${directory}`
  )
}

invariant(
  piEvents.some((event) => event.type === "message_update"),
  "Pi fixtures must include streaming text"
)
invariant(
  piEvents.some((event) => event.type === "extension_ui_request"),
  "Pi fixtures must include extension UI"
)
invariant(
  terminalEvents[0]?.type === "ready" &&
    terminalEvents.at(-1)?.type === "exit",
  "terminal fixture must cover ready through exit"
)
invariant(
  gitStatus.ok === true && typeof gitStatus.gitStatus?.dirty === "boolean",
  "Git fixture must include status"
)
for (const eventType of manifest.capabilities.events) {
  invariant(
    eventType === "state_sync" ||
      eventType === "sessions" ||
      picoEvents.some((event) => event.type === eventType),
    `missing representative SSE event ${eventType}`
  )
}
invariant(
  Object.keys(apiResponses).length >= 10 &&
    Object.values(apiResponses).every(
      (response) => response && typeof response === "object"
    ),
  "API response fixtures must cover representative domains"
)

console.log("Contract fixtures are valid.")
