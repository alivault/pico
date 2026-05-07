import { scan } from "react-scan"

declare global {
  interface Window {
    __PICO_REACT_SCAN_ENABLED__?: boolean
  }
}

if (
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  !window.__PICO_REACT_SCAN_ENABLED__
) {
  window.__PICO_REACT_SCAN_ENABLED__ = true

  scan({
    enabled: true,
  })
}
