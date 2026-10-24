/**
 * Sonner's toast, with one change: toasts about an offline machine merge into
 * one toast. Each change to an offline machine fails with the same message, so
 * without this a page that sends many changes shows many equal toasts.
 * Import `toast` from here, not from "sonner".
 */
import { toast as sonnerToast, type ExternalToast } from "sonner"

import { findMachineOfflineMessage } from "@/lib/pico/machine"

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

function dedupeOffline(show: ShowToast): ShowToast {
  return (message, data) => {
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
