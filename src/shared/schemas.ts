import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// Singleton: coarse match state. Changes at most ~once per second.
export const GameState = engine.defineComponent('dci:GameState', {
  phase: Schemas.String,
  secondsLeft: Schemas.Int,
  round: Schemas.Int,
  queued: Schemas.Int,
  alive: Schemas.Int,
  winnerId: Schemas.String,
  // Where the winner stood when the round ended (the winner camera falls back to it if their avatar can't be found)
  winnerX: Schemas.Float,
  winnerY: Schemas.Float,
  winnerZ: Schemas.Float
})

// One per player present in the scene. Match lookups on playerId, never on network id.
export const PlayerState = engine.defineComponent('dci:PlayerState', {
  playerId: Schemas.String,
  status: Schemas.String,
  hp: Schemas.Int
})

// Singleton: the current pumpkin flight. Written once per flight (launch / parry / respawn), never streamed.
// Server and clients run the same movement rule (shared/pumpkinSim.ts) from this start state.
export const Pumpkin = engine.defineComponent('dci:Pumpkin', {
  active: Schemas.Boolean,
  seq: Schemas.Int,
  ox: Schemas.Float,
  oy: Schemas.Float,
  oz: Schemas.Float,
  targetId: Schemas.String,
  nextTargetId: Schemas.String, // who gets the ball after a parry/hit on targetId; lets clients continue instantly
  delayMs: Schemas.Int, // hover time before the flight starts
  level: Schemas.Int // parries so far this chain; with time in flight it sets the speed
})

// Singleton: the top players by match wins, best first. Written by the server only when a round ends.
export const Leaderboard = engine.defineComponent('dci:Leaderboard', {
  entries: Schemas.Array(
    Schemas.Map({
      playerId: Schemas.String,
      name: Schemas.String,
      wins: Schemas.Int
    })
  )
})

// Kept separate from GameState so the pulse doesn't resend match data.
export const ServerHeartbeat = engine.defineComponent('dci:ServerHeartbeat', {
  at: Schemas.Int64
})

if (isServer()) {
  const serverOnly = (v: { senderAddress: string }) => v.senderAddress === AUTH_SERVER_PEER_ID
  GameState.validateBeforeChange(serverOnly)
  PlayerState.validateBeforeChange(serverOnly)
  ServerHeartbeat.validateBeforeChange(serverOnly)
  Pumpkin.validateBeforeChange(serverOnly)
  Leaderboard.validateBeforeChange(serverOnly)
}
