# Agent Instructions

- Always commit after every change. Write a short commit message that says what the change does.

## Tooling

- This project uses Vite+ (`vp`). Do not use Prettier or ESLint directly.
  - Format: `pnpm exec vp fmt <files>`. Prettier uses a different style and reformats whole files.
  - Lint and type check: `pnpm exec vp lint <files>`. `vite.config.ts` sets `typeAware` and `typeCheck`, so lint also reports TypeScript errors in the web code. You do not need a separate `tsc` run.
  - `vp check` stops at the first failing step. Format errors stop it before lint and type checks. To type check while old format errors exist, use `pnpm exec vp check --no-fmt`.
  - Full check: `pnpm check` (runs `vp check`, the server type check, and the server tests).
- Format only the files you changed. Some files have old formatting issues, and `vp fmt` can change lines that are not yours. Look at `git diff` and undo changes to unrelated lines.
- Server: `pnpm --filter @pico/server typecheck` and `pnpm test`. The tests build `server/dist` first.
