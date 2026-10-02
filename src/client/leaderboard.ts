import { engine, Entity, GltfContainer, Material, MeshRenderer, TextAlignMode, TextShape, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { LEADERBOARD } from '../shared/config'
import { Leaderboard } from '../shared/schemas'
import { displayName } from './names'

/**
 * Shows the top players by match wins on Leaderboard.glb as a table: RANK, face, NAME, WINS.
 * The table is fixed onto both faces of the board (so it looks right from any angle, not only head-on): one set
 * reads correctly from the front (+Z side, toward the balcony), another from the back. Column positions in config.ts
 * are written as seen by the viewer; this file mirrors them on the face where local +X appears on the viewer's left.
 */

const ORANGE = Color4.create(1, 0.55, 0.1, 1)
const L = LEADERBOARD

/** A text element placed at viewer-space column `u` on the given board face. */
function makeText(board: Entity, face: 1 | -1, u: number, y: number, fontSize: number, color: Color4, align: TextAlignMode): Entity {
  const e = engine.addEntity()
  // On the +Z face (the one that looks toward the balcony) local +X shows on the viewer's left, so mirror the column.
  const x = face === 1 ? -u : u
  // Text entities read correctly when seen from their -Z side, so the front (+Z) set is turned around to face out.
  Transform.create(e, {
    parent: board,
    position: Vector3.create(x, y, face * L.frontOffset),
    rotation: Quaternion.fromEulerDegrees(0, face === 1 ? L.frontTextYaw : 0, 0)
  })
  TextShape.create(e, { text: '', fontSize, textColor: color, textAlign: align })
  return e
}

interface Row {
  rank: Entity
  face: Entity
  name: Entity
  wins: Entity
  userId: string
  index: number // which standing (0 = first place) this row shows
}

function buildBoard(board: Entity): Row[] {
  const rows: Row[] = []
  for (const side of [1, -1] as const) {
    // Header line
    const header = (text: string, u: number, align: TextAlignMode) => {
      TextShape.getMutable(makeText(board, side, u, L.headerY, L.headerFontSize, ORANGE, align)).text = text
    }
    header('RANK', L.rankU, TextAlignMode.TAM_MIDDLE_LEFT)
    header('NAME', L.nameU, TextAlignMode.TAM_MIDDLE_LEFT)
    header('WINS', L.winsU, TextAlignMode.TAM_MIDDLE_RIGHT)

    for (let i = 0; i < L.rows; i++) {
      const y = L.firstRowY - i * L.rowHeight
      const face = engine.addEntity()
      // A flat plane, turned like the text (it is single-sided and upright when seen from the same side the text reads
      // from). A box looked right but its side faces map the texture upside down.
      Transform.create(face, {
        parent: board,
        position: Vector3.create(side === 1 ? -L.faceU : L.faceU, y, side * L.frontOffset),
        rotation: Quaternion.fromEulerDegrees(0, side === 1 ? L.frontTextYaw : 0, 0),
        scale: Vector3.Zero()
      })
      MeshRenderer.setPlane(face)

      rows.push({
        rank: makeText(board, side, L.rankU, y, L.rowFontSize, ORANGE, TextAlignMode.TAM_MIDDLE_LEFT),
        face,
        name: makeText(board, side, L.nameU, y, L.rowFontSize, Color4.White(), TextAlignMode.TAM_MIDDLE_LEFT),
        wins: makeText(board, side, L.winsU, y, L.rowFontSize, ORANGE, TextAlignMode.TAM_MIDDLE_RIGHT),
        userId: '',
        index: i
      })
    }
  }
  return rows
}

const shorten = (name: string) => (name.length > L.maxNameLength ? name.slice(0, L.maxNameLength - 1) + '…' : name)

export function setupLeaderboardBoard() {
  let board: Entity | undefined
  let rows: Row[] = []
  let signature = ''

  engine.addSystem(() => {
    if (board === undefined) {
      for (const [entity, gltf] of engine.getEntitiesWith(GltfContainer)) {
        if (gltf.src.endsWith('Leaderboard.glb')) board = entity
      }
      if (board === undefined) return
      rows = buildBoard(board)
    }

    let entries: readonly { readonly playerId: string; readonly name: string; readonly wins: number }[] = []
    for (const [, data] of engine.getEntitiesWith(Leaderboard)) entries = data.entries
    const next = entries.map((e) => `${e.playerId}:${e.name}:${e.wins}`).join('|')
    if (next === signature) return // only touch the rows when the standings actually change
    signature = next

    for (const row of rows) {
      const entry = entries[row.index]
      if (!entry) {
        // Empty slot. The first one says why it's empty until someone has won.
        Transform.getMutable(row.face).scale = Vector3.Zero()
        TextShape.getMutable(row.rank).text = ''
        TextShape.getMutable(row.wins).text = ''
        TextShape.getMutable(row.name).text = entries.length === 0 && row.index === 0 ? 'No winners yet' : ''
        continue
      }
      if (row.userId !== entry.playerId) {
        row.userId = entry.playerId
        Material.setBasicMaterial(row.face, { texture: Material.Texture.Avatar({ userId: entry.playerId }) })
      }
      Transform.getMutable(row.face).scale = Vector3.create(L.faceSize, L.faceSize, 1)
      TextShape.getMutable(row.rank).text = `#${row.index + 1}`
      TextShape.getMutable(row.name).text = shorten(entry.name || displayName(entry.playerId))
      TextShape.getMutable(row.wins).text = `${entry.wins}`
    }
  })
}
