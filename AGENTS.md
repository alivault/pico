# Agent Instructions

- Always commit after every change. Write a short commit message that says what the change does.

## Layout

- This is a pnpm monorepo.
  - `apps/pico`: the Pico app (`@alivault/pico`). Web client in `apps/pico/src`, server in `apps/pico/server` (`@pico/server`).
  - `apps/website`: the static website for pico.aliabbas.net. Plain HTML and CSS in `apps/website/site`. No build step.
- Deploy the website with `pnpm website:deploy` (runs `wrangler deploy`).

## Tooling

- The Pico app uses Vite+ (`vp`). Do not use Prettier or ESLint directly. The config is in `apps/pico/vite.config.ts`. Run `vp` commands from `apps/pico`. To format files outside `apps/pico` (for example the README or the website), run `pnpm exec vp fmt -c apps/pico/vite.config.ts <files>` from the repo root.
  - Format: `pnpm exec vp fmt <files>`. Prettier uses a different style and reformats whole files.
  - Lint and type check: `pnpm exec vp lint <files>`. `apps/pico/vite.config.ts` sets `typeAware` and `typeCheck`, so lint also reports TypeScript errors in the web code. You do not need a separate `tsc` run.
  - `vp check` stops at the first failing step. Format errors stop it before lint and type checks, so keep all files formatted.
  - Full check: `pnpm check` from the repo root (runs `vp check`, the server type check, and the server tests).
- Format only the files you changed, then look at `git diff` to make sure `vp fmt` did not change unrelated lines.
- Server: `pnpm --filter @pico/server typecheck` and `pnpm test`. The tests build `apps/pico/server/dist` first.

## Releases

When the user says "release a new patch, minor, or major version", do all of these steps from `apps/pico`:

1. Read the current version in `apps/pico/package.json` and increase the patch, minor, or major number (for example, patch `1.0.1` -> `1.0.2`, minor -> `1.1.0`, major -> `2.0.0`).
2. Make sure the working tree is clean. Commit or ask about uncommitted changes first.
3. Run `pnpm build:web` so the local production web (port 3141) uses the latest client.
4. Run `pnpm release <version>`. It runs `pnpm check`, sets the version in `package.json` and `server/package.json`, builds, and does an `npm pack` dry run. It does not commit, tag, push, or publish.
5. Commit the two `package.json` files with the message `release v<version>`.
6. Make a lightweight tag `v<version>` and push the branch and the tag together: `git push --atomic origin main v<version>`.
7. Publish with `pnpm publish --no-git-checks` in a terminal that the user can see (for example, a Herdr pane). npm asks for web authentication. Press Enter to open the sign-in page, and wait for the user to approve it. A non-interactive shell fails with `EOTP`.
8. Look for `+ @alivault/pico@<version>` in the output. `npm view @alivault/pico version` can show the old version for a few minutes.
