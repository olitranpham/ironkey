// Browser-side: ask the server for a door code that's unused at this gym
// (POST /api/[gymSlug]/pins — collision-checked, requires door.manage).

/**
 * @param {string} gymSlug
 * @returns {Promise<string>}
 * @throws with a user-facing message on failure
 */
export async function suggestPin(gymSlug) {
  const token = localStorage.getItem('ik_token')
  const res   = await fetch(`/api/${gymSlug}/pins`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json().catch(() => ({}))
  if (res.status === 403) throw new Error("you don't have permission to set door codes")
  if (!res.ok || !json.pin) throw new Error(json.error || 'could not generate a code')
  return json.pin
}

/** onClick helper: fill a code input with a suggested PIN, alerting on failure. */
export function fillSuggestedPin(gymSlug, setValue) {
  return suggestPin(gymSlug).then(setValue).catch(err => alert(err.message))
}
