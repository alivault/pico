import { buildHubRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"

/** Web Push needs a service worker, the Push API, and HTTPS or localhost. */
export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

function keyBytes(base64: string) {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/")
  const raw = window.atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js")
}

/** Whether this browser gets push notifications from this server. */
export async function pushEnabled(viewerContextId: string) {
  if (!pushSupported()) return false
  const existing = await (await registration()).pushManager.getSubscription()
  if (!existing) return false
  const status = await fetchJson<{ subscribed?: boolean }>(
    buildHubRequestUrl("/api/push/key", {
      contextId: viewerContextId,
      searchParams: { endpoint: existing.endpoint },
    })
  )
  return Boolean(status.subscribed)
}

export async function enablePush(viewerContextId: string) {
  if (!pushSupported())
    throw new Error(
      "This browser cannot get push notifications here. Use HTTPS (for example Tailscale Serve) or localhost."
    )
  const permission = await Notification.requestPermission()
  if (permission !== "granted")
    throw new Error("The browser does not allow notifications for Pico.")
  const { publicKey } = await fetchJson<{ publicKey: string }>(
    buildHubRequestUrl("/api/push/key", { contextId: viewerContextId })
  )
  const worker = await registration()
  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }))
  await fetchJson(
    buildHubRequestUrl("/api/push/subscribe", { contextId: viewerContextId }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        label: navigator.userAgent.slice(0, 80),
      }),
    }
  )
}

export async function disablePush(viewerContextId: string) {
  if (!pushSupported()) return
  const subscription = await (
    await registration()
  ).pushManager.getSubscription()
  if (!subscription) return
  await fetchJson(
    buildHubRequestUrl("/api/push/unsubscribe", { contextId: viewerContextId }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }
  )
  await subscription.unsubscribe()
}
