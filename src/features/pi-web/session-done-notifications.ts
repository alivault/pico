export type DesktopNotificationPermission =
  | NotificationPermission
  | "unsupported"

const SESSION_DONE_NOTIFICATION_DURATION_MS = 4_000

type AudioContextConstructor = typeof AudioContext

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: AudioContextConstructor
}

let sharedAudioContext: AudioContext | null = null

function audioContextConstructor() {
  if (typeof window === "undefined") return null

  const windowWithWebkitAudioContext = window as WindowWithWebkitAudioContext
  return (
    globalThis.AudioContext ??
    windowWithWebkitAudioContext.webkitAudioContext ??
    null
  )
}

function getSharedAudioContext() {
  const AudioContextConstructor = audioContextConstructor()
  if (!AudioContextConstructor) return null

  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextConstructor()
  }

  return sharedAudioContext
}

export async function primeSessionDoneSound() {
  const audioContext = getSharedAudioContext()
  if (!audioContext) return false

  if (audioContext.state === "suspended") {
    await audioContext.resume()
  }

  return audioContext.state === "running"
}

export async function playSessionDoneSound() {
  const audioContext = getSharedAudioContext()
  if (!audioContext) return false

  if (audioContext.state === "suspended") {
    await audioContext.resume()
  }

  if (audioContext.state !== "running") {
    return false
  }

  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()

  oscillator.type = "triangle"
  oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime)
  oscillator.frequency.linearRampToValueAtTime(
    783.99,
    audioContext.currentTime + 0.12
  )

  gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(
    0.08,
    audioContext.currentTime + 0.02
  )
  gainNode.gain.exponentialRampToValueAtTime(
    0.0001,
    audioContext.currentTime + 0.28
  )

  oscillator.connect(gainNode)
  gainNode.connect(audioContext.destination)

  oscillator.start(audioContext.currentTime)
  oscillator.stop(audioContext.currentTime + 0.3)

  return true
}

export function getDesktopNotificationPermission(): DesktopNotificationPermission {
  if (typeof Notification === "undefined") {
    return "unsupported"
  }

  return Notification.permission
}

export async function requestDesktopNotificationPermission() {
  if (typeof Notification === "undefined") {
    return "unsupported" as const
  }

  const result = Notification.requestPermission()
  return typeof result === "string" ? result : await result
}

export function showSessionDoneDesktopNotification({
  title,
  body,
  tag,
}: {
  title: string
  body?: string
  tag?: string
}) {
  if (typeof Notification === "undefined") {
    return false
  }

  if (Notification.permission !== "granted") {
    return false
  }

  try {
    const notification = new Notification(title, {
      body,
      tag,
      silent: true,
    })

    window.setTimeout(() => {
      notification.close()
    }, SESSION_DONE_NOTIFICATION_DURATION_MS)

    return true
  } catch {
    return false
  }
}
