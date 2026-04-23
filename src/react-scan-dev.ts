import { scan } from "react-scan"

declare global {
  interface Window {
    __PI_WEB_REACT_SCAN_ENABLED__?: boolean
  }
}

if (
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  !window.__PI_WEB_REACT_SCAN_ENABLED__
) {
  window.__PI_WEB_REACT_SCAN_ENABLED__ = true

  scan({
    enabled: true,
  })
}
