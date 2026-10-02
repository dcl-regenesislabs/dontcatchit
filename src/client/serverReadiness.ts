import { engine } from '@dcl/sdk/ecs'
import { ServerHeartbeat } from '../shared/schemas'

const ALIVE_WINDOW_MS = 6000 // 3x the server's 2s pulse

let baseline: number | undefined
let lastValue = 0
let lastChangeAt = 0

/**
 * Tracks when the client last *observed* the heartbeat change. Uses client time, so clock skew
 * doesn't matter, and the first value seen is only a baseline: it may be a stale snapshot from
 * a previous server run, so it doesn't count as proof of life.
 */
export function updateServerReadiness() {
  for (const [, h] of engine.getEntitiesWith(ServerHeartbeat)) {
    if (baseline === undefined) {
      baseline = h.at
      lastValue = h.at
      return
    }
    if (h.at !== lastValue) {
      lastValue = h.at
      lastChangeAt = Date.now()
    }
  }
}

export function isServerAlive(): boolean {
  return lastChangeAt > 0 && Date.now() - lastChangeAt < ALIVE_WINDOW_MS
}
