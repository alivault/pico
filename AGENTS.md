# Agent Instructions

## Layout

- This is a pnpm monorepo.
  - `apps/smith`: the Smith app (`@alivault/smith`). Web client in `apps/smith/src`, server in `apps/smith/server` (`@smith/server`).
  - `apps/website`: the static website for smith.aliabbas.net. Plain HTML and CSS in `apps/website/site`. No build step. `apps/website/worker.js` only answers range requests for `/videos/*`, because static assets do not, and Safari needs them to play video.
- Take the website and README screenshots and the demo video again with `pnpm media` (`apps/smith/scripts/media/capture.mjs`; its header lists the options). It runs a real agent in its own Smith and data folder. Look at the files in the output folder, then copy them in with `pnpm media --install-only`. The README uses the website screenshots by URL (`https://smith.aliabbas.net/screenshots/...`), so deploy the website to update the README too. Then run `pnpm og-image` to make the link preview image (`apps/website/site/og.png`) from the new dark screenshot.
- Deploy the website with `pnpm website:deploy` (runs `pnpm dlx wrangler@4 deploy`, so wrangler is not a project dependency).

## Architecture

- Web client and machines: every request and machine storage key names its machine explicitly. Get the machine with `useMachineId()` (`lib/smith/machine-context.tsx`) or a `machineId` argument. Build URLs with `buildRequestUrl({ machineId, ... })`, or with `hubUrl` or `buildHubRequestUrl` for hub data. `scripts/check-api-urls.mjs` guards this.
- The route keeps one `SmithAppShell` per opened machine in a React `Activity` (`routes/index.tsx`). Floating UI renders into a per-shell portal container (`components/ui/portal-container.tsx`).
- Import `toast` from `@/lib/smith/toast`, not from `sonner`. The wrapper merges the toasts about an offline machine into one.
- Window state stays out of the shells: one copy for the page. The left sidebar is `WindowSidebar` (`features/smith/window-sidebar.tsx`), drawn one time in the route with a heading for each machine. The shown shell fills its slots with portals (`features/smith/sidebar-slots.ts`). The theme store (`use-smith-theme.ts`) and the machines dialog are also window level. Machine actions take a machine ID; do not show them only for the shown machine.

## Tooling

- The Smith app uses Vite+ (`vp`). Do not use Prettier or ESLint directly. The config is in `apps/smith/vite.config.ts`. Run `vp` commands from `apps/smith`. To format files outside `apps/smith` (for example the README or the website), run `pnpm exec vp fmt -c apps/smith/vite.config.ts <files>` from the repo root.
  - Format: `pnpm exec vp fmt <files>`. Prettier uses a different style and reformats whole files.
  - Lint and type check: `pnpm exec vp lint <files>`. `apps/smith/vite.config.ts` sets `typeAware` and `typeCheck`, so lint also reports TypeScript errors in the web code. You do not need a separate `tsc` run.
  - `vp check` stops at the first failing step. Format errors stop it before lint and type checks, so keep all files formatted.
  - Full check: `pnpm check` from the repo root (runs `vp check`, the server type check, and the server tests).
- Format only the files you changed, then look at `git diff` to make sure `vp fmt` did not change unrelated lines.
- Server: `pnpm --filter @smith/server typecheck` and `pnpm test`. The tests build `apps/smith/server/dist` first.
- To load a new server build into a running Smith (`pnpm start`, or an installed `smith`), run `smith restart` (or `pnpm start restart`), or use Settings, Server. It restarts at once; turns that it cuts off continue. A launcher (`bin/smith.mjs`, `build.mjs --watch`) starts the server again when it exits with code 75; a server without one starts itself in the background.
- After each change to the web client (`apps/smith/src`), rebuild the production web with `pnpm build:web` from `apps/smith` in the main checkout. This updates the web on port 3141. Work in a worktree gets this rebuild after it is merged to `main`.
- When Smith runs from `pnpm dev`, the server restarts after each successful rebuild. This includes changes to `apps/smith/server/src/**`, `apps/smith/server/package.json`, and dependency installs. A restart stops the current agent turn. Group these edits so the server rebuilds less often, and expect the turn to stop after them.
- When a Smith of this checkout already runs on the data directory (for example from `pnpm start`), `pnpm dev` does not start a second server. After each server rebuild, it asks that Smith to restart at once. Another Smith (as an installed `smith`) does not load the changes: `pnpm dev` prints a warning.

## Releases

When the user says "release a new patch, minor, or major version":

1. Make sure the working tree is clean. Commit or ask about uncommitted changes first.
2. From the repo root, run `pnpm release patch` (or `minor` or `major`). `pnpm release <version>` sets an exact version, for example a prerelease such as `1.2.0-beta.1`.
   - The script (`apps/smith/scripts/release.mjs`) checks that you are on an up-to-date `main`, runs `pnpm check`, sets the version in `apps/smith/package.json` and `apps/smith/server/package.json`, builds (this also updates the local production web on port 3141), commits `release v<version>`, tags `v<version>`, and pushes the branch and the tag together.
   - Use `--no-push` to stop before the push.
3. The tag push starts `.github/workflows/release.yml`. It checks the code, publishes to npm with trusted publishing (no OTP), and creates the GitHub release with generated notes. Prerelease versions get the npm `next` tag.
4. Watch the run with `gh run watch $(gh run list -w release.yml -L 1 --json databaseId -q '.[0].databaseId')`. Report the result. If a step fails, fix the cause and run `gh run rerun --failed <id>`. The publish and release steps skip work that is already done.
