/**
 * Notifications to the user's devices: Web Push (VAPID) to browsers that
 * subscribed in the settings, and optionally an ntfy topic URL.
 *
 * Keys and subscriptions live in `<data>/push.json`. Browsers allow Web Push
 * only on HTTPS or localhost; over Tailscale, use Tailscale Serve for HTTPS.
 * On iOS, the web app must be on the home screen.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import webpush, { type PushSubscription } from "web-push"

type StoredSubscription = PushSubscription & {
  addedAt: number
  /** A short name for the device, for example "Chrome on Linux". */
  label?: string
  /** The page origin that subscribed, for example "http://localhost:3141". */
  origin?: string
  /** The full user agent. It identifies the browser across origins. */
  userAgent?: string
}

type PushFile = {
  vapid: { publicKey: string; privateKey: string }
  subscriptions: StoredSubscription[]
}

export type PushDevice = {
  endpoint: string
  label?: string
  origin?: string
  addedAt: number
}

export type SubscribeOptions = {
  label?: string
  origin?: string
  userAgent?: string
}

/**
 * Whether a stored subscription comes from the browser with this user agent.
 * Older entries kept only the first 80 characters of the user agent as label.
 */
function sameBrowser(item: StoredSubscription, userAgent: string) {
  if (item.userAgent) return item.userAgent === userAgent
  return !item.origin && item.label === userAgent.slice(0, 80)
}

export type Notification = {
  title: string
  body: string
  /** The page to open when the user clicks the notification. */
  url?: string
  /** Replaces an earlier notification with the same tag. */
  tag?: string
  level?: "info" | "success" | "warning" | "error"
}

type PushSender = typeof webpush.sendNotification

export class Notifier {
  readonly #file: string
  readonly #ntfyUrl: () => string
  readonly #sendPush: PushSender
  #data: PushFile

  /** `sendPush` replaces Web Push delivery, for tests. */
  constructor(dataDir: string, ntfyUrl: () => string, sendPush?: PushSender) {
    this.#file = join(dataDir, "push.json")
    this.#ntfyUrl = ntfyUrl
    this.#sendPush =
      sendPush ?? ((...args) => webpush.sendNotification(...args))
    this.#data = this.#load()
  }

  #load(): PushFile {
    try {
      if (existsSync(this.#file)) {
        const data = JSON.parse(readFileSync(this.#file, "utf8")) as PushFile
        if (data.vapid?.publicKey && data.vapid.privateKey)
          return { ...data, subscriptions: data.subscriptions ?? [] }
      }
    } catch {
      // Make new keys below.
    }
    const keys = webpush.generateVAPIDKeys()
    const data: PushFile = { vapid: keys, subscriptions: [] }
    this.#save(data)
    return data
  }

  #save(data = this.#data) {
    mkdirSync(dirname(this.#file), { recursive: true })
    const temporary = `${this.#file}.tmp`
    writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(temporary, this.#file)
  }

  get publicKey() {
    return this.#data.vapid.publicKey
  }

  get subscriptionCount() {
    return this.#data.subscriptions.length
  }

  get devices(): PushDevice[] {
    return this.#data.subscriptions.map((item) => ({
      endpoint: item.endpoint,
      addedAt: item.addedAt,
      ...(item.label ? { label: item.label } : {}),
      ...(item.origin ? { origin: item.origin } : {}),
    }))
  }

  /**
   * Add a subscription. A browser keeps one subscription for each origin
   * (localhost, a dev port, a Tailscale URL), and each one shows its own
   * notification. So a new subscription replaces the older ones from the
   * same browser: the same user agent.
   */
  subscribe(
    subscription: PushSubscription,
    { label, origin, userAgent }: SubscribeOptions = {}
  ) {
    if (!subscription?.endpoint || !subscription.keys?.p256dh)
      throw new Error("Invalid push subscription")
    this.#data.subscriptions = [
      ...this.#data.subscriptions.filter(
        (item) =>
          item.endpoint !== subscription.endpoint &&
          !(userAgent && sameBrowser(item, userAgent))
      ),
      {
        ...subscription,
        addedAt: Date.now(),
        ...(label ? { label } : {}),
        ...(origin ? { origin } : {}),
        ...(userAgent ? { userAgent } : {}),
      },
    ]
    this.#save()
  }

  unsubscribe(endpoint: string) {
    const before = this.#data.subscriptions.length
    this.#data.subscriptions = this.#data.subscriptions.filter(
      (item) => item.endpoint !== endpoint
    )
    if (this.#data.subscriptions.length !== before) this.#save()
  }

  has(endpoint: string) {
    return this.#data.subscriptions.some((item) => item.endpoint === endpoint)
  }

  /**
   * Send to every device; returns how many received it. `ntfy: false` sends
   * Web Push only, for example for a remote machine that has its own ntfy.
   */
  async send(notification: Notification, options: { ntfy?: boolean } = {}) {
    const payload = JSON.stringify(notification)
    let delivered = 0
    const gone: string[] = []
    await Promise.all(
      this.#data.subscriptions.map(async (subscription) => {
        try {
          await this.#sendPush(subscription, payload, {
            vapidDetails: {
              subject: "mailto:pico@localhost",
              publicKey: this.#data.vapid.publicKey,
              privateKey: this.#data.vapid.privateKey,
            },
            TTL: 3600,
            ...(notification.tag
              ? { topic: notification.tag.replace(/[^\w-]/g, "").slice(0, 32) }
              : {}),
          })
          delivered += 1
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) gone.push(subscription.endpoint)
          else console.warn("[pico] push failed:", (error as Error).message)
        }
      })
    )
    for (const endpoint of gone) this.unsubscribe(endpoint)
    const ntfy = options.ntfy === false ? "" : this.#ntfyUrl().trim()
    if (ntfy) {
      try {
        const response = await fetch(ntfy, {
          method: "POST",
          body: notification.body,
          headers: {
            Title: notification.title.replace(/[^\x20-\x7e]/g, "?"),
            ...(notification.url ? { Click: notification.url } : {}),
            ...(notification.level === "error" ? { Priority: "high" } : {}),
          },
          signal: AbortSignal.timeout(10_000),
        })
        if (response.ok) delivered += 1
      } catch (error) {
        console.warn("[pico] ntfy failed:", (error as Error).message)
      }
    }
    return delivered
  }
}
