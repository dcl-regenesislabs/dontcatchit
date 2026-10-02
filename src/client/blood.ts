import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { ARENA_CENTER, ARENA_FLOOR_Y, ARENA_RADIUS, Phase } from '../shared/config'
import { GameState } from '../shared/schemas'

/**
 * Blood splats on the arena ring where players were eliminated. They stay until the next game's players are teleported
 * in (the start of the 3-2-1, right after the 10-1 countdown), then all clear at once.
 */

const SPLATS = [1, 2, 3, 4].map((n) => `assets/models/blood/Blood0${n}.glb`) // flat 2 m decals, from the dead-surge scene
const SPLAT_SCALE = { min: 1.8, max: 2.8 }
const SPLAT_EDGE_MARGIN = 1.5 // keep splats inside the ring's rim

const splats: Entity[] = []

/** Leaves a splat on the ring at (x, z). Spots off the ring (the lava) are pulled in to the nearest point on the ring. */
export function bloodSplat(x: number, z: number) {
  if (x === 0 && z === 0) return // the server had no position for them
  const dx = x - ARENA_CENTER.x
  const dz = z - ARENA_CENTER.z
  const r = Math.hypot(dx, dz)
  const maxR = ARENA_RADIUS - SPLAT_EDGE_MARGIN
  const k = r > maxR ? maxR / r : 1
  const size = SPLAT_SCALE.min + Math.random() * (SPLAT_SCALE.max - SPLAT_SCALE.min)
  const entity = engine.addEntity()
  Transform.create(entity, {
    // each new splat sits a hair above the last, so overlapping ones don't flicker
    position: Vector3.create(ARENA_CENTER.x + dx * k, ARENA_FLOOR_Y + 0.03 + splats.length * 0.002, ARENA_CENTER.z + dz * k),
    rotation: Quaternion.fromEulerDegrees(0, Math.random() * 360, 0),
    scale: Vector3.create(size, 1, size)
  })
  GltfContainer.create(entity, {
    src: SPLATS[Math.floor(Math.random() * SPLATS.length)],
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  splats.push(entity)
}

export function clearBlood() {
  for (const e of splats) engine.removeEntity(e)
  splats.length = 0
}

/** Wipes the splats when the next game starts (players land on the arena). */
export function setupBlood() {
  let lastPhase = ''
  engine.addSystem(() => {
    let phase = ''
    for (const [, s] of engine.getEntitiesWith(GameState)) phase = s.phase
    if (phase === Phase.Starting && lastPhase !== Phase.Starting) clearBlood()
    lastPhase = phase
  })
}
