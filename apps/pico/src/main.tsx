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
