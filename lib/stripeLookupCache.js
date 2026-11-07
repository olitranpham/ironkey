// In-process cache for Stripe lookups whose answers don't change: the
// products on a paid invoice or a completed Checkout Session. Lets the
// revenue page skip those Stripe calls on repeat loads.
//
// Per process (Railway runs one replica) and lost on redeploy, which only
// costs one cold load. Entries expire after TTL_MS; the oldest are dropped
// past MAX_ENTRIES.

const TTL_MS      = 24 * 60 * 60 * 1000   // 24 h
const MAX_ENTRIES = 50_000

const store = new Map()   // key → { value, expires }

/**
 * Cached value for `key`, or `await load()` stored for `ttlMs` (default
 * TTL_MS). A failed load is not cached.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} load
 * @param {number} [ttlMs]
 * @returns {Promise<T>}
 */
export async function cachedLookup(key, load, ttlMs = TTL_MS) {
  const hit = store.get(key)
  if (hit && hit.expires > Date.now()) return hit.value

  const value = await load()
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value)
  store.set(key, { value, expires: Date.now() + ttlMs })
  return value
}

/** Drop a cached entry (e.g. after a change that makes it stale). */
export function forgetLookup(key) {
  store.delete(key)
}
