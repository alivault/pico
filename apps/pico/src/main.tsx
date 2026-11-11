import * as React from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"

import { createPicoQueryClient } from "@/lib/pico/query-client"
import { getRouter } from "@/router"

import "./styles.css"

if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true") {
  void import("./react-scan-dev")
}

// A new web build removes the old chunks. A page from before the build then
// cannot load a lazy chunk; load the page again to get the new build. Only one
// time in 30 s, so a chunk that is really missing does not loop.
window.addEventListener("vite:preloadError", (event) => {
  const key = "pico:chunk-reload-at"
  const last = Number(sessionStorage.getItem(key) ?? 0)
  if (Date.now() - last < 30_000) return
  sessionStorage.setItem(key, String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

const rootElement = document.querySelector<HTMLDivElement>("#app")
if (!rootElement) throw new Error("Pico app root was not found")

const queryClient = createPicoQueryClient()
const router = getRouter()

createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
)
