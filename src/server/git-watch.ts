import { watch, type FSWatcher } from "node:fs"
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { Debouncer } from "@tanstack/pacer"

import {
  resolveDirectoryGitRepository,
  type GitRepositoryInfo,
} from "@/server/git"

export type GitWatchChange = {
  cwd: string
  repositoryRoot: string
}

type DirectoryWatchState = {
  cwd: string
  generation: number
  repoKey?: string
}

type RepositoryWatchState = {
  key: string
  repositoryRoot: string
  subscribers: Set<string>
  watchers: Set<FSWatcher>
  disposed: boolean
  changeDebouncer: Debouncer<() => void>
}

const GIT_WATCH_DEBOUNCE_MS = 300

function normalizeWatchCwd(cwd: string) {
  const trimmed = typeof cwd === "string" ? cwd.trim() : ""
  return trimmed ? resolve(trimmed) : ""
}

function repositoryWatchKey(repository: GitRepositoryInfo) {
  return [repository.root, repository.gitDir, repository.gitCommonDir].join(
    "\u0000"
  )
}

function uniqueWatchPaths(repository: GitRepositoryInfo) {
  return [repository.root, repository.gitDir, repository.gitCommonDir].reduce<
    Array<string>
  >((paths, path) => {
    const normalized = path ? resolve(path) : ""
    if (normalized && !paths.includes(normalized)) {
      paths.push(normalized)
    }
    return paths
  }, [])
}

export class GitWatchManager {
  private readonly directories = new Map<string, DirectoryWatchState>()
  private readonly repositories = new Map<string, RepositoryWatchState>()

  constructor(private readonly onChange: (change: GitWatchChange) => void) {}

  setWatchedDirectories(cwds: Iterable<string>) {
    const desiredCwds = new Set<string>()
    for (const cwd of cwds) {
      const normalizedCwd = normalizeWatchCwd(cwd)
      if (normalizedCwd) {
        desiredCwds.add(normalizedCwd)
      }
    }

    for (const cwd of this.directories.keys()) {
      if (!desiredCwds.has(cwd)) {
        this.removeDirectory(cwd)
      }
    }

    for (const cwd of desiredCwds) {
      if (!this.directories.has(cwd)) {
        this.addDirectory(cwd)
      }
    }
  }

  dispose() {
    for (const cwd of Array.from(this.directories.keys())) {
      this.removeDirectory(cwd)
    }
    for (const repository of Array.from(this.repositories.values())) {
      this.disposeRepository(repository)
    }
  }

  private addDirectory(cwd: string) {
    const state: DirectoryWatchState = {
      cwd,
      generation: 0,
    }
    this.directories.set(cwd, state)
    void this.resolveDirectory(state)
  }

  private removeDirectory(cwd: string) {
    const state = this.directories.get(cwd)
    if (!state) return

    state.generation += 1
    this.directories.delete(cwd)

    if (!state.repoKey) return

    const repository = this.repositories.get(state.repoKey)
    if (!repository) return

    repository.subscribers.delete(cwd)
    if (repository.subscribers.size === 0) {
      this.disposeRepository(repository)
    }
  }

  private async resolveDirectory(state: DirectoryWatchState) {
    const generation = state.generation
    if (this.directories.get(state.cwd) !== state) return

    const repository = await resolveDirectoryGitRepository(state.cwd).catch(
      () => null
    )
    if (!repository) return
    if (this.directories.get(state.cwd) !== state) return
    if (state.generation !== generation) return

    const repoKey = repositoryWatchKey(repository)
    state.repoKey = repoKey

    const existing = this.repositories.get(repoKey)
    const repositoryState =
      existing ?? this.createRepositoryWatch(repoKey, repository)
    repositoryState.subscribers.add(state.cwd)
  }

  private createRepositoryWatch(key: string, repository: GitRepositoryInfo) {
    const state: RepositoryWatchState = {
      key,
      repositoryRoot: repository.root,
      subscribers: new Set(),
      watchers: new Set(),
      disposed: false,
      changeDebouncer: new Debouncer(() => {}, {
        key: `pico.git-watch.${key}`,
        wait: GIT_WATCH_DEBOUNCE_MS,
      }),
    }
    state.changeDebouncer.fn = () => this.emitRepositoryChange(state)
    this.repositories.set(key, state)
    void this.startRepositoryWatch(state, repository)
    return state
  }

  private async startRepositoryWatch(
    state: RepositoryWatchState,
    repository: GitRepositoryInfo
  ) {
    await Promise.all(
      uniqueWatchPaths(repository).map((path) => this.addWatchPath(state, path))
    )
  }

  private async addWatchPath(state: RepositoryWatchState, path: string) {
    const info = await stat(path).catch(() => null)
    if (!info || state.disposed) return
    if (!info.isDirectory() && !info.isFile()) return

    const recursive = info.isDirectory()
    const created = this.createFsWatcher(state, path, recursive)
    if (!created && recursive && !state.disposed) {
      this.createFsWatcher(state, path, false)
    }
  }

  private createFsWatcher(
    state: RepositoryWatchState,
    path: string,
    recursive: boolean
  ) {
    try {
      const watcher = recursive
        ? watch(path, { recursive: true }, () => {
            this.scheduleRepositoryChange(state)
          })
        : watch(path, () => {
            this.scheduleRepositoryChange(state)
          })

      watcher.on("error", () => {
        state.watchers.delete(watcher)
        try {
          watcher.close()
        } catch {
          // Watcher may already be closed.
        }
      })
      watcher.unref?.()
      state.watchers.add(watcher)
      return true
    } catch {
      return false
    }
  }

  private scheduleRepositoryChange(state: RepositoryWatchState) {
    if (state.disposed) return

    state.changeDebouncer.maybeExecute()
  }

  private emitRepositoryChange(state: RepositoryWatchState) {
    if (state.disposed || state.subscribers.size === 0) return

    for (const cwd of state.subscribers) {
      this.onChange({
        cwd,
        repositoryRoot: state.repositoryRoot,
      })
    }
  }

  private disposeRepository(state: RepositoryWatchState) {
    state.disposed = true
    this.repositories.delete(state.key)

    state.changeDebouncer.cancel()

    for (const watcher of state.watchers) {
      try {
        watcher.close()
      } catch {
        // Watcher may already be closed.
      }
    }
    state.watchers.clear()
  }
}
