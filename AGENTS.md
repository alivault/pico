# Agent Instructions

- Always commit after every change. Write a short commit message that says what the change does.

## Tooling

- This project uses Vite+ (`vp`). Do not use Prettier or ESLint directly.
  - Format: `pnpm exec vp fmt <files>`. Prettier uses a different style and reformats whole files.
  - Lint and type check: `pnpm exec vp lint <files>`. `vite.config.ts` sets `typeAware` and `typeCheck`, so lint also reports TypeScript errors in the web code. You do not need a separate `tsc` run.
  - `vp check` stops at the first failing step. Format errors stop it before lint and type checks, so keep all files formatted.
  - Full check: `pnpm check` (runs `vp check`, the server type check, and the server tests).
- Format only the files you changed, then look at `git diff` to make sure `vp fmt` did not change unrelated lines.
- Server: `pnpm --filter @pico/server typecheck` and `pnpm test`. The tests build `server/dist` first.
