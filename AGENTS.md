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
