import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createFileRoute } from "@tanstack/react-router"

import type { ClientManifestResponse } from "@/lib/pico/api"

import { jsonResponse } from "@/server/http"
import { routeErrorResponse } from "@/server/route-helpers"

const API_CONTRACT_VERSION = 1

function readPicoPackageVersion() {
  let currentDir = dirname(fileURLToPath(import.meta.url))

  while (currentDir && currentDir !== dirname(currentDir)) {
    const packageJsonPath = join(currentDir, "package.json")
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          readFileSync(packageJsonPath, "utf8")
        ) as {
          name?: unknown
          version?: unknown
        }
        if (
          packageJson.name === "@alivault/pico" &&
          typeof packageJson.version === "string"
        ) {
          return packageJson.version
        }
      } catch {
        return "0.0.0"
      }
    }

    currentDir = dirname(currentDir)
  }

  return "0.0.0"
}

function buildClientManifest(): ClientManifestResponse {
  return {
    ok: true,
    name: "@alivault/pico",
    version: readPicoPackageVersion(),
    displayName: "Pico",
    apiContractVersion: API_CONTRACT_VERSION,
    pairingRequired: false,
    authentication: {
      type: "none",
    },
    transport: {
      sse: true,
      httpsRequired: false,
      localHttpAllowed: true,
    },
    capabilities: {
      events: [
        "state_sync",
        "sessions",
        "session_status",
        "session_done",
        "request_error",
        "extension_error",
        "extension_ui_request",
        "user_message",
        "auto_session_naming_error",
        "git_changed",
      ],
      endpoints: [
        "/events",
        "/api/prompt",
        "/api/abort",
        "/api/session/new",
        "/api/session/select",
        "/api/session/fork",
        "/api/session/name",
        "/api/session/rename",
        "/api/session/delete",
        "/api/session/read-state",
        "/api/directory-sessions-indexes",
        "/api/directory/resolve",
        "/api/directory-search",
        "/api/path-completions",
        "/api/model",
        "/api/thinking",
        "/api/auth/providers",
        "/api/auth/api-key",
        "/api/auth/oauth",
        "/api/auth/logout",
        "/api/ui/$id",
        "/api/settings/hide-thinking",
        "/api/pending-message/remove",
        "/api/pending-messages/reorder",
        "/api/pending-messages/start",
      ],
      features: [
        "sse",
        "session-browser",
        "conversation",
        "prompt-composer",
        "queue-and-steer",
        "model-selection",
        "thinking-selection",
        "provider-authentication",
        "native-directory-browser",
        "post-compaction-token-estimates",
        "edit-user-message-fork",
        "assistant-message-actions",
      ],
    },
  }
}

export const Route = createFileRoute("/api/client/manifest")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return jsonResponse(buildClientManifest())
        } catch (error) {
          return routeErrorResponse(error, "Failed to build client manifest")
        }
      },
    },
  },
})
