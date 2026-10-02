import { engine } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/src/players'
import { Phase, PlayerStatus } from '../shared/config'
import { GameState, PlayerState } from '../shared/schemas'
import { CLOCK_TICK_SFX, playSfx, START_GO_SFX } from './sfx'

export const START_IMAGE = 'assets/images/Start.png'
export const START_SHOW_MS = 950 // short: it must never hide the pumpkin or the player it targets

let startedAt = -Infinity

/** Milliseconds since the round started on this client (the "Start" image is drawn while this is small). */
export const sinceRoundStart = () => Date.now() - startedAt

/**
 * Round start cues, clients only, from the synced GameState:
 *  - a clock tick every second of the countdown (on the pad) and of the 3-2-1 (in the arena), for players in the game
 *  - the "go" sound and the Start image the moment the 3-2-1 ends and the pumpkin is released
 */
export function setupRoundStart() {
  let lastPhase = ''
  let lastSecond = -1

  const myStatus = () => {
    const me = getPlayer()?.userId?.toLowerCase()
    if (!me) return PlayerStatus.Idle
    for (const [, p] of engine.getEntitiesWith(PlayerState)) if (p.playerId === me) return p.status
    return PlayerStatus.Idle
  }

  engine.addSystem(() => {
    let phase = ''
    let secondsLeft = 0
    for (const [, s] of engine.getEntitiesWith(GameState)) {
      phase = s.phase
      secondsLeft = s.secondsLeft
    }
    const status = myStatus()
    const inGame = status === PlayerStatus.Queued || status === PlayerStatus.Alive

    if ((phase === Phase.Countdown || phase === Phase.Starting) && secondsLeft >= 1) {
      if ((phase !== lastPhase || secondsLeft !== lastSecond) && inGame) playSfx(CLOCK_TICK_SFX, 0.8)
      lastSecond = secondsLeft
    } else {
      lastSecond = -1
    }

    if (phase === Phase.Round && lastPhase === Phase.Starting) {
      startedAt = Date.now()
      if (status === PlayerStatus.Alive) playSfx(START_GO_SFX, 0.8)
    }
    lastPhase = phase
  })
}
