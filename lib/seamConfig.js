// A gym's own Seam lock: its stored API key AND device, or null. There is no
// shared-key fallback and never an "every device on the key" lookup — a gym
// without both gets no Seam calls at all (door access shows "no lock connected").

/**
 * @param {{ seamApiKey?: string|null, seamDeviceId?: string|null } | null} gym
 * @returns {{ apiKey: string, deviceId: string } | null}
 */
export function seamConfig(gym) {
  if (!gym?.seamApiKey || !gym?.seamDeviceId) return null
  return { apiKey: gym.seamApiKey, deviceId: gym.seamDeviceId }
}
