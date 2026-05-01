import type * as React from "react"
import type { Store } from "@tanstack/store"
import { batch, createStore, shallow } from "@tanstack/store"
import { useSelector } from "@tanstack/react-store"

export type PhiStore<T> = Store<T>
export type StoreCompare<T> = (left: T, right: T) => boolean

const storeComparators = new WeakMap<object, StoreCompare<unknown>>()

export function createPhiStore<T>(
  initialState: T,
  compare: StoreCompare<T> = Object.is
): PhiStore<T> {
  const store = createStore(initialState)
  storeComparators.set(store, compare as StoreCompare<unknown>)
  return store
}

export function applyStoreAction<T>(
  current: T,
  action: React.SetStateAction<T>
): T {
  return typeof action === "function"
    ? (action as (current: T) => T)(current)
    : action
}

export function setStoreState<T>(
  store: PhiStore<T>,
  action: React.SetStateAction<T>,
  compare?: StoreCompare<T>
) {
  const current = store.state
  const next = applyStoreAction(current, action)
  const isEqual =
    compare ??
    (storeComparators.get(store) as StoreCompare<T> | undefined) ??
    Object.is
  if (isEqual(current, next)) return
  store.setState(() => next)
}

export function setStoreField<T extends object, K extends keyof T>(
  store: PhiStore<T>,
  key: K,
  action: React.SetStateAction<T[K]>,
  compare: StoreCompare<T[K]> = Object.is
) {
  setStoreState(store, (current) => {
    const nextValue = applyStoreAction(current[key], action)
    if (compare(current[key], nextValue)) return current
    return {
      ...current,
      [key]: nextValue,
    }
  })
}

export const objectIs = Object.is

export { batch, shallow, useSelector }
