# Agent Instructions

- Always commit after every change. Write a short commit message that says what the change does.

## Tooling

- This project uses Vite+ (`vp`). Do not use Prettier or ESLint directly.
  - Format: `pnpm exec vp fmt <files>`. Prettier uses a different style and reformats whole files.
  - Lint: `pnpm exec vp lint <files>`.
  - Full check: `pnpm check` (runs `vp check`, the server type check, and the server tests).
- Format only the files you changed. Some files have old formatting issues, and `vp fmt` can change lines that are not yours. Look at `git diff` and undo changes to unrelated lines.
- Server: `pnpm --filter @pico/server typecheck` and `pnpm test`. The tests build `server/dist` first.
