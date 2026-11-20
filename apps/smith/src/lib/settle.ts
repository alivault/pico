export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }

/**
 * The result of a promise as a value, so that a component or hook can handle
 * an error without `try`. The React Compiler skips a component or hook that
 * has `finally`, or a condition (`?:`, `&&`, `?.`) inside `try`.
 */
export function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error })
  )
}

/** The result of `body` as a value, like `settle` for code that does not wait. */
export function settleSync<T>(body: () => T): Settled<T> {
  try {
    return { ok: true, value: body() }
  } catch (error) {
    return { ok: false, error }
  }
}
