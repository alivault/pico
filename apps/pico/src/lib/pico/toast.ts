/**
 * Sonner's toast, with two changes:
 * - Toasts about an offline machine merge into one toast. Each change to an
 *   offline machine fails with the same message, so without this a page that
 *   sends many changes shows many equal toasts.
 * - Toasts about an unreachable Pico server merge into one toast, and the
 *   page shows no such toast while it shows the "server unreachable" view.
 * Import `toast` from here, not from "sonner".
 */
import { toast as sonnerToast, type ExternalToast } from "sonner"

import { findMachineOfflineMessage } from "@/lib/pico/machine"
import {
  onServerConnectionChange,
  SERVER_UNREACHABLE_MESSAGE,
  serverConnectionState,
} from "@/lib/pico/server-connection"

const SERVER_UNREACHABLE_TOAST_ID = "server-unreachable"

// The view replaces the toast; a reconnect makes the toast old news.
onServerConnectionChange(() => {
  sonnerToast.dismiss(SERVER_UNREACHABLE_TOAST_ID)
})

type ToastMessage = Parameters<typeof sonnerToast>[0]
type ShowToast = (
  message: ToastMessage,
  data?: ExternalToast
) => string | number

function offlineMessage(message: ToastMessage, data?: ExternalToast) {
  for (const text of [message, data?.description]) {
    if (typeof text !== "string") continue
    const found = findMachineOfflineMessage(text)
    if (found) return found
  }
  return undefined
}

function isServerUnreachable(message: ToastMessage, data?: ExternalToast) {
  return [message, data?.description].some(
    (text) =>
      typeof text === "string" && text.includes(SERVER_UNREACHABLE_MESSAGE)
  )
}

function dedupeOffline(show: ShowToast): ShowToast {
  return (message, data) => {
    if (isServerUnreachable(message, data)) {
      if (serverConnectionState() === "unreachable")
        return SERVER_UNREACHABLE_TOAST_ID
      return sonnerToast.error(SERVER_UNREACHABLE_MESSAGE, {
        ...data,
        description: undefined,
        id: SERVER_UNREACHABLE_TOAST_ID,
      })
    }
    const offline = offlineMessage(message, data)
    if (!offline) return show(message, data)
    // The same ID replaces the toast that is open, instead of adding one.
    return sonnerToast.error(offline, {
      ...data,
      description: undefined,
      id: `machine-offline:${offline}`,
    })
  }
}

export const toast: typeof sonnerToast = Object.assign(
  dedupeOffline(sonnerToast),
  sonnerToast,
  {
    error: dedupeOffline(sonnerToast.error),
    warning: dedupeOffline(sonnerToast.warning),
    info: dedupeOffline(sonnerToast.info),
    message: dedupeOffline(sonnerToast.message),
  }
)
