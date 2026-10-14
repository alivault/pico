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

When the user says "release a new patch, minor, or major version":

1. Make sure the working tree is clean. Commit or ask about uncommitted changes first.
2. From the repo root, run `pnpm release patch` (or `minor` or `major`). `pnpm release <version>` sets an exact version, for example a prerelease such as `1.2.0-beta.1`.
   - The script (`apps/pico/scripts/release.mjs`) checks that you are on an up-to-date `main`, runs `pnpm check`, sets the version in `apps/pico/package.json` and `apps/pico/server/package.json`, builds (this also updates the local production web on port 3141), commits `release v<version>`, tags `v<version>`, and pushes the branch and the tag together.
   - Use `--no-push` to stop before the push.
3. The tag push starts `.github/workflows/release.yml`. It checks the code, publishes to npm with trusted publishing (no OTP), and creates the GitHub release with generated notes. Prerelease versions get the npm `next` tag.
4. Watch the run with `gh run watch $(gh run list -w release.yml -L 1 --json databaseId -q '.[0].databaseId')`. Report the result. If a step fails, fix the cause and run `gh run rerun --failed <id>`. The publish and release steps skip work that is already done.
