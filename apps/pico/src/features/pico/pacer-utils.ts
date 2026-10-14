import { Throttler } from "@tanstack/pacer"

export type PicoLatestThrottler<TValue> = {
  add: (value: TValue) => void
  flush: () => void
  cancel: () => void
}

export function createPicoLatestThrottler<TValue>(options: {
  key: string
  wait: number
  onLatest: (value: TValue) => void
}): PicoLatestThrottler<TValue> {
  const throttler = new Throttler(
    (value: TValue) => {
      options.onLatest(value)
    },
    {
      key: options.key,
      wait: options.wait,
      leading: false,
      trailing: true,
    }
  )

  return {
    add: (value) => throttler.maybeExecute(value),
    flush: () => throttler.flush(),
    cancel: () => throttler.cancel(),
  }
}
