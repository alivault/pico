export type DesktopNotificationPermission =
  | NotificationPermission
  | "unsupported"

const SESSION_DONE_NOTIFICATION_DURATION_MS = 4_000
const SESSION_DONE_SOUND_URL = "/sounds/session-done.mp3"
const SESSION_DONE_SOUND_GAIN = 0.85

type AudioContextConstructor = typeof AudioContext

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: AudioContextConstructor
}

let sharedAudioContext: AudioContext | null = null
let sessionDoneSoundBuffer: AudioBuffer | null = null
let sessionDoneSoundBufferPromise: Promise<AudioBuffer | null> | null = null

function audioContextConstructor() {
  if (typeof window === "undefined") return null

  const windowWithWebkitAudioContext = window as WindowWithWebkitAudioContext
  return (
    globalThis.AudioContext ??
    windowWithWebkitAudioContext.webkitAudioContext ??
    null
  )
}

function hasTransientUserActivation() {
  if (typeof navigator === "undefined") return false

  const userActivation = navigator.userActivation
  return userActivation ? userActivation.isActive : true
}

function getSharedAudioContext({
  requireUserActivation = false,
}: {
  requireUserActivation?: boolean
} = {}) {
  const AudioContextConstructor = audioContextConstructor()
  if (!AudioContextConstructor) return null

  if (!sharedAudioContext) {
    if (requireUserActivation && !hasTransientUserActivation()) return null
    sharedAudioContext = new AudioContextConstructor()
  }

  return sharedAudioContext
}

async function ensureAudioContextRunning(audioContext: AudioContext) {
  if (audioContext.state === "suspended") {
    if (!hasTransientUserActivation()) return false

    try {
      await audioContext.resume()
    } catch {
      return false
    }
  }

  return audioContext.state === "running"
}

async function loadSessionDoneSound(audioContext: AudioContext) {
  if (sessionDoneSoundBuffer) return sessionDoneSoundBuffer

  sessionDoneSoundBufferPromise ??= fetch(SESSION_DONE_SOUND_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${SESSION_DONE_SOUND_URL}`)
      }

      return response.arrayBuffer()
    })
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
    .then((buffer) => {
      sessionDoneSoundBuffer = buffer
      return buffer
    })
    .catch(() => {
      sessionDoneSoundBufferPromise = null
      return null
    })

  return sessionDoneSoundBufferPromise
}

function playGeneratedSessionDoneSound(audioContext: AudioContext) {
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
}

export async function primeSessionDoneSound() {
  const audioContext = getSharedAudioContext({ requireUserActivation: true })
  if (!audioContext) return false

  const running = await ensureAudioContextRunning(audioContext)
  if (!running) return false

  const soundBuffer = await loadSessionDoneSound(audioContext)
  return Boolean(soundBuffer)
}

export async function playSessionDoneSound() {
  const audioContext = getSharedAudioContext({ requireUserActivation: true })
  if (!audioContext) return false

  const running = await ensureAudioContextRunning(audioContext)
  if (!running) return false

  const soundBuffer = await loadSessionDoneSound(audioContext)
  if (!soundBuffer) {
    playGeneratedSessionDoneSound(audioContext)
    return true
  }

  const source = audioContext.createBufferSource()
  const gainNode = audioContext.createGain()

  source.buffer = soundBuffer
  gainNode.gain.value = SESSION_DONE_SOUND_GAIN

  source.connect(gainNode)
  gainNode.connect(audioContext.destination)
  source.start()

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
