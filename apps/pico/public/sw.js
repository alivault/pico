// Pico's service worker: shows push notifications and opens the session on click.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
)

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : "" }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Pico", {
      body: data.body || "",
      tag: data.tag,
      data: { url: data.url || "/" },
      icon: "/favicon.png",
      badge: "/favicon.png",
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || "/", self.location.origin)
    .href
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // Use an open Pico tab: focus it and tell the app to open the
        // session. A navigation would load the whole app again.
        const client =
          windows.find((item) => item.focused) ??
          windows.find((item) => item.visibilityState === "visible") ??
          windows[0]
        if (client && "focus" in client) {
          client.postMessage({ type: "pico:open-url", url })
          return client.focus()
        }
        return self.clients.openWindow(url)
      })
  )
})
