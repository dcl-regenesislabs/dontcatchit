import { Animator, engine, Entity, GltfContainer, LightSource, SkyboxTime, Transform } from '@dcl/sdk/ecs'
import { Color3, Vector3 } from '@dcl/sdk/math'
import { ARENA_CENTER, LIGHTS, SKYBOX_FIXED_TIME } from '../shared/config'

/**
 * Real (dynamic) lights, not just glowing materials: purple on the pillar flames, green over the lava,
 * blue-white from the moon. Also starts the pillars' flame animation and sets the scene to night. No shadows (point lights can't cast them, and only a few shadows render at once).
 * Clients only, and the renderer decides how many lights it actually draws.
 */

function addLight(parent: Entity | undefined, position: Vector3, color: { r: number; g: number; b: number }, intensity: number, range: number) {
  const e = engine.addEntity()
  Transform.create(e, { position, ...(parent !== undefined ? { parent } : {}) })
  LightSource.create(e, {
    type: LightSource.Type.Point({}),
    color: Color3.create(color.r, color.g, color.b),
    intensity,
    range,
    shadow: false
  })
}

export function setupLights() {
  // Night time, so the coloured lights actually show (see SKYBOX_FIXED_TIME in config.ts)
  if (SKYBOX_FIXED_TIME >= 0) SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: SKYBOX_FIXED_TIME })

  // Lava: a ring of green lights just above the surface, around the arena.
  const lava = LIGHTS.lava
  for (let i = 0; i < (lava.enabled ? lava.count : 0); i++) {
    const angle = (i / lava.count) * Math.PI * 2
    addLight(
      undefined,
      Vector3.create(ARENA_CENTER.x + Math.cos(angle) * lava.radius, lava.height, ARENA_CENTER.z + Math.sin(angle) * lava.radius),
      lava.color,
      lava.intensity,
      lava.range
    )
  }

  // Pillars and moon: attach to every matching model in the scene, now and any added later. They are
  // parented, so each light follows its model (including the model's scale) with no position maths here.
  const done = new Set<Entity>()
  let timer = 1
  engine.addSystem((dt: number) => {
    timer += dt
    if (timer < 1) return
    timer = 0
    for (const [entity, gltf] of engine.getEntitiesWith(GltfContainer)) {
      if (done.has(entity)) continue
      if (gltf.src.endsWith('Pillar01.glb')) {
        const p = LIGHTS.pillar
        // The renderer only draws the nearest few lights, so only some pillars get a real one (see config.ts).
        const scale = Transform.getOrNull(entity)?.scale.x ?? 1
        if (scale >= p.onlyBelowScale) {
          Animator.createOrReplace(entity, { states: [{ clip: 'FlameIdle', playing: true, loop: true }] })
          done.add(entity)
          continue
        }
        addLight(entity, Vector3.create(0, p.flameLocalY, 0), p.color, p.intensity, p.range)
        // The flame animation is inside the model (clip 'FlameIdle') but only plays once an Animator asks for it.
        Animator.createOrReplace(entity, { states: [{ clip: 'FlameIdle', playing: true, loop: true }] })
        done.add(entity)
      } else if (gltf.src.endsWith('Pillar02.glb')) {
        // Same model family as Pillar01 (same 'FlameIdle' clip). Animation only: no real light, the light budget is spent.
        Animator.createOrReplace(entity, { states: [{ clip: 'FlameIdle', playing: true, loop: true }] })
        done.add(entity)
      } else if (gltf.src.endsWith('Moon.glb') && LIGHTS.moon.enabled) {
        const m = LIGHTS.moon
        addLight(entity, Vector3.Zero(), m.color, m.intensity, m.range)
        done.add(entity)
      }
    }
  })
}
