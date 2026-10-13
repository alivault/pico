/**
 * Language servers for the LSP tools.
 *
 * One server runs for each (project root, language), started on first use
 * and stopped after 10 minutes without requests. The client speaks JSON-RPC
 * over the server's stdin and stdout with `Content-Length` framing, and opens
 * each document it asks about, with the file's current text.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { delimiter, dirname, extname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const IDLE_MS = 10 * 60_000
const REQUEST_TIMEOUT_MS = 60_000

export type LanguageId =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact"
  | "python"
  | "rust"
  | "go"

type ServerKind = "typescript" | "python" | "rust" | "go"

const LANGUAGES: Record<string, { language: LanguageId; server: ServerKind }> =
  {
    ".ts": { language: "typescript", server: "typescript" },
    ".mts": { language: "typescript", server: "typescript" },
    ".cts": { language: "typescript", server: "typescript" },
    ".tsx": { language: "typescriptreact", server: "typescript" },
    ".js": { language: "javascript", server: "typescript" },
    ".mjs": { language: "javascript", server: "typescript" },
    ".cjs": { language: "javascript", server: "typescript" },
    ".jsx": { language: "javascriptreact", server: "typescript" },
    ".py": { language: "python", server: "python" },
    ".pyi": { language: "python", server: "python" },
    ".rs": { language: "rust", server: "rust" },
    ".go": { language: "go", server: "go" },
  }

const ROOT_MARKERS: Record<ServerKind, string[]> = {
  typescript: ["tsconfig.json", "jsconfig.json", "package.json"],
  python: ["pyproject.toml", "setup.py", "setup.cfg", "pyrightconfig.json"],
  rust: ["Cargo.toml"],
  go: ["go.mod"],
}

export function languageOf(path: string) {
  return LANGUAGES[extname(path).toLowerCase()]
}

function onPath(name: string) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(dir, name)
    if (dir && existsSync(candidate)) return candidate
  }
  return undefined
}

/** The command that starts a language server, or an error that says how to get one. */
export function serverCommand(
  kind: ServerKind,
  root: string
): { command: string; args: string[] } {
  switch (kind) {
    case "typescript": {
      const local = join(
        root,
        "node_modules",
        ".bin",
        "typescript-language-server"
      )
      if (existsSync(local)) return { command: local, args: ["--stdio"] }
      const global = onPath("typescript-language-server")
      if (global) return { command: global, args: ["--stdio"] }
      // Pico ships one, so TypeScript and JavaScript work without setup.
      const require = createRequire(import.meta.url)
      const bundled = require.resolve("typescript-language-server/lib/cli.mjs")
      return { command: process.execPath, args: [bundled, "--stdio"] }
    }
    case "python": {
      const pyright = onPath("pyright-langserver")
      if (pyright) return { command: pyright, args: ["--stdio"] }
      const pylsp = onPath("pylsp")
      if (pylsp) return { command: pylsp, args: [] }
      throw new Error(
        "No Python language server found. Install pyright (npm i -g pyright) or python-lsp-server."
      )
    }
    case "rust": {
      const analyzer = onPath("rust-analyzer")
      if (analyzer) return { command: analyzer, args: [] }
      throw new Error(
        "rust-analyzer is not installed. Run `rustup component add rust-analyzer`."
      )
    }
    case "go": {
      const gopls = onPath("gopls")
      if (gopls) return { command: gopls, args: [] }
      throw new Error(
        "gopls is not installed. Run `go install golang.org/x/tools/gopls@latest`."
      )
    }
  }
}

/** The nearest directory above `file` with a project marker, or `fallback`. */
export function projectRoot(file: string, kind: ServerKind, fallback: string) {
  let dir = dirname(file)
  for (;;) {
    if (ROOT_MARKERS[kind].some((marker) => existsSync(join(dir, marker))))
      return dir
    const parent = dirname(dir)
    if (parent === dir) return fallback
    dir = parent
  }
}

export type Position = { line: number; character: number }
export type Range = { start: Position; end: Position }
export type Location = { uri: string; range: Range }
export type Diagnostic = {
  range: Range
  severity?: number
  code?: string | number
  source?: string
  message: string
}
export type TextEdit = { range: Range; newText: string }
export type WorkspaceEdit = {
  changes?: Record<string, TextEdit[]>
  documentChanges?: Array<{
    textDocument?: { uri: string }
    edits?: TextEdit[]
    kind?: string
  }>
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class LspClient {
  readonly root: string
  readonly kind: ServerKind
  readonly #process: ChildProcess
  readonly #pending = new Map<number, Pending>()
  readonly #documents = new Map<string, { version: number; text: string }>()
  readonly #diagnostics = new Map<string, Diagnostic[]>()
  readonly #diagnosticWaiters = new Map<string, Array<() => void>>()
  #nextId = 1
  #buffer = Buffer.alloc(0)
  #closed = false
  #lastUsed = Date.now()
  readonly ready: Promise<void>
  stderr = ""

  constructor(kind: ServerKind, root: string) {
    this.kind = kind
    this.root = root
    const { command, args } = serverCommand(kind, root)
    this.#process = spawn(command, args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })
    this.#process.stdout!.on("data", (chunk: Buffer) => this.#receive(chunk))
    this.#process.stderr!.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000)
    })
    const exited = new Promise<never>((_, reject) => {
      this.#process.once("error", (error) => {
        this.#fail(error)
        reject(error)
      })
      this.#process.once("exit", (code) => {
        const error = new Error(
          `The ${kind} language server exited (code ${code}). ${this.stderr.trim()}`
        )
        this.#fail(error)
        reject(error)
      })
    })
    exited.catch(() => undefined)
    this.ready = Promise.race([this.#initialize(), exited])
  }

  get lastUsed() {
    return this.#lastUsed
  }

  get closed() {
    return this.#closed
  }

  async #initialize() {
    const rootUri = pathToFileURL(this.root).href
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      rootPath: this.root,
      workspaceFolders: [{ uri: rootUri, name: this.root }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          publishDiagnostics: { relatedInformation: false },
          definition: { linkSupport: false },
          references: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
          rename: { prepareSupport: false },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
        workspace: {
          symbol: {},
          workspaceEdit: { documentChanges: true },
          configuration: true,
          workspaceFolders: true,
        },
      },
      initializationOptions: this.#initializationOptions(),
    })
    this.notify("initialized", {})
  }

  #initializationOptions() {
    if (this.kind !== "typescript") return {}
    try {
      // Projects without their own TypeScript use the one Pico ships.
      const require = createRequire(import.meta.url)
      const fallbackPath = dirname(
        require.resolve("typescript/lib/tsserver.js")
      )
      return { tsserver: { fallbackPath } }
    } catch {
      return {}
    }
  }

  #fail(error: Error) {
    this.#closed = true
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #send(message: Record<string, unknown>) {
    if (this.#closed) throw new Error("The language server is not running")
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
    this.#process.stdin!.write(
      Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
        body,
      ])
    )
  }

  #receive(chunk: Buffer) {
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    for (;;) {
      const headerEnd = this.#buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const header = this.#buffer.subarray(0, headerEnd).toString()
      const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1] ?? NaN)
      if (!Number.isFinite(length)) {
        this.#buffer = this.#buffer.subarray(headerEnd + 4)
        continue
      }
      const start = headerEnd + 4
      if (this.#buffer.length < start + length) return
      const body = this.#buffer.subarray(start, start + length).toString()
      this.#buffer = this.#buffer.subarray(start + length)
      try {
        this.#handle(JSON.parse(body) as Record<string, unknown>)
      } catch {
        // Ignore a message that is not JSON.
      }
    }
  }

  #handle(message: Record<string, unknown>) {
    const id = message.id as number | undefined
    if (id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.#pending.get(id)
      if (!pending) return
      this.#pending.delete(id)
      clearTimeout(pending.timer)
      const error = message.error as { message?: string } | undefined
      if (error) pending.reject(new Error(error.message ?? "LSP error"))
      else pending.resolve(message.result)
      return
    }
    const method = message.method as string | undefined
    if (!method) return
    if (id !== undefined) {
      // Requests from the server: answer the ones that block it.
      const params = message.params as { items?: unknown[] } | undefined
      const result =
        method === "workspace/configuration"
          ? (params?.items ?? []).map(() => null)
          : method === "workspace/workspaceFolders"
            ? [{ uri: pathToFileURL(this.root).href, name: this.root }]
            : null
      this.#send({ id, result })
      return
    }
    if (method === "textDocument/publishDiagnostics") {
      const params = message.params as {
        uri: string
        diagnostics: Diagnostic[]
      }
      this.#diagnostics.set(params.uri, params.diagnostics)
      for (const waiter of this.#diagnosticWaiters.get(params.uri) ?? [])
        waiter()
      this.#diagnosticWaiters.delete(params.uri)
    }
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    this.#lastUsed = Date.now()
    const id = this.#nextId++
    return new Promise<T>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.#pending.set(id, {
        resolve: resolvePromise as (value: unknown) => void,
        reject,
        timer,
      })
      try {
        this.#send({ id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(error as Error)
      }
    })
  }

  notify(method: string, params: unknown) {
    this.#send({ method, params })
  }

  /** Open a document, or send its new text when it changed on disk. */
  async sync(path: string) {
    const uri = pathToFileURL(path).href
    const text = await readFile(path, "utf8")
    const open = this.#documents.get(uri)
    const language = languageOf(path)?.language ?? "plaintext"
    if (!open) {
      this.#documents.set(uri, { version: 1, text })
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: language, version: 1, text },
      })
    } else if (open.text !== text) {
      open.version += 1
      open.text = text
      this.#diagnostics.delete(uri)
      this.notify("textDocument/didChange", {
        textDocument: { uri, version: open.version },
        contentChanges: [{ text }],
      })
    }
    return { uri, text }
  }

  /** Diagnostics of a document after the server has had time to check it. */
  async diagnostics(path: string, waitMs = 4000) {
    const { uri } = await this.sync(path)
    if (!this.#diagnostics.has(uri)) {
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, waitMs)
        const waiters = this.#diagnosticWaiters.get(uri) ?? []
        waiters.push(() => {
          clearTimeout(timer)
          resolveWait()
        })
        this.#diagnosticWaiters.set(uri, waiters)
      })
    }
    return this.#diagnostics.get(uri) ?? []
  }

  async close() {
    if (this.#closed) return
    try {
      await Promise.race([
        this.request("shutdown", null),
        new Promise((done) => setTimeout(done, 2000)),
      ])
      this.notify("exit", null)
    } catch {
      // The server may be gone already.
    }
    this.#closed = true
    setTimeout(() => this.#process.kill(), 500).unref()
  }
}

/** Language server clients, by project root and language. */
export class LspPool {
  readonly #clients = new Map<string, LspClient>()
  readonly #timer: NodeJS.Timeout

  constructor() {
    this.#timer = setInterval(() => this.#reap(), 60_000)
    this.#timer.unref()
  }

  async client(file: string, cwd: string) {
    const language = languageOf(file)
    if (!language)
      throw new Error(
        `No language server for ${extname(file) || "this file"}. Supported: TypeScript, JavaScript, Python, Rust, Go.`
      )
    const root = projectRoot(file, language.server, cwd)
    const key = `${language.server}:${root}`
    let client = this.#clients.get(key)
    if (client?.closed) {
      this.#clients.delete(key)
      client = undefined
    }
    if (!client) {
      client = new LspClient(language.server, root)
      this.#clients.set(key, client)
    }
    try {
      await client.ready
    } catch (error) {
      this.#clients.delete(key)
      throw error
    }
    return client
  }

  #reap() {
    for (const [key, client] of this.#clients) {
      if (Date.now() - client.lastUsed < IDLE_MS && !client.closed) continue
      this.#clients.delete(key)
      void client.close()
    }
  }

  async shutdown() {
    clearInterval(this.#timer)
    await Promise.all(
      [...this.#clients.values()].map((client) => client.close())
    )
    this.#clients.clear()
  }
}

export function uriToPath(uri: string) {
  return uri.startsWith("file:") ? fileURLToPath(uri) : uri
}

/** Apply a workspace edit to files; returns the changed paths. */
export async function applyWorkspaceEdit(edit: WorkspaceEdit) {
  const byFile = new Map<string, TextEdit[]>()
  for (const [uri, edits] of Object.entries(edit.changes ?? {}))
    byFile.set(uriToPath(uri), [
      ...(byFile.get(uriToPath(uri)) ?? []),
      ...edits,
    ])
  for (const change of edit.documentChanges ?? []) {
    if (!change.textDocument || !change.edits) continue
    const path = uriToPath(change.textDocument.uri)
    byFile.set(path, [...(byFile.get(path) ?? []), ...change.edits])
  }
  const { writeFile } = await import("node:fs/promises")
  for (const [path, edits] of byFile) {
    const text = await readFile(path, "utf8")
    const lineStarts = [0]
    for (let index = 0; index < text.length; index += 1)
      if (text[index] === "\n") lineStarts.push(index + 1)
    const offset = (position: Position) =>
      Math.min(
        text.length,
        (lineStarts[position.line] ?? text.length) + position.character
      )
    const sorted = [...edits].sort(
      (left, right) => offset(right.range.start) - offset(left.range.start)
    )
    let next = text
    for (const item of sorted)
      next =
        next.slice(0, offset(item.range.start)) +
        item.newText +
        next.slice(offset(item.range.end))
    await writeFile(path, next)
  }
  return [...byFile.keys()].map((path) => resolve(path))
}
