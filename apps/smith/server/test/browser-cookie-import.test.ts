import assert from "node:assert/strict"
import { createCipheriv, createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

import { BrowserManager, findChrome } from "../src/services/browser.ts"
import {
  chromiumExpires,
  chromiumKey,
  CookieImporter,
  decryptChromiumValue,
  firefoxExpires,
  groupSites,
  importedCookiesPath,
  mapSameSite,
  mergeCookies,
  parseProfilesIni,
  registrableDomain,
  withoutImported,
  type ImportedCookie,
} from "../src/services/browser-cookie-import.ts"

const tempDir = () => mkdtemp(join(tmpdir(), "pico-cookie-import-"))

/** A Chromium `v10` value, as Chrome writes it. */
function encryptV10(
  text: string,
  password: string,
  iterations: number,
  host?: string
) {
  const key = chromiumKey(password, iterations)
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32))
  const plain = Buffer.concat([
    host ? createHash("sha256").update(host).digest() : Buffer.alloc(0),
    Buffer.from(text, "utf8"),
  ])
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(plain),
    cipher.final(),
  ])
}

function cookie(fields: Partial<ImportedCookie>): ImportedCookie {
  return {
    name: "sid",
    value: "1",
    domain: ".example.com",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
    ...fields,
  }
}

/** Chromium expires_utc for a time: microseconds since 1601. */
const chromiumTime = (seconds: number) =>
  (BigInt(seconds) + 11_644_473_600n) * 1_000_000n

void test("a v10 value decrypts with and without the host hash", () => {
  const key = chromiumKey("secret", 1003)
  assert.equal(
    decryptChromiumValue(encryptV10("hello", "secret", 1003), key, false),
    "hello"
  )
  assert.equal(
    decryptChromiumValue(
      encryptV10("héllo wörld", "secret", 1003, ".example.com"),
      key,
      true
    ),
    "héllo wörld"
  )
  // A wrong key or an unknown prefix gives nothing.
  assert.equal(
    decryptChromiumValue(
      encryptV10("hello", "secret", 1003),
      chromiumKey("other", 1003),
      false
    ),
    undefined
  )
  assert.equal(
    decryptChromiumValue(Buffer.from("plain"), key, false),
    undefined
  )
  // Linux v10: the password "peanuts" with one iteration.
  assert.equal(
    decryptChromiumValue(
      encryptV10("linux", "peanuts", 1),
      chromiumKey("peanuts", 1),
      false
    ),
    "linux"
  )
})

void test("expiry times convert to seconds since 1970", () => {
  assert.equal(chromiumExpires(chromiumTime(1_704_067_200)), 1_704_067_200)
  assert.equal(
    chromiumExpires(Number(chromiumTime(1_704_067_200))),
    1_704_067_200
  )
  assert.equal(chromiumExpires(0n), -1)
  assert.equal(chromiumExpires(null), -1)
  assert.equal(firefoxExpires(1_704_067_200n), 1_704_067_200)
  assert.equal(firefoxExpires(1_704_067_200_000n), 1_704_067_200)
  assert.equal(firefoxExpires(0), -1)
})

void test("SameSite maps to values that Playwright takes", () => {
  assert.equal(mapSameSite(2n, false), "Strict")
  assert.equal(mapSameSite(1n, true), "Lax")
  assert.equal(mapSameSite(0n, true), "None")
  // None needs Secure.
  assert.equal(mapSameSite(0n, false), "Lax")
  assert.equal(mapSameSite(-1n, true), "Lax")
  assert.equal(mapSameSite(256, true), "Lax")
  assert.equal(mapSameSite(null, false), "Lax")
})

void test("cookies group by site, tagged sites first", () => {
  assert.equal(registrableDomain(".mail.google.com"), "google.com")
  assert.equal(
    registrableDomain("login.microsoftonline.com"),
    "microsoftonline.com"
  )
  assert.equal(registrableDomain("www.bbc.co.uk"), "bbc.co.uk")
  assert.equal(registrableDomain("me.github.io"), "me.github.io")
  assert.equal(registrableDomain("localhost"), "localhost")
  assert.equal(registrableDomain("127.0.0.1"), "127.0.0.1")
  const sites = groupSites([
    { domain: ".news.example.com" },
    { domain: "example.com" },
    { domain: "www.example.com" },
    { domain: ".other.org" },
    { domain: "accounts.google.com" },
    { domain: ".paypal.com" },
    { domain: "www.paypal.com" },
  ])
  assert.deepEqual(sites, [
    { domain: "paypal.com", count: 2, tag: "Bank or payments" },
    { domain: "google.com", count: 1, tag: "Sign-in provider" },
    { domain: "example.com", count: 3 },
    { domain: "other.org", count: 1 },
  ])
})

void test("the conversation's cookies win over imported cookies", () => {
  const imported = [
    cookie({ name: "a", value: "imported" }),
    cookie({ name: "b", value: "imported" }),
    cookie({ name: "a", value: "imported", path: "/app" }),
  ]
  const own = [cookie({ name: "a", value: "own" })]
  const merged = mergeCookies(imported, own)
  assert.deepEqual(
    merged.map((item) => `${item.name}${item.path}=${item.value}`),
    ["b/=imported", "a/app=imported", "a/=own"]
  )
  // A save keeps only the cookies that differ from the imported ones.
  const saved = withoutImported(
    [
      cookie({ name: "a", value: "own" }),
      cookie({ name: "b", value: "imported" }),
      cookie({ name: "c", value: "new" }),
    ],
    imported
  )
  assert.deepEqual(
    saved.map((item) => item.name),
    ["a", "c"]
  )
})

void test("profiles.ini sections give Firefox profile names", () => {
  assert.deepEqual(
    parseProfilesIni(
      "[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abc.default-release\n\n[Install123]\nDefault=x\n"
    ),
    [
      {
        Name: "default-release",
        IsRelative: "1",
        Path: "Profiles/abc.default-release",
      },
    ]
  )
})

const future = Math.floor(Date.now() / 1000) + 86_400
const past = Math.floor(Date.now() / 1000) - 86_400

/** A fake home folder with a Firefox and a Chrome profile, as on macOS. */
async function fakeHome() {
  const home = await tempDir()
  const support = join(home, "Library", "Application Support")
  const firefox = join(support, "Firefox")
  const profile = join(firefox, "Profiles", "abc.default-release")
  await mkdir(profile, { recursive: true })
  await writeFile(
    join(firefox, "profiles.ini"),
    "[Profile0]\nName=Work\nIsRelative=1\nPath=Profiles/abc.default-release\n"
  )
  const firefoxDb = new DatabaseSync(join(profile, "cookies.sqlite"))
  firefoxDb.exec(
    "CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '', name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)"
  )
  const addFirefox = firefoxDb.prepare(
    "INSERT INTO moz_cookies (originAttributes, name, value, host, path, expiry, isSecure, isHttpOnly, sameSite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
  addFirefox.run("", "sid", "ff-1", ".github.com", "/", future, 1, 1, 1)
  addFirefox.run(
    "",
    "pref",
    "ff-2",
    "news.example.com",
    "/",
    future * 1000,
    0,
    0,
    0
  )
  addFirefox.run("", "old", "ff-3", "example.com", "/", past, 0, 0, 1)
  addFirefox.run(
    "^userContextId=1",
    "c",
    "ff-4",
    "example.com",
    "/",
    future,
    0,
    0,
    1
  )
  firefoxDb.close()

  const chrome = join(support, "Google", "Chrome")
  await mkdir(join(chrome, "Default", "Network"), { recursive: true })
  await writeFile(
    join(chrome, "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name: "Ann" } } } })
  )
  const chromeDb = new DatabaseSync(
    join(chrome, "Default", "Network", "Cookies")
  )
  chromeDb.exec(
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('version', '24');" +
      "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)"
  )
  const addChrome = chromeDb.prepare(
    "INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
  addChrome.run(
    ".paypal.com",
    "token",
    "",
    encryptV10("pp-secret", "keychain-pw", 1003, ".paypal.com"),
    "/",
    chromiumTime(future),
    1,
    1,
    0
  )
  addChrome.run(
    "example.com",
    "plain",
    "visible",
    Buffer.alloc(0),
    "/",
    0n,
    0,
    0,
    -1
  )
  addChrome.run(
    "example.com",
    "broken",
    "",
    encryptV10("x", "other-pw", 1003, "example.com"),
    "/",
    0n,
    0,
    0,
    -1
  )
  chromeDb.close()
  return home
}

void test("the importer lists sites and reads chosen cookies from fixtures", async () => {
  const home = await fakeHome()
  const asked: string[] = []
  const importer = new CookieImporter({
    home,
    platform: "darwin",
    secret: (vendor) => {
      asked.push(vendor.keychain)
      return Promise.resolve("keychain-pw")
    },
  })
  const profiles = importer.profiles()
  assert.deepEqual(
    profiles.map((profile) => [profile.id, profile.browserName, profile.name]),
    [
      ["chrome:Default", "Google Chrome", "Ann"],
      ["firefox:abc.default-release", "Firefox", "Work"],
    ]
  )

  const firefox = await importer.sites("firefox:abc.default-release")
  assert.deepEqual(firefox.sites, [
    { domain: "github.com", count: 1, tag: "Sign-in provider" },
    { domain: "example.com", count: 1 },
  ])
  // No values in the list.
  assert.doesNotMatch(JSON.stringify(firefox), /ff-1|ff-2/)
  const read = await importer.cookies("firefox:abc.default-release", [
    "example.com",
  ])
  assert.deepEqual(read.cookies, [
    {
      name: "pref",
      value: "ff-2",
      domain: "news.example.com",
      path: "/",
      expires: future,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ])

  const chrome = await importer.sites("chrome:Default")
  assert.deepEqual(asked, ["Chrome Safe Storage"])
  assert.equal(chrome.skipped, 1)
  assert.match(chrome.warning ?? "", /Could not decrypt 1/)
  assert.deepEqual(chrome.sites, [
    { domain: "paypal.com", count: 1, tag: "Bank or payments" },
    { domain: "example.com", count: 1 },
  ])
  // The import uses the listed cookies: no second Keychain prompt.
  const chosen = await importer.cookies("chrome:Default", [
    "paypal.com",
    "example.com",
  ])
  assert.deepEqual(asked, ["Chrome Safe Storage"])
  assert.deepEqual(
    chosen.cookies.map((item) => [
      item.name,
      item.value,
      item.sameSite,
      item.expires,
    ]),
    [
      ["token", "pp-secret", "None", future],
      ["plain", "visible", "Lax", -1],
    ]
  )
  await assert.rejects(importer.sites("chrome:Nope"), /No browser profile/)
})

function listen(server: Server) {
  return new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port)
    )
  )
}

void test(
  "imported cookies reach new and open contexts, and the removal takes them out",
  { skip: findChrome() ? false : "No Chrome on this machine" },
  async () => {
    const dir = await tempDir()
    const site = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/plain" })
      response.end(`cookie=${request.headers.cookie ?? "none"}`)
    })
    const port = await listen(site)
    const url = `http://127.0.0.1:${port}/`
    // Conversation 2 has its own cookie "shared".
    await mkdir(join(dir, "browser"), { recursive: true })
    await writeFile(
      join(dir, "browser", "2.json"),
      JSON.stringify({
        cookies: [
          cookie({ name: "shared", value: "own", domain: "127.0.0.1" }),
        ],
        origins: [],
      })
    )
    const browser = new BrowserManager(dir, () => true, { idleMs: 60_000 })
    const text = async (conversation: number) => {
      const { page } = await browser.open(conversation, [], url, false)
      return page.locator("body").innerText()
    }
    try {
      assert.equal(await text(1), "cookie=none")
      const source = {
        browser: "firefox" as const,
        browserName: "Firefox",
        profileName: "Work",
      }
      await browser.importCookies(
        [
          cookie({ name: "shared", value: "imported", domain: "127.0.0.1" }),
          cookie({ name: "extra", value: "x", domain: "127.0.0.1" }),
        ],
        source
      )
      const file = importedCookiesPath(dir)
      assert.equal((await stat(file)).mode & 0o777, 0o600)
      assert.deepEqual(await browser.importStatus(), {
        imported: true,
        count: 2,
        source,
        importedAt: (await browser.importStatus()).importedAt,
      })
      // An open context gets them now.
      const open = await text(1)
      assert.match(open, /shared=imported/)
      assert.match(open, /extra=x/)
      // A new context: the conversation's own cookie wins.
      const own = await text(2)
      assert.match(own, /shared=own/)
      assert.match(own, /extra=x/)
      assert.doesNotMatch(own, /shared=imported/)

      // The conversation file keeps only its own cookies.
      await browser.persist(2)
      const saved = JSON.parse(
        await readFile(join(dir, "browser", "2.json"), "utf8")
      ) as { cookies: ImportedCookie[] }
      assert.deepEqual(
        saved.cookies.map((item) => `${item.name}=${item.value}`),
        ["shared=own"]
      )

      await browser.removeImportedCookies()
      assert.deepEqual(await browser.importStatus(), {
        imported: false,
        count: 0,
      })
      assert.equal(await text(1), "cookie=none")
      assert.equal(await text(2), "cookie=shared=own")
    } finally {
      await browser.shutdown()
      site.closeAllConnections()
      await new Promise((done) => site.close(done))
    }
  }
)
