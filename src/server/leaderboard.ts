import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'
import { LEADERBOARD } from '../shared/config'
import { Leaderboard } from '../shared/schemas'

/**
 * Match wins per player, kept in memory and saved to the scene's Storage. Saving happens only when someone wins a
 * match (a few times an hour at most), never per tick: Storage writes are capped and a failed write is silent.
 */

interface Record {
  wins: number
  name: string
}

const STORAGE_KEY = 'leaderboard'
const MAX_STORED = 200 // lowest-ranked players beyond this are forgotten when saving

const records = new Map<string, Record>()
let entity: Entity
let dirty = false
let saving = false

export function initLeaderboard() {
  entity = engine.addEntity()
  Leaderboard.create(entity, { entries: [] })
  syncEntity(entity, [Leaderboard.componentId], 4)
  void load()
}

async function load() {
  try {
    const raw = await Storage.get<unknown>(STORAGE_KEY)
    const stored = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (stored && typeof stored === 'object') {
      for (const [address, value] of Object.entries(stored as { [address: string]: Record })) {
        const wins = Number(value?.wins)
        if (!Number.isFinite(wins) || wins <= 0) continue
        const existing = records.get(address) // a win recorded before the load finished must not be lost
        records.set(address, { wins: Math.max(wins, existing?.wins ?? 0), name: existing?.name || String(value.name ?? '') })
      }
    }
    console.log(`[SERVER] leaderboard loaded: ${records.size} players`)
  } catch (error) {
    console.log('[SERVER] leaderboard load failed:', error)
  }
  publish()
}

/** Keeps a player's display name (cosmetic, sent by their client). It is saved with their next win. */
export function setName(address: string, rawName: string) {
  const name = rawName.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24)
  if (!name) return
  const record = records.get(address)
  if (record && record.name !== name) {
    record.name = name
    dirty = true
    publish()
  }
  names.set(address, name)
}
const names = new Map<string, string>()

export function recordWin(address: string) {
  const record = records.get(address) ?? { wins: 0, name: names.get(address) ?? '' }
  record.wins++
  if (names.has(address)) record.name = names.get(address) as string
  records.set(address, record)
  dirty = true
  publish()
  void save()
  console.log(`[SERVER] win for ${address}: ${record.wins} total`)
}

function ranked() {
  return [...records.entries()].sort((a, b) => b[1].wins - a[1].wins || a[1].name.localeCompare(b[1].name))
}

function publish() {
  Leaderboard.getMutable(entity).entries = ranked()
    .slice(0, LEADERBOARD.rows)
    .map(([playerId, r]) => ({ playerId, name: r.name, wins: r.wins }))
}

async function save() {
  if (saving) return // the running save loop picks up anything that changed meanwhile
  saving = true
  try {
    while (dirty) {
      dirty = false
      const top = Object.fromEntries(ranked().slice(0, MAX_STORED))
      const ok = await Storage.set(STORAGE_KEY, JSON.stringify(top))
      if (!ok) {
        console.log('[SERVER] leaderboard save failed (will retry after the next win)')
        dirty = true
        break
      }
    }
  } finally {
    saving = false
  }
}
