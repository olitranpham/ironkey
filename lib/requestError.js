// User-facing message for a failed staff API call; 403 means the user lacks the permission.
export function requestError(res, json) {
  if (res.status === 403) return "you don't have permission to do that"
  return json?.error || `request failed (${res.status})`
}
