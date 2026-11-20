/**
 * Import cookies from the user's own browsers into the agent's browser.
 *
 * It finds the profiles of Chromium browsers (Chrome, Edge, Brave, Arc,
 * Chromium) and Firefox on macOS and Linux, and reads their cookie database
 * from a copy (the browser locks the file). Chromium encrypts the values:
 * on macOS the key comes from the Keychain (macOS asks the user), on Linux
 * from a fixed password or the keyring (`secret-tool`). Firefox keeps the
 * values in plain text. Safari is not supported.
 *
 * The imported cookies go to `<data>/browser/imported-cookies.json`. Each
 * context of the agent's browser gets them first, under the cookies of its
 * conversation (services/browser.ts).
 *
 * Cookie values never go to the log or to the client: the client gets only
 * sites, counts, and tags.
 */
import { execFile } from "node:child_process"
import { createDecipheriv, pbkdf2Sync } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join } from "node:path"

/** A cookie as Playwright takes it. */
export type ImportedCookie = {
  name: string
  value: string
  domain: string
  path: string
  /** Seconds since 1970, or -1 for a session cookie. */
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: "Strict" | "Lax" | "None"
}

export type BrowserId =
  | "chrome"
  | "edge"
  | "brave"
  | "arc"
  | "chromium"
  | "firefox"

type ChromiumVendor = {
  browser: Exclude<BrowserId, "firefox">
  name: string
  /** The user data folder under `~/Library/Application Support`. */
  mac: string
  /** The user data folder under `~/.config`. */
  linux?: string
  /** The Keychain service of the key on macOS. */
  keychain: string
  /** The `application` attribute of the key in the Linux keyring. */
  keyring?: string
}

const CHROMIUM_VENDORS: ChromiumVendor[] = [
  {
    browser: "chrome",
    name: "Google Chrome",
    mac: "Google/Chrome",
    linux: "google-chrome",
    keychain: "Chrome Safe Storage",
    keyring: "chrome",
  },
  {
    browser: "edge",
    name: "Microsoft Edge",
    mac: "Microsoft Edge",
    linux: "microsoft-edge",
    keychain: "Microsoft Edge Safe Storage",
    keyring: "chromium",
  },
  {
    browser: "brave",
    name: "Brave",
    mac: "BraveSoftware/Brave-Browser",
    linux: "BraveSoftware/Brave-Browser",
    keychain: "Brave Safe Storage",
    keyring: "brave",
  },
  {
    browser: "arc",
    name: "Arc",
    mac: "Arc/User Data",
    keychain: "Arc Safe Storage",
  },
  {
    browser: "chromium",
    name: "Chromium",
    mac: "Chromium",
    linux: "chromium",
    keychain: "Chromium Safe Storage",
    keyring: "chromium",
  },
]

/** A profile of a browser on this computer. */
export type BrowserProfile = {
  /** `<browser>:<profile folder>`; the client sends it back. */
  id: string
  browser: BrowserId
  browserName: string
  /** The name that the browser shows for the profile. */
  name: string
  cookiesPath: string
  vendor?: ChromiumVendor
}

/** A profile as the client sees it, without paths. */
export function publicProfile(profile: BrowserProfile) {
  return {
    id: profile.id,
    browser: profile.browser,
    browserName: profile.browserName,
    name: profile.name,
  }
}

function isFile(path: string) {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
}

function isDirectory(path: string) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

/** Profile folders of a Chromium browser, with their cookie database. */
function chromiumProfiles(vendor: ChromiumVendor, dir: string) {
  if (!isDirectory(dir)) return []
  const state = readJson(join(dir, "Local State")) as
    | { profile?: { info_cache?: Record<string, { name?: unknown }> } }
    | undefined
  const names = state?.profile?.info_cache ?? {}
  const profiles: BrowserProfile[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  for (const entry of entries) {
    if (entry !== "Default" && !entry.startsWith("Profile ")) continue
    const cookiesPath = [
      join(dir, entry, "Network", "Cookies"),
      join(dir, entry, "Cookies"),
    ].find(isFile)
    if (!cookiesPath) continue
    const name = names[entry]?.name
    profiles.push({
      id: `${vendor.browser}:${entry}`,
      browser: vendor.browser,
      browserName: vendor.name,
      name: typeof name === "string" && name.trim() ? name.trim() : entry,
      cookiesPath,
      vendor,
    })
  }
  return profiles.sort((left, right) =>
    left.id.endsWith(":Default")
      ? -1
      : right.id.endsWith(":Default")
        ? 1
        : left.name.localeCompare(right.name)
  )
}

/** The `[Profile…]` sections of a Firefox `profiles.ini`. */
export function parseProfilesIni(text: string) {
  const sections: Array<Record<string, string>> = []
  let current: Record<string, string> | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(";") || line.startsWith("#")) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = header[1]!.startsWith("Profile") ? {} : undefined
      if (current) sections.push(current)
      continue
    }
    const equals = line.indexOf("=")
    if (current && equals > 0)
      current[line.slice(0, equals).trim()] = line.slice(equals + 1).trim()
  }
  return sections
}

function firefoxProfiles(root: string) {
  if (!isDirectory(root)) return []
  const profiles: BrowserProfile[] = []
  const seen = new Set<string>()
  const add = (dir: string, name: string) => {
    const cookiesPath = join(dir, "cookies.sqlite")
    if (seen.has(dir) || !isFile(cookiesPath)) return
    seen.add(dir)
    profiles.push({
      id: `firefox:${basename(dir)}`,
      browser: "firefox",
      browserName: "Firefox",
      name,
      cookiesPath,
    })
  }
  const ini = join(root, "profiles.ini")
  if (isFile(ini)) {
    for (const section of parseProfilesIni(readFileSync(ini, "utf8"))) {
      const path = section.Path
      if (!path) continue
      const dir =
        section.IsRelative === "0" || isAbsolute(path) ? path : join(root, path)
      add(dir, section.Name || basename(dir))
    }
  }
  // Profiles that profiles.ini does not name.
  for (const parent of [join(root, "Profiles"), root]) {
    if (!isDirectory(parent)) continue
    for (const entry of readdirSync(parent)) add(join(parent, entry), entry)
  }
  return profiles
}

/**
 * The browser profiles with cookies. `home` is the home folder; tests set
 * `SMITH_BROWSER_PROFILES_DIR` to a fake one.
 */
export function findBrowserProfiles(
  options: { home?: string; platform?: NodeJS.Platform } = {}
) {
  const home =
    options.home ??
    (process.env.SMITH_BROWSER_PROFILES_DIR?.trim() || homedir())
  const platform = options.platform ?? process.platform
  const profiles: BrowserProfile[] = []
  if (platform === "darwin") {
    const support = join(home, "Library", "Application Support")
    for (const vendor of CHROMIUM_VENDORS)
      profiles.push(...chromiumProfiles(vendor, join(support, vendor.mac)))
    profiles.push(...firefoxProfiles(join(support, "Firefox")))
  } else if (platform === "linux") {
    for (const vendor of CHROMIUM_VENDORS)
      if (vendor.linux)
        profiles.push(
          ...chromiumProfiles(vendor, join(home, ".config", vendor.linux))
        )
    profiles.push(...firefoxProfiles(join(home, ".mozilla", "firefox")))
    profiles.push(
      ...firefoxProfiles(
        join(home, "snap", "firefox", "common", ".mozilla", "firefox")
      )
    )
  }
  return profiles
}

// --- Chromium values -------------------------------------------------------

/** The AES key of Chromium cookies: PBKDF2-SHA1 with salt "saltysalt". */
export function chromiumKey(password: string, iterations: number) {
  return pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1")
}

/**
 * Decrypt a `v10` or `v11` value: AES-128-CBC, the IV is 16 spaces. Since
 * database version 24, the text starts with a SHA-256 of the host: with
 * `hashPrefix`, it is removed. Undefined when the key is wrong.
 */
export function decryptChromiumValue(
  encrypted: Uint8Array,
  key: Buffer,
  hashPrefix: boolean
) {
  const data = Buffer.from(encrypted)
  const prefix = data.subarray(0, 3).toString("latin1")
  if (prefix !== "v10" && prefix !== "v11") return undefined
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32))
    const plain = Buffer.concat([
      decipher.update(data.subarray(3)),
      decipher.final(),
    ])
    if (hashPrefix && plain.length < 32) return undefined
    return (hashPrefix ? plain.subarray(32) : plain).toString("utf8")
  } catch {
    return undefined
  }
}

/** Microseconds since 1601-01-01, as Chromium keeps them. */
const WINDOWS_EPOCH_SECONDS = 11_644_473_600n

/** Chromium `expires_utc` as Playwright's `expires`: seconds, or -1. */
export function chromiumExpires(value: bigint | number | null | undefined) {
  if (value === null || value === undefined) return -1
  const micros = typeof value === "bigint" ? value : BigInt(Math.trunc(value))
  if (micros <= 0n) return -1
  const seconds = Number(micros / 1_000_000n - WINDOWS_EPOCH_SECONDS)
  return seconds > 0 ? seconds : -1
}

/** Firefox `expiry`: seconds, or milliseconds since Firefox 136. */
export function firefoxExpires(value: bigint | number | null | undefined) {
  if (value === null || value === undefined) return -1
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return -1
  return number > 100_000_000_000 ? Math.floor(number / 1000) : number
}

/**
 * The SameSite value for Playwright. Chromium: -1 unspecified, 0 none,
 * 1 lax, 2 strict. Firefox: 0 none, 1 lax, 2 strict. None needs Secure,
 * so None without Secure, and unknown values, become Lax.
 */
export function mapSameSite(
  value: bigint | number | null | undefined,
  secure: boolean
): ImportedCookie["sameSite"] {
  const number = value === null || value === undefined ? -1 : Number(value)
  if (number === 2) return "Strict"
  if (number === 0 && secure) return "None"
  return "Lax"
}

// --- Sites -----------------------------------------------------------------

/** Two-part public suffixes: a site is one label more. */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "ltd.uk",
  "plc.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "org.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.kr",
  "co.in",
  "net.in",
  "org.in",
  "co.za",
  "co.il",
  "com.br",
  "com.mx",
  "com.ar",
  "com.cn",
  "com.hk",
  "com.tw",
  "com.sg",
  "com.my",
  "com.tr",
  "com.ua",
  "com.pl",
  "co.id",
  "co.th",
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "herokuapp.com",
  "blogspot.com",
  "azurewebsites.net",
  "cloudfront.net",
  "appspot.com",
  "fly.dev",
  "onrender.com",
  "ngrok.io",
  "ngrok-free.app",
])

/** The site of a cookie host: the registrable domain (eTLD+1), roughly. */
export function registrableDomain(host: string) {
  const name = host.trim().replace(/^\.+/, "").replace(/\.+$/, "").toLowerCase()
  if (!name || /^[\d.]+$/.test(name) || name.includes(":")) return name
  const labels = name.split(".")
  if (labels.length <= 2) return name
  const lastTwo = labels.slice(-2).join(".")
  return labels.slice(MULTI_PART_SUFFIXES.has(lastTwo) ? -3 : -2).join(".")
}

export type SiteTag = "Email" | "Bank or payments" | "Sign-in provider"

const SITE_TAGS: Record<string, SiteTag> = {
  // Sign-in providers and password managers.
  "google.com": "Sign-in provider",
  "live.com": "Sign-in provider",
  "microsoft.com": "Sign-in provider",
  "microsoftonline.com": "Sign-in provider",
  "apple.com": "Sign-in provider",
  "icloud.com": "Sign-in provider",
  "auth0.com": "Sign-in provider",
  "okta.com": "Sign-in provider",
  "onelogin.com": "Sign-in provider",
  "github.com": "Sign-in provider",
  "gitlab.com": "Sign-in provider",
  "facebook.com": "Sign-in provider",
  "bitwarden.com": "Sign-in provider",
  "1password.com": "Sign-in provider",
  "lastpass.com": "Sign-in provider",
  "dashlane.com": "Sign-in provider",
  // Email.
  "gmail.com": "Email",
  "outlook.com": "Email",
  "fastmail.com": "Email",
  "proton.me": "Email",
  "protonmail.com": "Email",
  "yahoo.com": "Email",
  "hey.com": "Email",
  "zoho.com": "Email",
  "tuta.com": "Email",
  "tutanota.com": "Email",
  "aol.com": "Email",
  "gmx.com": "Email",
  "mail.com": "Email",
  "superhuman.com": "Email",
  // Banks, payments, and trading.
  "stripe.com": "Bank or payments",
  "paypal.com": "Bank or payments",
  "venmo.com": "Bank or payments",
  "wise.com": "Bank or payments",
  "revolut.com": "Bank or payments",
  "coinbase.com": "Bank or payments",
  "binance.com": "Bank or payments",
  "kraken.com": "Bank or payments",
  "robinhood.com": "Bank or payments",
  "metamask.io": "Bank or payments",
  "bankofamerica.com": "Bank or payments",
  "chase.com": "Bank or payments",
  "wellsfargo.com": "Bank or payments",
  "citi.com": "Bank or payments",
  "capitalone.com": "Bank or payments",
  "americanexpress.com": "Bank or payments",
  "discover.com": "Bank or payments",
  "usbank.com": "Bank or payments",
  "schwab.com": "Bank or payments",
  "fidelity.com": "Bank or payments",
  "vanguard.com": "Bank or payments",
  "etrade.com": "Bank or payments",
  "tradingview.com": "Bank or payments",
  "mercury.com": "Bank or payments",
  "brex.com": "Bank or payments",
  "ramp.com": "Bank or payments",
  "squareup.com": "Bank or payments",
  "klarna.com": "Bank or payments",
  "affirm.com": "Bank or payments",
  "monzo.com": "Bank or payments",
  "n26.com": "Bank or payments",
  "hsbc.com": "Bank or payments",
  "barclays.co.uk": "Bank or payments",
}

export function siteTag(domain: string): SiteTag | undefined {
  return SITE_TAGS[domain]
}

export type CookieSite = { domain: string; count: number; tag?: SiteTag }

/** Cookies by site, the tagged sites first, then by count. */
export function groupSites(cookies: Array<{ domain: string }>) {
  const counts = new Map<string, number>()
  for (const cookie of cookies) {
    const domain = registrableDomain(cookie.domain)
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  const sites: CookieSite[] = [...counts].map(([domain, count]) => {
    const tag = siteTag(domain)
    return tag ? { domain, count, tag } : { domain, count }
  })
  return sites.sort(
    (left, right) =>
      Number(Boolean(right.tag)) - Number(Boolean(left.tag)) ||
      right.count - left.count ||
      left.domain.localeCompare(right.domain)
  )
}

// --- Merge -----------------------------------------------------------------

/** Cookies with the same key replace each other. */
export function cookieKey(cookie: {
  name: string
  domain: string
  path: string
}) {
  return `${cookie.name}\u0000${cookie.domain.toLowerCase()}\u0000${cookie.path}`
}

/**
 * The cookies of a new context: the imported cookies first, then the
 * conversation's own cookies, which win for the same name, domain, and path.
 */
export function mergeCookies<Cookie extends ImportedCookie>(
  imported: ImportedCookie[],
  own: Cookie[]
): Array<ImportedCookie | Cookie> {
  const keys = new Set(own.map(cookieKey))
  return [...imported.filter((cookie) => !keys.has(cookieKey(cookie))), ...own]
}

/**
 * Cookies without the ones that are still the same as an imported cookie:
 * a conversation saves only its own cookies, so that the removal of the
 * imported cookies also removes them from the conversations.
 */
export function withoutImported<Cookie extends ImportedCookie>(
  cookies: Cookie[],
  imported: ImportedCookie[]
) {
  if (imported.length === 0) return cookies
  const values = new Map(
    imported.map((cookie) => [cookieKey(cookie), cookie.value])
  )
  return cookies.filter(
    (cookie) => values.get(cookieKey(cookie)) !== cookie.value
  )
}

// --- Store -----------------------------------------------------------------

export type ImportSource = {
  browser: BrowserId
  browserName: string
  profileName: string
}

export type ImportedCookieStore = {
  version: 1
  importedAt: string
  source: ImportSource
  cookies: ImportedCookie[]
}

export function importedCookiesPath(dataDir: string) {
  return join(dataDir, "browser", "imported-cookies.json")
}

export async function readImportedCookies(
  dataDir: string
): Promise<ImportedCookieStore | undefined> {
  try {
    const data = JSON.parse(
      await readFile(importedCookiesPath(dataDir), "utf8")
    ) as Partial<ImportedCookieStore>
    if (data.version !== 1 || !Array.isArray(data.cookies)) return undefined
    return data as ImportedCookieStore
  } catch {
    return undefined
  }
}

export async function writeImportedCookies(
  dataDir: string,
  store: ImportedCookieStore
) {
  const path = importedCookiesPath(dataDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(store), { mode: 0o600 })
  // The mode applies only to a new file.
  await chmod(path, 0o600)
}

export async function removeImportedCookieFile(dataDir: string) {
  await rm(importedCookiesPath(dataDir), { force: true })
}

// --- Reading ---------------------------------------------------------------

type SqliteModule = typeof import("node:sqlite")
type Database = InstanceType<SqliteModule["DatabaseSync"]>

async function loadSqlite(): Promise<SqliteModule> {
  try {
    return await import("node:sqlite")
  } catch {
    throw new Error(
      "Reading browser cookies needs node:sqlite (Node 22.13 or later). Update Node."
    )
  }
}

/** Read a copy of a database: the browser locks the file. */
async function readCopy<T>(path: string, read: (db: Database) => T) {
  const sqlite = await loadSqlite()
  const dir = await mkdtemp(join(tmpdir(), "smith-cookies-"))
  try {
    const copy = join(dir, "cookies.db")
    await copyFile(path, copy)
    // Recent changes can still be in the write-ahead log.
    if (existsSync(`${path}-wal`)) await copyFile(`${path}-wal`, `${copy}-wal`)
    const db = new sqlite.DatabaseSync(copy)
    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function cookie(fields: {
  host: string
  name: string
  value: string
  path: string
  expires: number
  secure: boolean
  httpOnly: boolean
  sameSite: ImportedCookie["sameSite"]
}): ImportedCookie | undefined {
  const domain = fields.host.trim().toLowerCase()
  if (!domain || !fields.name) return undefined
  if (fields.expires !== -1 && fields.expires * 1000 < Date.now())
    return undefined
  return {
    name: fields.name,
    value: fields.value,
    domain,
    path: fields.path.startsWith("/") ? fields.path : "/",
    expires: fields.expires,
    httpOnly: fields.httpOnly,
    secure: fields.secure,
    sameSite: fields.sameSite,
  }
}

type ChromiumRow = {
  host_key: string
  name: string
  value: string
  encrypted_value: Uint8Array | null
  path: string
  expires_utc: bigint
  is_secure: bigint
  is_httponly: bigint
  samesite: bigint
}

function run(command: string, args: string[], timeout: number) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/** The password of a Chromium key store; undefined when there is none. */
export type SecretReader = (
  vendor: ChromiumVendor,
  platform: NodeJS.Platform
) => Promise<string | undefined>

const readSecret: SecretReader = async (vendor, platform) => {
  if (platform === "darwin") {
    try {
      // macOS asks the user to allow this; give them time.
      const password = await run(
        "security",
        ["find-generic-password", "-w", "-s", vendor.keychain],
        120_000
      )
      return password.trim() || undefined
    } catch {
      throw new Error(
        `macOS did not unlock the cookies of ${vendor.name}. Try again, enter your Mac login password, and choose Allow.`
      )
    }
  }
  if (platform === "linux" && vendor.keyring) {
    try {
      const password = await run(
        "secret-tool",
        ["lookup", "application", vendor.keyring],
        30_000
      )
      return password.trim() || undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

type ReadResult = {
  cookies: ImportedCookie[]
  /** Cookies that could not be decrypted. */
  skipped: number
  warning?: string
}

async function readChromium(
  profile: BrowserProfile,
  platform: NodeJS.Platform,
  secret: SecretReader
): Promise<ReadResult> {
  const vendor = profile.vendor!
  const { rows, version } = await readCopy(profile.cookiesPath, (db) => {
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'")
    const version = Number((meta.get() as { value?: unknown })?.value ?? 0)
    const statement = db.prepare(
      "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies"
    )
    // expires_utc is larger than a safe JavaScript number.
    statement.setReadBigInts(true)
    return { rows: statement.all() as ChromiumRow[], version }
  })
  const hashPrefix = version >= 24
  const needs = (prefix: string) =>
    rows.some(
      (row) =>
        row.encrypted_value &&
        Buffer.from(row.encrypted_value.subarray(0, 3)).toString("latin1") ===
          prefix
    )
  const keys: { v10?: Buffer; v11?: Buffer } = {}
  if (platform === "darwin") {
    if (needs("v10")) {
      const password = await secret(vendor, platform)
      if (!password)
        throw new Error(`Found no key for the cookies of ${vendor.name}.`)
      keys.v10 = chromiumKey(password, 1003)
    }
  } else if (platform === "linux") {
    keys.v10 = chromiumKey("peanuts", 1)
    if (needs("v11")) {
      const password = await secret(vendor, platform)
      if (password) keys.v11 = chromiumKey(password, 1)
    }
  }
  const cookies: ImportedCookie[] = []
  let skipped = 0
  for (const row of rows) {
    let value = row.value
    const encrypted = row.encrypted_value
    if (encrypted && encrypted.length > 0) {
      const prefix = Buffer.from(encrypted.subarray(0, 3)).toString("latin1")
      const key =
        prefix === "v10" ? keys.v10 : prefix === "v11" ? keys.v11 : undefined
      const decrypted = key
        ? decryptChromiumValue(encrypted, key, hashPrefix)
        : undefined
      if (decrypted === undefined) {
        skipped += 1
        continue
      }
      value = decrypted
    }
    const secure = Number(row.is_secure) === 1
    const item = cookie({
      host: row.host_key,
      name: row.name,
      value,
      path: row.path,
      expires: chromiumExpires(row.expires_utc),
      secure,
      httpOnly: Number(row.is_httponly) === 1,
      sameSite: mapSameSite(row.samesite, secure),
    })
    if (item) cookies.push(item)
  }
  const warning =
    skipped > 0
      ? platform === "linux" && !keys.v11
        ? `Could not decrypt ${skipped} cookies: the key is in the keyring, and secret-tool did not give it.`
        : `Could not decrypt ${skipped} cookies.`
      : undefined
  return { cookies, skipped, ...(warning ? { warning } : {}) }
}

type FirefoxRow = {
  host: string
  name: string
  value: string
  path: string
  expiry: bigint
  isSecure: bigint
  isHttpOnly: bigint
  sameSite: bigint
  originAttributes: string
}

async function readFirefox(profile: BrowserProfile): Promise<ReadResult> {
  const rows = await readCopy(profile.cookiesPath, (db) => {
    const statement = db.prepare(
      "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes FROM moz_cookies"
    )
    statement.setReadBigInts(true)
    return statement.all() as FirefoxRow[]
  })
  const cookies: ImportedCookie[] = []
  for (const row of rows) {
    // Containers and partitioned cookies are not the plain profile's.
    if (row.originAttributes) continue
    const secure = Number(row.isSecure) === 1
    const item = cookie({
      host: row.host,
      name: row.name,
      value: row.value ?? "",
      path: row.path,
      expires: firefoxExpires(row.expiry),
      secure,
      httpOnly: Number(row.isHttpOnly) === 1,
      sameSite: mapSameSite(row.sameSite, secure),
    })
    if (item) cookies.push(item)
  }
  return { cookies, skipped: 0 }
}

/** How long the cookies of a listed profile stay in memory for the import. */
const CACHE_MS = 10 * 60 * 1000

/**
 * Reads the cookies of local browser profiles. The cookies of the last
 * listed profile stay in memory for a short time, so that the import does
 * not ask macOS for the key again.
 */
export class CookieImporter {
  readonly #home: string | undefined
  readonly #platform: NodeJS.Platform
  readonly #secret: SecretReader
  #cache:
    | { profileId: string; at: number; result: Promise<ReadResult> }
    | undefined

  constructor(
    options: {
      home?: string
      platform?: NodeJS.Platform
      secret?: SecretReader
    } = {}
  ) {
    this.#home = options.home
    this.#platform = options.platform ?? process.platform
    this.#secret = options.secret ?? readSecret
  }

  profiles() {
    return findBrowserProfiles({
      ...(this.#home ? { home: this.#home } : {}),
      platform: this.#platform,
    })
  }

  profile(profileId: string) {
    const profile = this.profiles().find((item) => item.id === profileId)
    if (!profile) throw new Error(`No browser profile ${profileId}`)
    return profile
  }

  #read(profileId: string, fresh: boolean) {
    const cached = this.#cache
    if (
      !fresh &&
      cached?.profileId === profileId &&
      Date.now() - cached.at < CACHE_MS
    )
      return cached.result
    const profile = this.profile(profileId)
    const result =
      profile.browser === "firefox"
        ? readFirefox(profile)
        : readChromium(profile, this.#platform, this.#secret)
    this.#cache = { profileId, at: Date.now(), result }
    result.catch(() => {
      if (this.#cache?.result === result) this.#cache = undefined
    })
    return result
  }

  /** The sites with cookies in a profile. Reads the profile again. */
  async sites(profileId: string) {
    const profile = this.profile(profileId)
    const result = await this.#read(profileId, true)
    return {
      profile: publicProfile(profile),
      sites: groupSites(result.cookies),
      total: result.cookies.length,
      skipped: result.skipped,
      ...(result.warning ? { warning: result.warning } : {}),
    }
  }

  /** The cookies of the chosen sites of a profile. */
  async cookies(profileId: string, domains: string[]) {
    const profile = this.profile(profileId)
    const result = await this.#read(profileId, false)
    this.#cache = undefined
    const chosen = new Set(domains.map((domain) => domain.toLowerCase()))
    return {
      profile,
      cookies: result.cookies.filter((item) =>
        chosen.has(registrableDomain(item.domain))
      ),
    }
  }
}
