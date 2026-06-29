# Native SwiftUI iOS Client Plan for Pico

_Last updated: 2026-06-19_

## 1. Goal

Build a native SwiftUI iOS app that acts as a first-class mobile client for Pico. The app should connect to a running Pico server, show live Pi sessions, stream conversation updates, and let users submit prompts from iPhone and iPad without using the browser UI.

## 2. Core product decision

The iOS app should be a **native client for an existing Pico runtime**, not a replacement runtime on device.

Why:

- Pico currently owns the Pi SDK runtime, session state, project filesystem access, git tooling, provider auth, and SSE event stream on the server side.
- iOS cannot safely or realistically run the current Node/Nitro/Pi SDK process, spawn local shell tools, or access arbitrary desktop project directories.
- Keeping the runtime on the Mac/dev machine preserves Pico's current behavior and lets the iOS app focus on mobile UX.

Initial topology:

```text
SwiftUI iOS app  <-- HTTP JSON + SSE -->  Pico server  <-- Pi SDK / git / filesystem
```

## 3. MVP scope

### Must have

- Server connection setup for a Pico instance running on the user's machine or a trusted remote host.
- Persistent client context id, equivalent to the browser's `pico-context-id`.
- Live SSE connection to `/events`.
- Directory/session browsing.
- Session selection and initial state sync.
- Conversation rendering for user, assistant, thinking, tool, and compaction blocks.
- Prompt composer with submit, abort, queue/follow-up, and steer behavior.
- Model and thinking-level selection.
- Basic session actions: new session, rename, delete, mark read/unread.
- Foreground reconnect/resume behavior.
- iPhone and iPad layouts using SwiftUI.

### Should have after MVP

- Image attachments through PhotosUI and camera/library imports.
- Slash command assistance and `@file`/path completions.
- Provider login/logout flows driven by existing Pico auth endpoints and UI requests.
- Local notifications for session completion while the app is foregrounded/recently active.
- Project file viewer and lightweight git status.

### Later / optional

- Rich git review, changed-file diffs, commit history, stage/discard/commit/push/pull.
- Bonjour/local-network discovery of Pico servers.
- Secure remote access/tunnel story.
- Push notifications, if Pico later gains a trusted push relay or APNs integration.
- Native syntax highlighting or richer Markdown rendering, after evaluating whether first-party APIs are sufficient.

## 4. Non-goals for the first native release

- Do not embed the Pi SDK runtime in the iOS app.
- Do not require React Native, Expo, or a WebView wrapper.
- Do not expose the current Pico server on a public network without adding client authentication/pairing first.
- Do not reimplement all desktop right-sidebar Git tools before conversation and session workflows are solid.
- Do not add third-party iOS frameworks initially unless we deliberately approve them later.

## 5. Current Pico API surface to reuse

The iOS app should use the same server contracts as the browser app where possible.

Important conventions:

- Most client requests must include `context=<viewerContextId>`.
- Session-scoped requests should include `session=<sessionId>` when available.
- `/events` is the live source of truth.
- `state_sync` events are patch-friendly; follow-up events may omit unchanged fields.
- `state_sync.itemsPatch` must be applied against the current authoritative conversation items.
- Session lists and status overlays arrive through SSE as well as API responses.

Primary endpoints/events:

| Area             | Pico API                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live sync        | `GET /events?context=...&session=...&lastEventId=...`                                                                                                                              |
| Prompting        | `POST /api/prompt`, `POST /api/abort`                                                                                                                                              |
| Sessions         | `/api/session/new`, `/api/session/select`, `/api/session/rename`, `/api/session/delete`, `/api/session/read-state`, `/api/session/tree`, `/api/session/fork`, `/api/session/clone` |
| Session lists    | `/api/directory-sessions`, `/api/directory-sessions-index`, `/api/directory-sessions-indexes`                                                                                      |
| Model/thinking   | `/api/model`, `/api/thinking`, `/api/settings/hide-thinking`                                                                                                                       |
| Composer helpers | `/api/slash-command`, `/api/path-completions`, `/api/file-completions`                                                                                                             |
| Files/Git later  | `/api/files/tree`, `/api/files/read`, `/api/git-status`, `/api/git-changes`, `/api/git-diff`, `/api/git-review`, commit/push/pull routes                                           |
| Auth later       | `/api/auth/providers`, `/api/auth/api-key`, `/api/auth/oauth`, `/api/auth/logout`, `/api/ui/$id`                                                                                   |

## 6. Required server-side work

### 6.1 Add a mobile/client capability endpoint

Add a small endpoint, for example `GET /api/client/manifest`, returning:

- Pico version.
- Server display name.
- Whether pairing/auth is required.
- Supported API contract version.
- Supported event types/capabilities.
- Whether the server allows local HTTP or requires HTTPS.

This lets the iOS app show useful connection errors instead of failing on the first SSE/API call.

### 6.2 Add client authentication before LAN/remote use

The existing Pico app is designed as a local browser workspace. Before encouraging `--host 0.0.0.0` or remote access, add a lightweight pairing layer:

1. User starts Pico locally.
2. Desktop Pico shows a pairing code or QR code.
3. iOS app submits the code to a pairing endpoint.
4. Server returns a scoped client token.
5. iOS stores the token in Keychain.
6. API/SSE requests send `Authorization: Bearer <token>`.
7. Server exposes a way to revoke paired clients.

Suggested endpoints:

- `POST /api/client/pairing/start`
- `POST /api/client/pairing/complete`
- `GET /api/client/devices`
- `DELETE /api/client/devices/:id`

Keep token validation centralized in server route helpers/runtime request resolution so existing endpoints do not each grow one-off auth logic.

### 6.3 Document and fixture the shared contract

Create a machine-readable or fixture-backed contract for Swift decoding:

- Representative `state_sync` full payload.
- Representative `state_sync` patch payload.
- `sessions`, `session_status`, `session_done`, `extension_ui_request`, `git_changed`, and error events.
- Success/error JSON responses for key endpoints.

Swift tests should decode these fixtures to catch contract drift.

### 6.4 Mobile-friendly history/pagination later

The browser currently renders from full `state_sync.items`, with `/api/session/history` still available for raw paginated history. For mobile, keep MVP simple with initial `state_sync`; later add mobile-friendly history paging if large sessions become slow.

## 7. iOS app architecture

### 7.1 Platform baseline

- Native SwiftUI app.
- Swift 6.2 or newer.
- iOS 26 default deployment target for a new app, unless product distribution requires lowering it.
- First-party Apple frameworks only at first: SwiftUI, Observation, Foundation, PhotosUI, UserNotifications, Security/Keychain, Network where needed.
- Avoid UIKit unless a specific capability requires it.

### 7.2 Proposed repo layout

```text
apps/ios/
  SWIFTUI_CLIENT_PLAN.md
  Pico/
    Pico.xcodeproj
    Pico/
      PicoApp.swift
      App/
        RootView.swift
        AppModel.swift
      Core/
        API/
          PicoAPIClient.swift
          PicoEndpoint.swift
          PicoAPIError.swift
        Events/
          SSEClient.swift
          SSEEventParser.swift
          PicoEventStream.swift
        Models/
          SessionState.swift
          ConversationItem.swift
          SessionListEntry.swift
          PicoServerEvent.swift
          APIResponses.swift
        Persistence/
          ConnectionStore.swift
          CredentialStore.swift
          DraftStore.swift
        Utilities/
          ImageEncoding.swift
          DateFormatting.swift
      Features/
        Connections/
        Sessions/
        Conversation/
        Composer/
        Settings/
        Auth/
        Git/
      Resources/
        Assets.xcassets
        Info.plist
    PicoTests/
    PicoUITests/
```

Keep types split into focused files rather than large multi-type files.

### 7.3 State and concurrency model

Use SwiftUI + Observation with actor-backed networking:

- `@Observable AppModel`: selected server, active context id, high-level app phase.
- `@Observable SessionStore`: active `SessionState`, session list snapshots, selected session.
- `@Observable ComposerStore`: draft text, images, selected skill/model/thinking, pending messages.
- `actor PicoAPIClient`: JSON request execution and response validation.
- `actor PicoEventStream`: SSE lifecycle, reconnect/backoff, last-event-id persistence.
- `CredentialStore`: Keychain-backed token storage.

Rules:

- Apply server events on the main actor only after decoding and validation.
- Keep request building centralized so every call includes `context` and optional `session` consistently.
- Treat SSE as authoritative; do not add polling except for explicit reconnect/bootstrap recovery.
- Persist prompt drafts locally per server/context/session, similar to browser draft ownership.

## 8. Native UI plan

### 8.1 Navigation

Use adaptive SwiftUI navigation:

- iPhone: `NavigationStack` with session list -> conversation -> details/settings.
- iPad: `NavigationSplitView` with sidebar sessions, conversation, optional detail column.
- Hardware keyboard shortcuts for common actions: new prompt, new session, search sessions, abort, settings.

### 8.2 Session browser

- Directory sections matching Pico's directory-organized sessions.
- Search via server-backed session search or local filtering of loaded indexes.
- Session row status: title, cwd/directory, last message preview, streaming/unread badges, context usage if available.
- Pull-to-refresh should reconnect/revalidate active queries, not replace SSE as source of truth.

### 8.3 Conversation view

Render `ConversationItem` natively:

- User bubbles with attached image thumbnails.
- Assistant responses as grouped blocks.
- Thinking blocks collapsed/hidden according to server/user setting.
- Tool blocks collapsed by default with name/status/output preview.
- Compaction cards with summary and token count.
- Streaming assistant block updates in place.
- Scroll-to-bottom behavior that respects whether the user has manually scrolled away.

For Markdown:

- MVP: use `AttributedString(markdown:)` for basic Markdown where it works well.
- Render fenced code blocks as monospace cards with copy buttons.
- Evaluate richer Markdown/syntax highlighting later; do not add dependencies without a separate decision.

### 8.4 Composer

- Multiline text editor with send/stop button.
- Prompt submission maps to `/api/prompt`.
- If active session is streaming, support follow-up queue and steer behavior.
- Pending queued prompts can be removed/reordered using existing pending-message endpoints.
- Model and thinking pickers map to existing model/thinking endpoints.
- Image attachment support after text MVP using PhotosUI and base64 payloads matching `PromptImage`.

### 8.5 Auth and server-driven UI requests

Provider auth can be phased in after the core session loop:

- Fetch providers from `/api/auth/providers`.
- API-key providers use a secure input sheet and submit to `/api/auth/api-key`.
- OAuth providers open `authUrl` in the system browser and rely on server-side completion.
- Handle `extension_ui_request` events with SwiftUI sheets/alerts for `confirm`, `input`, `select`, `auth`, `auth_input`, `auth_select`, `editor`, and `notify`.

## 9. Networking details

### 9.1 Request builder

Create a single Swift request builder equivalent to browser `buildRequestUrl()`:

- Base URL from selected Pico server.
- Always append `context`.
- Append `session` when scoped to a session.
- Append extra query parameters safely.
- Attach bearer token when paired.
- Decode `{ ok: false, error: string }` into a typed Swift error.

### 9.2 SSE client

Implement SSE using `URLSession` streaming bytes:

- Parse `id:`, `event:`, `data:`, `retry:`, and blank-line dispatch.
- Store last event id per server/context.
- Reconnect with exponential backoff and `lastEventId` query parameter.
- Reset/reconnect when selected server, context, or initial session changes.
- On foreground after backgrounding, reconnect and invalidate active derived data.

### 9.3 Local network and transport security

- For local HTTP development, configure the minimum necessary App Transport Security exception.
- For LAN discovery/access, add `NSLocalNetworkUsageDescription` and Bonjour service declarations if discovery is implemented.
- For remote access, prefer HTTPS or a trusted tunnel. Do not ask users to expose an unauthenticated HTTP server.

## 10. Data model translation notes

Swift models should mirror the shared TypeScript contracts but be resilient to unknown fields.

Important model behavior:

- `PicoServerEvent` should decode a discriminated union by `type`.
- `SessionState` fields are patchable; missing values mean "keep previous" for follow-up syncs.
- `ConversationItem` should decode `kind: "user" | "assistant"`.
- `AssistantBlock` should decode `type: "text" | "thinking" | "tool" | "compaction"`.
- Unknown event/block fields should be preserved only if needed for future compatibility; otherwise ignore safely.
- Images use MIME type + base64 data, matching Pico's `PromptImage` contract.

Port the browser's `updateStateFromSync()` behavior to Swift tests before building much UI. This is the most important correctness step for streaming.

## 11. Milestones

### Phase 0: Contract and security design

- Decide whether MVP is local-only, LAN, or remote-capable.
- Add/define `/api/client/manifest`.
- Design pairing/token auth if LAN/remote is in scope.
- Add JSON fixtures for event/response contracts.
- Write a short API compatibility policy for native clients.

Exit criteria:

- iOS can discover/check a server manifest.
- We know whether auth is required for the first build.
- Fixture samples exist for Swift decoder tests.

### Phase 1: Native app skeleton

- Create the SwiftUI Xcode project under `apps/ios/Pico`.
- Add app icon placeholders and basic Info.plist privacy strings.
- Implement connection entry screen.
- Implement Keychain token storage and UserDefaults connection history.
- Implement centralized API request builder.

Exit criteria:

- App launches, stores a server URL, checks the manifest, and shows connection state.

### Phase 2: SSE and session state

- Implement SSE parser/client.
- Decode all MVP event types.
- Implement `SessionState` merge logic, including `itemsPatch`.
- Add tests from fixtures.
- Show a minimal live debug view of active session state.

Exit criteria:

- App connects to `/events`, receives initial `state_sync`, applies patches, and reconnects after interruption.

### Phase 3: Session list and conversation UI

- Implement directory/session list UI.
- Implement session selection through `/api/session/select`.
- Render conversation items in SwiftUI.
- Add streaming scroll behavior.
- Add basic settings for hiding thinking/tool blocks locally or through existing server settings where appropriate.

Exit criteria:

- User can choose a session and watch a live conversation stream on iPhone/iPad.

### Phase 4: Composer loop

- Implement prompt composer and submit to `/api/prompt`.
- Implement abort through `/api/abort`.
- Support queued follow-up and steer while streaming.
- Implement pending prompt removal/reorder if exposed in UI.
- Add model/thinking pickers.

Exit criteria:

- User can run a complete coding-agent prompt cycle from iOS: submit, stream, abort/queue/steer, complete.

### Phase 5: Mobile polish and session management

- New session flow.
- Rename/delete/read/unread flows.
- Draft persistence per server/context/session.
- Empty/loading/error states.
- Foreground/background reconnect polish.
- Accessibility pass: Dynamic Type, VoiceOver labels, Reduce Motion, sufficient contrast.

Exit criteria:

- Core session management feels native and reliable.

### Phase 6: Auth, files, and Git expansion

- Provider auth surfaces.
- Server-driven UI request sheets/alerts.
- Project file tree/read-only viewer.
- Git status and changed files.
- Lightweight patch/diff viewer.
- Later: stage/discard/commit/push/pull when mobile UX is clear.

Exit criteria:

- Native app covers the most useful desktop companion workflows beyond chat.

### Phase 7: Release hardening

- Unit tests for decoding, state merge, SSE parsing, request building.
- UI tests for connection, session select, prompt submit, settings.
- Manual tests against a real Pico dev server.
- TestFlight build.
- Privacy review for local network, Keychain, photos, notifications.
- Documentation for running Pico in a client-accessible mode.

Exit criteria:

- Internal TestFlight users can install the app and connect to a real Pico server safely.

## 12. Key risks and mitigations

| Risk                                                             | Mitigation                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Current Pico server is local-first and may not be safe to expose | Add pairing/token auth before LAN/remote instructions                 |
| SSE streaming and patch sync drift from web behavior             | Port `updateStateFromSync()` semantics and cover with fixtures/tests  |
| iOS backgrounding kills long-lived streams                       | Reconnect on foreground; consider notifications later                 |
| Large sessions may be heavy on mobile                            | Start with current sync, then add mobile history pagination if needed |
| Markdown/code rendering quality                                  | Use first-party rendering first; evaluate dependencies separately     |
| Provider OAuth UX differs from desktop                           | Use system browser and server-driven UI request handling              |
| Git workflows are complex on small screens                       | Ship read-only status/diff first, then add mutations deliberately     |

## 13. Open questions

1. Should the first build support only `localhost` via simulator/Mac, LAN devices, or remote hosts?
2. Should pairing/auth be mandatory even for LAN development?
3. What minimum iOS version should we target for distribution if iOS 26 is too new for users?
4. Should the iOS app be distributed publicly, through TestFlight only, or kept as a developer companion?
5. Which desktop settings should sync to the iOS app versus remain device-local?
6. How much Git power should be exposed on mobile before it becomes risky?
7. Do we need a formal OpenAPI/JSON Schema generator, or are fixture-backed Swift tests enough initially?

## 14. First implementation checklist

- [ ] Add `/api/client/manifest` route and response type.
- [ ] Decide local-only vs paired LAN MVP.
- [ ] Add representative JSON fixtures for SSE/API contracts.
- [ ] Create `apps/ios/Pico` SwiftUI project.
- [ ] Implement `PicoAPIClient` and request builder.
- [ ] Implement `SSEEventParser` with unit tests.
- [ ] Implement Swift models for session state and events.
- [ ] Port `state_sync` merge and `itemsPatch` behavior.
- [ ] Build connection screen.
- [ ] Build session list.
- [ ] Build conversation renderer.
- [ ] Build composer submit/abort.
- [ ] Smoke test against `pnpm dev` / `pico-app --host <trusted-host>`.
