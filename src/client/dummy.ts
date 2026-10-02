import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/src/players'
import { room } from '../shared/messages'
import { dummyBurst, flightPuff } from './effects'
import { BAT_HIT_SFX, BOO_SFX, playSfx, playSfxAt } from './sfx'

/**
 * Pumpkin dummies in the lobby (PumpkinDummy.glb placed in the editor, as many as you like). Swing your bat near one,
 * facing it, and it gets knocked away from you like a pendulum, wobbles back past upright a few times and settles.
 * The hit is sent through the server so every player sees every dummy swing.
 *
 * The model's origin is the base of the pole, so tilting the entity is the pendulum. The tilt is a 2D vector (degrees
 * of lean toward +x / +z) on a damped spring, so hits from different sides add up naturally.
 */
const MODEL = 'PumpkinDummy.glb'
const REACH = 3.2 // meters from the dummy's base (flat distance) at which a swing connects
const FRONT_COS = Math.cos((75 * Math.PI) / 180) // the dummy must be within 75 degrees of where you face
const HIT_DELAY_S = 0.15 // lines the knock up with the swing animation
const KNOCK_DEG_PER_S = 520 // initial speed of the knock: peaks around 30-35 degrees
const STIFFNESS = 110 // pulls back to upright
const DAMPING = 2.6 // low on purpose: it overshoots and wobbles
const MAX_TILT = 55

// The big decorative pumpkins (PumkpinDeco.glb): whack one and it flies off like a boomerang, spinning and leaving
// blobs behind, loops back to where it was placed and settles with a little hover-bounce.
const DECOR_MODEL = 'PumkpinDeco.glb'
const DECOR_HIT_MARGIN = 1 // meters from the pumpkin's SURFACE (its radius comes from its scale) at which a swing connects
const DECOR_FRONT_COS = Math.cos((80 * Math.PI) / 180) // the pumpkin must be within 80 degrees of where you face
const BOOM_TIME = 2.8 // seconds for the whole out-and-back flight
const BOOM_RANGE = 10 // how far it flies away from the player
const BOOM_SWAY = 0.55 // sideways swing of the loop, as a fraction of the range: makes the path a curve, not a line
const BOOM_LIFT = 3.2 // extra height at the top of the flight
const BOOM_SPIN_DEG_PER_S = 760
const SETTLE_TIME = 1.1 // the hover-bounce after landing
const PUFF_EVERY_S = 0.07

interface Decor {
  entity: Entity
  home: Vector3
  radius: number // meters, from the model (about 1 unit) times its scale
  baseRotation: Quaternion
  state: 'idle' | 'fly' | 'settle'
  t: number
  dx: number // flight direction (away from the player), flat and normalized
  dz: number
  side: number // which way the loop curves
  yaw: number
  puffClock: number
}
const decor = new Map<number, Decor>()
const pendingDecorHits: { d: Decor; dx: number; dz: number; at: number; local: boolean }[] = []

interface Dummy {
  entity: Entity
  baseRotation: Quaternion
  tx: number // lean toward +x, degrees
  tz: number
  vx: number
  vz: number
}

const dummies = new Map<number, Dummy>()
const pendingHits: { dummy: Dummy; dx: number; dz: number; at: number; local: boolean }[] = []
let time = 0

function knock(d: Dummy, dx: number, dz: number) {
  d.vx += dx * KNOCK_DEG_PER_S
  d.vz += dz * KNOCK_DEG_PER_S
}

/** The local player swung in the lobby: knock every dummy they are facing and standing close to. */
export function swingAtDummies() {
  const me = engine.PlayerEntity
  const t = Transform.getOrNull(me)
  if (!t) return
  const forward = Vector3.rotate(Vector3.Forward(), t.rotation)
  const fl = Math.hypot(forward.x, forward.z) || 1
  const fx = forward.x / fl
  const fz = forward.z / fl
  for (const [id, d] of dummies) {
    const p = Transform.getOrNull(d.entity)?.position
    if (!p) continue
    const dx = p.x - t.position.x
    const dz = p.z - t.position.z
    const dist = Math.hypot(dx, dz)
    if (dist > REACH || dist < 0.01) continue
    if ((dx / dist) * fx + (dz / dist) * fz < FRONT_COS) continue
    // pushed away from the player
    const nx = dx / dist
    const nz = dz / dist
    pendingHits.push({ dummy: d, dx: nx, dz: nz, at: time + HIT_DELAY_S, local: true })
    room.send('dummyHit', { id, dx: nx, dz: nz, from: getPlayer()?.userId?.toLowerCase() ?? '' })
  }

  // the decorative pumpkins: same swing, but measured in 3D from the chest to their center
  for (const [id, d] of decor) {
    if (d.state !== 'idle') continue
    const dx = d.home.x - t.position.x
    const dz = d.home.z - t.position.z
    const flat = Math.hypot(dx, dz)
    const dist3 = Math.hypot(flat, d.home.y - (t.position.y + 1))
    if (dist3 > d.radius + DECOR_HIT_MARGIN || flat < 0.01) continue
    if ((dx / flat) * fx + (dz / flat) * fz < DECOR_FRONT_COS) continue
    pendingDecorHits.push({ d, dx: dx / flat, dz: dz / flat, at: time + HIT_DELAY_S, local: true })
    room.send('dummyHit', { id, dx: dx / flat, dz: dz / flat, from: getPlayer()?.userId?.toLowerCase() ?? '' })
  }
}

export function setupDummies() {
  // Another player's hit, relayed by the server (ours is applied right away, so its echo is ignored)
  room.onMessage('dummyHit', (m) => {
    if (m.from === getPlayer()?.userId?.toLowerCase()) return
    const d = dummies.get(m.id)
    if (d) pendingHits.push({ dummy: d, dx: m.dx, dz: m.dz, at: time + HIT_DELAY_S, local: false })
    const pumpkin = decor.get(m.id)
    if (pumpkin && pumpkin.state === 'idle') pendingDecorHits.push({ d: pumpkin, dx: m.dx, dz: m.dz, at: time + HIT_DELAY_S, local: false })
  })

  let scan = 0
  engine.addSystem((dt: number) => {
    time += dt

    // Find the dummies (they may be added in the editor at any time)
    scan -= dt
    if (scan <= 0) {
      scan = 1
      for (const [entity, gltf] of engine.getEntitiesWith(GltfContainer)) {
        if (gltf.src.endsWith(DECOR_MODEL) && !decor.has(entity as number)) {
          const dt = Transform.getOrNull(entity)
          if (dt) {
            decor.set(entity as number, {
              entity,
              home: Vector3.create(dt.position.x, dt.position.y, dt.position.z),
              radius: Math.max(dt.scale.x, dt.scale.y, dt.scale.z),
              baseRotation: Quaternion.create(dt.rotation.x, dt.rotation.y, dt.rotation.z, dt.rotation.w),
              state: 'idle',
              t: 0,
              dx: 0,
              dz: 1,
              side: 1,
              yaw: 0,
              puffClock: 0
            })
          }
        }
        if (!gltf.src.endsWith(MODEL) || dummies.has(entity as number)) continue
        const t = Transform.getOrNull(entity)
        if (!t) continue
        dummies.set(entity as number, {
          entity,
          baseRotation: Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w),
          tx: 0,
          tz: 0,
          vx: 0,
          vz: 0
        })
      }
    }

    for (let i = pendingHits.length - 1; i >= 0; i--) {
      const h = pendingHits[i]
      if (time < h.at) continue
      knock(h.dummy, h.dx, h.dz)
      const p = Transform.getOrNull(h.dummy.entity)?.position
      if (p) {
        const head = Vector3.create(p.x, p.y + 1.6, p.z) // about where the pumpkin sits
        playSfxAt(BAT_HIT_SFX, head, h.local ? 0.9 : 0.7)
        dummyBurst(head, h.dx, h.dz)
      }
      pendingHits.splice(i, 1)
    }

    // decorative pumpkins: launch queued hits, then fly / settle
    for (let i = pendingDecorHits.length - 1; i >= 0; i--) {
      const h = pendingDecorHits[i]
      if (time < h.at) continue
      pendingDecorHits.splice(i, 1)
      if (h.d.state !== 'idle') continue
      h.d.state = 'fly'
      h.d.t = 0
      h.d.dx = h.dx
      h.d.dz = h.dz
      h.d.side = Math.random() < 0.5 ? -1 : 1
      h.d.yaw = 0
      h.d.puffClock = 0
      playSfxAt(BAT_HIT_SFX, h.d.home, h.local ? 0.9 : 0.7)
      // once per launch. The hitter hears it flat and full; others hear it from the pumpkin, also at full level
      if (h.local) playSfx(BOO_SFX, 1)
      else playSfxAt(BOO_SFX, h.d.home, 1)
      dummyBurst(h.d.home, h.dx, h.dz, 1.8, 14)
    }
    for (const d of decor.values()) {
      if (d.state === 'idle') continue
      d.t += dt
      const transform = Transform.getMutable(d.entity)
      if (d.state === 'fly') {
        const u = Math.min(1, d.t / BOOM_TIME)
        const out = (1 - Math.cos(2 * Math.PI * u)) / 2 // 0 -> 1 -> 0: away and back
        const sway = Math.sin(2 * Math.PI * u) * d.side // 0 -> + -> 0 -> - -> 0: the loop curves out and returns another way
        const lift = Math.sin(Math.PI * u) * BOOM_LIFT
        const px = d.home.x + d.dx * BOOM_RANGE * out + -d.dz * BOOM_RANGE * BOOM_SWAY * sway
        const pz = d.home.z + d.dz * BOOM_RANGE * out + d.dx * BOOM_RANGE * BOOM_SWAY * sway
        const py = d.home.y + lift
        transform.position = Vector3.create(px, py, pz)
        // spins fast, easing down as it comes home, with a wobble that dies out too
        const calm = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3
        d.yaw += BOOM_SPIN_DEG_PER_S * calm * dt
        const wobble = Math.sin(u * Math.PI * 6) * 22 * calm
        transform.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(wobble, d.yaw, wobble * 0.6), d.baseRotation)
        d.puffClock -= dt
        if (d.puffClock <= 0) {
          d.puffClock = PUFF_EVERY_S
          flightPuff(Vector3.create(px, py, pz), 0.28)
        }
        if (u >= 1) {
          d.state = 'settle'
          d.t = 0
          transform.rotation = Quaternion.create(d.baseRotation.x, d.baseRotation.y, d.baseRotation.z, d.baseRotation.w)
          dummyBurst(d.home, 0, 0, 1.2, 6) // a little puff as it lands
        }
      } else {
        // landed: a damped hover-bounce around the home spot
        const s = Math.min(1, d.t / SETTLE_TIME)
        const bounce = Math.exp(-4.5 * d.t) * Math.sin(d.t * 16) * 0.7
        transform.position = Vector3.create(d.home.x, d.home.y + bounce, d.home.z)
        if (s >= 1) {
          transform.position = Vector3.create(d.home.x, d.home.y, d.home.z)
          d.state = 'idle'
        }
      }
    }

    for (const d of dummies.values()) {
      if (d.tx === 0 && d.tz === 0 && d.vx === 0 && d.vz === 0) continue
      // damped spring, substepped so a long frame can't blow it up
      const steps = Math.max(1, Math.ceil(dt / 0.008))
      const h = dt / steps
      for (let i = 0; i < steps; i++) {
        d.vx += (-STIFFNESS * d.tx - DAMPING * d.vx) * h
        d.vz += (-STIFFNESS * d.tz - DAMPING * d.vz) * h
        d.tx += d.vx * h
        d.tz += d.vz * h
      }
      const mag = Math.hypot(d.tx, d.tz)
      if (mag > MAX_TILT) {
        d.tx *= MAX_TILT / mag
        d.tz *= MAX_TILT / mag
      }
      const settled = mag < 0.05 && Math.hypot(d.vx, d.vz) < 0.5
      if (settled) {
        d.tx = d.tz = d.vx = d.vz = 0
      }
      const transform = Transform.getMutable(d.entity)
      if (mag < 0.001) {
        transform.rotation = d.baseRotation
        continue
      }
      // lean toward (tx, tz) by `mag` degrees, around the pole's base (the model origin)
      const a = (Math.min(mag, MAX_TILT) * Math.PI) / 180
      const lean = Vector3.create((d.tx / mag) * Math.sin(a), Math.cos(a), (d.tz / mag) * Math.sin(a))
      const tilt = Quaternion.fromToRotation(Vector3.Up(), lean)
      transform.rotation = Quaternion.multiply(tilt, d.baseRotation)
    }
  })
}
