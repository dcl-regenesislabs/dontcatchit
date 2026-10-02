import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'

/**
 * Each player's music settings, kept in the scene's player Storage so they come back next visit.
 * Clients only send a change after the player stops adjusting, and writes are skipped when nothing changed.
 */

export interface MusicPrefs {
  volume: number // music, 0-100
  muted: boolean
  sfxVolume: number // effects, 0-100
  sfxMuted: boolean
}

const KEY = 'musicPrefs'
const MIN_WRITE_GAP_MS = 3000 // per player; a newer value arriving inside the gap is saved when the gap ends

const cache = new Map<string, MusicPrefs>()
const lastWrite = new Map<string, number>()
const pending = new Map<string, MusicPrefs>()

const pctOf = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback
}

function clean(raw: Partial<MusicPrefs>): MusicPrefs {
  return {
    volume: pctOf(raw.volume, 30),
    muted: raw.muted === true,
    sfxVolume: pctOf(raw.sfxVolume, 60), // older saves have no effects settings: use the defaults
    sfxMuted: raw.sfxMuted === true
  }
}

export async function loadMusicPrefs(address: string): Promise<MusicPrefs | undefined> {
  const cached = cache.get(address)
  if (cached) return cached
  try {
    const raw = await Storage.player.get<unknown>(address, KEY)
    const stored = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (stored && typeof stored === 'object') {
      const prefs = clean(stored as Partial<MusicPrefs>)
      cache.set(address, prefs)
      return prefs
    }
  } catch (error) {
    console.log('[SERVER] music prefs load failed:', error)
  }
  return undefined
}

export function saveMusicPrefs(address: string, raw: Partial<MusicPrefs>) {
  const prefs = clean(raw)
  const known = cache.get(address)
  if (known && JSON.stringify(known) === JSON.stringify(prefs)) return
  cache.set(address, prefs)
  pending.set(address, prefs)
  flush(address)
}

function flush(address: string) {
  const prefs = pending.get(address)
  if (!prefs) return
  const wait = MIN_WRITE_GAP_MS - (Date.now() - (lastWrite.get(address) ?? 0))
  if (wait > 0) {
    // retried by the system below once the gap is over; it writes whatever is newest by then
    if (!watching) {
      watching = true
      engine.addSystem(() => {
        for (const waiting of [...pending.keys()]) {
          if (Date.now() - (lastWrite.get(waiting) ?? 0) >= MIN_WRITE_GAP_MS) flush(waiting)
        }
      })
    }
    return
  }
  pending.delete(address)
  lastWrite.set(address, Date.now())
  void Storage.player.set(address, KEY, JSON.stringify(prefs)).then((ok) => {
    if (!ok) console.log('[SERVER] music prefs save failed for', address)
  })
}
let watching = false
