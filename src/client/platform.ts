import { getExplorerInformation } from '~system/Runtime'

const MOBILE_AGENT_RE = /mobile|android|iphone|ipad|ios/

let mobile = false
let bevy = false
let started = false

/** Resolves the platform once. Stays "desktop" if the lookup fails rather than guessing wrong. */
export function resolvePlatform() {
  if (started) return
  started = true
  void getExplorerInformation({})
    .then((info) => {
      const platform = (info.platform ?? '').toLowerCase()
      const agent = (info.agent ?? '').toLowerCase()
      mobile = platform === 'mobile' || MOBILE_AGENT_RE.test(agent)
      bevy = agent.includes('bevy')
      console.log('[CLIENT] platform', platform || '?', 'agent', agent || '?', 'mobile', mobile)
    })
    .catch(() => {})
}

export function isMobile() {
  return mobile
}

/** True on the Bevy explorer (the desktop Unity explorer is everything else). */
export function isBevy() {
  return bevy
}
