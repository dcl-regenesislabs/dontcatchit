import { isServer } from '@dcl/sdk/network'
// Components and messages must register at module load (before the engine seals).
import './shared/schemas'
import './shared/messages'

export async function main() {
  if (isServer()) {
    const { initServer } = await import('./server/server')
    initServer()
    return
  }

  const { initClient } = await import('./client/setup')
  const { setupUi } = await import('./client/ui')
  initClient()
  setupUi()
}
