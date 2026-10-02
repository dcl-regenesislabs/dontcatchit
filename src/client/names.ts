import { getPlayer } from '@dcl/sdk/src/players'

/** A readable name for a player id: their name if loaded, otherwise a shortened address. */
export function displayName(userId: string): string {
  const name = getPlayer({ userId })?.name
  return name && name.length > 0 ? name : `${userId.slice(0, 6)}...${userId.slice(-4)}`
}
