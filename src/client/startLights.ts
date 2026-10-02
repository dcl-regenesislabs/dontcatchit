import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { COUNTDOWN_SECONDS, Phase } from '../shared/config'
import { GameState } from '../shared/schemas'
import { HOVER_SFX } from './sfx'
import { sfxPrefs } from './music'

const LIGHTS_NAME = 'StartGameLights.glb'
const HOVER_VOLUME = 1 // the loudest the renderer allows; the clip itself was also normalized, so it cuts through the music
const HOVER_RANGE = 28 // meters from the pad at which the hover is no longer heard
const HOVER_FULL_VOLUME_DIST = 6
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const SPIN_SLOW_DEG_PER_S = 30 // when the second player steps on
const SPIN_FAST_DEG_PER_S = 540 // by the end of the countdown and during the 3-2-1
const SPIN_EASE = 2 // how quickly the spin speeds up / slows down
const TALL = 1.5 // vertical stretch during the 3-2-1
const SCALE_STIFFNESS = 90
const SCALE_DAMPING = 9 // under-damped, so scale changes overshoot a little and settle (soft bounce)

/**
 * The lights over the start pad (placed in the editor as StartGameLights.glb). Clients only, driven by the synced GameState:
 *  - someone on the pad: pops up (springy scale), 
 *  - two or more on the pad (the countdown): spins,
 *  - the 3-2-1: stretches taller,
 *  - the round begins (or everyone leaves): shrinks away vertically.
 */
export function setupStartLights() {
  let entity: Entity | undefined
  let baseScale = Vector3.One()
  let baseRotation = Quaternion.Identity()
  // Spring state for the overall size (0 = hidden, 1 = shown) and the extra vertical stretch.
  let size = 0
  let sizeV = 0
  let tall = 0
  let tallV = 0
  let spin = 0 // current speed in deg/s
  // Hover loop over the pad: plays while someone stands on it, stops when nobody does or the round starts (teleport)
  const hover = engine.addEntity()
  // Parented to the player (zero distance) like the music, so it plays at a flat volume and we fade it by distance ourselves
  Transform.create(hover, { parent: engine.PlayerEntity, position: Vector3.Zero() })
  AudioSource.create(hover, { audioClipUrl: HOVER_SFX, playing: false, loop: true, volume: 0 })
  let hoverOn = false
  let hoverVolume = -1
  let angle = 0

  engine.addSystem((dt: number) => {
    if (entity === undefined) {
      entity = engine.getEntityOrNullByName(LIGHTS_NAME) ?? undefined
      if (entity === undefined) return
      const t = Transform.get(entity)
      baseScale = Vector3.create(t.scale.x, t.scale.y, t.scale.z)
      baseRotation = Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w)
    }

    let phase: string = Phase.Lobby
    let queued = 0
    let secondsLeft = 0
    for (const [, s] of engine.getEntitiesWith(GameState)) {
      phase = s.phase
      queued = s.queued
      secondsLeft = s.secondsLeft
    }
    const starting = phase === Phase.Starting
    const waiting = phase === Phase.Lobby || phase === Phase.Countdown
    const show = starting || (waiting && queued >= 1)
    const spinning = starting || (waiting && queued >= 2)

    // Hover loop: only for players near the pad, louder the closer they are
    const padPos = Transform.get(entity).position
    const me = Transform.getOrNull(engine.PlayerEntity)?.position
    const dist = me ? Math.hypot(me.x - padPos.x, me.z - padPos.z) : 999
    const near = clamp01((HOVER_RANGE - dist) / (HOVER_RANGE - HOVER_FULL_VOLUME_DIST))
    const hoverWanted = waiting && queued >= 1 && !sfxPrefs.muted() && near > 0
    const volume = HOVER_VOLUME * near * sfxPrefs.volume()
    if (hoverWanted !== hoverOn) {
      hoverOn = hoverWanted
      hoverVolume = volume
      // whole component re-sent (the Marsh Colony pattern): reliable start and stop
      AudioSource.createOrReplace(hover, { audioClipUrl: HOVER_SFX, playing: hoverWanted, loop: true, volume })
    } else if (hoverOn && Math.abs(volume - hoverVolume) > 0.01) {
      hoverVolume = volume
      AudioSource.getMutable(hover).volume = volume
    }

    const sizeTarget = show ? 1 : 0
    const tallTarget = starting ? 1 : 0
    // Starts slow and speeds up as the countdown runs out (accelerating curve), full speed for the 3-2-1.
    let progress = 1
    if (phase === Phase.Countdown) progress = Math.min(1, Math.max(0, 1 - (secondsLeft - 1) / COUNTDOWN_SECONDS))
    const spinTarget = SPIN_SLOW_DEG_PER_S + (SPIN_FAST_DEG_PER_S - SPIN_SLOW_DEG_PER_S) * progress * progress
    spin += ((spinning ? spinTarget : 0) - spin) * Math.min(1, SPIN_EASE * dt)
    angle = (angle + spin * dt) % 360

    // Spring integration (substepped so a long frame can't blow it up)
    const steps = Math.max(1, Math.ceil(dt / 0.016))
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      sizeV += ((sizeTarget - size) * SCALE_STIFFNESS - sizeV * SCALE_DAMPING) * h
      size += sizeV * h
      tallV += ((tallTarget - tall) * SCALE_STIFFNESS - tallV * SCALE_DAMPING) * h
      tall += tallV * h
    }

    const t = Transform.getMutable(entity)
    const s = Math.max(0, size)
    if (s < 0.001 && !show) {
      t.scale = Vector3.create(baseScale.x, 0, baseScale.z)
    } else {
      const stretch = 1 + (TALL - 1) * tall
      // Appearing and disappearing is vertical only: width and depth stay put.
      t.scale = Vector3.create(baseScale.x, baseScale.y * s * stretch, baseScale.z)
    }
    t.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, angle, 0), baseRotation)
  })
}
