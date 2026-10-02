import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { SPINNING_MODELS } from '../shared/config'

interface Mover {
  name: string
  degPerSecond: number
  bobMeters: number
  bobPeriodSeconds: number
  phase: number // so layers don't all bob in step
  entity?: Entity
  baseRotation: Quaternion // the rotation and position set in the editor; the motion is added on top
  basePosition: Vector3
  angle: number
}

/**
 * Slowly moves models placed in the editor (sky dome, cloud layers...): a turn around their vertical axis,
 * and optionally a slow bob up and down. Entities are found by the name they have in the editor, retrying
 * until the scene has created them. Clients only: the server never touches them, so there is no network traffic.
 */
export function setupSpinningModels() {
  const movers: Mover[] = SPINNING_MODELS.map((m, i) => ({
    name: m.name,
    degPerSecond: m.degPerSecond,
    bobMeters: m.bobMeters ?? 0,
    bobPeriodSeconds: m.bobPeriodSeconds ?? 60,
    phase: i * 1.7,
    baseRotation: Quaternion.Identity(),
    basePosition: Vector3.Zero(),
    angle: 0
  }))

  let time = 0
  engine.addSystem((dt: number) => {
    time += dt
    for (const m of movers) {
      if (m.entity === undefined) {
        m.entity = engine.getEntityOrNullByName(m.name) ?? undefined
        if (m.entity === undefined) continue
        const t = Transform.getOrNull(m.entity)
        if (t) {
          m.baseRotation = Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w)
          m.basePosition = Vector3.create(t.position.x, t.position.y, t.position.z)
        }
      }
      m.angle = (m.angle + m.degPerSecond * dt) % 360
      const tr = Transform.getMutable(m.entity)
      tr.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, m.angle, 0), m.baseRotation)
      if (m.bobMeters > 0) {
        const bob = Math.sin((time / m.bobPeriodSeconds) * Math.PI * 2 + m.phase) * m.bobMeters
        tr.position = Vector3.create(m.basePosition.x, m.basePosition.y + bob, m.basePosition.z)
      }
    }
  })
}
