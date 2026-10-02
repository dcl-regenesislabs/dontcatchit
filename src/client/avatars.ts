import { engine, Entity, PlayerIdentityData } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/src/players'

/**
 * The avatar entity of a player, by lowercase address (what the server sends). The SDK's getPlayer compares
 * addresses case-sensitively, so a lowercase address can miss a mixed-case one: look through PlayerIdentityData with a
 * lowercase compare too.
 */
export function findAvatar(userId: string, me?: string): Entity | undefined {
  if (userId === (me ?? getPlayer()?.userId?.toLowerCase())) return engine.PlayerEntity
  const viaPlayers = getPlayer({ userId })?.entity
  if (viaPlayers !== undefined) return viaPlayers
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address.toLowerCase() === userId) return entity
  }
  return undefined
}
