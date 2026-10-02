import { engine, Billboard, BillboardMode, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { JOIN_PAD_RADIUS, LOBBY_CENTER, Phase } from '../shared/config'
import { GameState } from '../shared/schemas'

export const JOIN_SIGN_IMAGE = 'assets/images/JoinGame.png'
export const IN_PROGRESS_SIGN_IMAGE = 'assets/images/GameINProgress.png'

const PAD_MODEL_NAME = 'StartGame.glb'
const SIGN_SIZE = 3 // meters (the images are square)
const SIGN_HEIGHT = 2.7 // meters above the pad's center to the middle of the sign
const BOB_METERS = 0.2
const BOB_PERIOD_S = 3
const SWAY_SCALE = 0.04 // subtle breathing
const POP_SPEED = 4 // how quickly a sign fades / grows in and out
const PAD_LEAVE_MARGIN = 1 // extra meters before the player counts as having left the pad (no flicker on the rim)

/**
 * A big billboard over the middle of the start pad (always facing the players): "Join game" while a game can be
 * joined, "Game in progress" from the moment the round starts until it is over. Clients only, from the synced GameState.
 */
export function setupStartSign() {
  const makeSign = (src: string) => {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(LOBBY_CENTER.x, LOBBY_CENTER.y + SIGN_HEIGHT, LOBBY_CENTER.z), scale: Vector3.Zero() })
    MeshRenderer.setPlane(e)
    // Alpha-blended and self-lit, so the sign reads clearly day or night
    Material.setPbrMaterial(e, {
      texture: Material.Texture.Common({ src }),
      emissiveTexture: Material.Texture.Common({ src }),
      emissiveColor: Color3.White(),
      emissiveIntensity: 1,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      roughness: 1,
      metallic: 0,
      specularIntensity: 0
    })
    Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
    return { entity: e as Entity, shown: 0 }
  }
  const join = makeSign(JOIN_SIGN_IMAGE)
  const progress = makeSign(IN_PROGRESS_SIGN_IMAGE)

  let centre = LOBBY_CENTER
  let padFound = false
  let time = 0
  let onPad = false

  engine.addSystem((dt: number) => {
    time += dt
    // Follow the pad model as placed in the editor (falls back to the config position until it exists)
    if (!padFound) {
      const pad = engine.getEntityOrNullByName(PAD_MODEL_NAME)
      const t = pad !== null ? Transform.getOrNull(pad) : null
      if (t) {
        centre = Vector3.create(t.position.x, t.position.y, t.position.z)
        padFound = true
      }
    }

    // Is the local player standing on the pad? (with a little hysteresis so the sign doesn't flicker on the rim)
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (me) {
      const d = Math.hypot(me.position.x - centre.x, me.position.z - centre.z)
      const nearHeight = Math.abs(me.position.y - centre.y) < 6
      onPad = nearHeight && d <= JOIN_PAD_RADIUS + (onPad ? PAD_LEAVE_MARGIN : 0)
    }

    let phase: string = Phase.Lobby
    for (const [, s] of engine.getEntitiesWith(GameState)) phase = s.phase
    const inProgress = phase === Phase.Starting || phase === Phase.Round || phase === Phase.Winner

    const bob = Math.sin((time / BOB_PERIOD_S) * Math.PI * 2) * BOB_METERS
    const breathe = 1 + Math.sin((time / (BOB_PERIOD_S * 1.3)) * Math.PI * 2) * SWAY_SCALE

    for (const [sign, visible] of [
      [join, !inProgress && !onPad],
      [progress, inProgress]
    ] as const) {
      sign.shown += ((visible ? 1 : 0) - sign.shown) * Math.min(1, POP_SPEED * dt)
      const t = Transform.getMutable(sign.entity)
      t.position = Vector3.create(centre.x, centre.y + SIGN_HEIGHT + bob, centre.z)
      // Fades with it, and grows a touch as it appears
      const s = sign.shown < 0.01 ? 0 : SIGN_SIZE * (0.9 + 0.1 * sign.shown) * breathe
      t.scale = Vector3.create(s, s, s)
      const m = Material.getMutable(sign.entity)
      if (m.material?.$case === 'pbr') {
        m.material.pbr.albedoColor = Color4.create(1, 1, 1, sign.shown)
        m.material.pbr.emissiveIntensity = sign.shown
      }
    }
  })
}
