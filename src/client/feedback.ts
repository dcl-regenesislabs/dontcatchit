export const NOTICE_SHOW_MS = 800
const SHOW_MS = NOTICE_SHOW_MS

let text: string | undefined
let until = 0
let shownAt = 0
let hitAt = 0
let eliminatedDetail = ''
let eliminatedAt = -Infinity
export const ELIMINATED_SHOW_MS = 5000

/** Short-lived HUD message plus the timestamp of the last landed parry (for the pumpkin flash). */
export const parryFeedback = {
  notice(message: string) {
    text = message
    shownAt = Date.now()
    until = shownAt + SHOW_MS
  },
  /** The full-screen "YOU'RE DEAD" sequence. `detail` is the reason shown under the skull. */
  eliminate(detail: string) {
    eliminatedDetail = detail
    eliminatedAt = Date.now()
  },
  /** Present while the sequence is playing; `age` is how many ms it has been running. */
  eliminatedNotice(): { detail: string; age: number } | undefined {
    const age = Date.now() - eliminatedAt
    return age >= 0 && age < ELIMINATED_SHOW_MS ? { detail: eliminatedDetail, age } : undefined
  },
  recordHit() {
    hitAt = Date.now()
  },
  current(): string | undefined {
    return Date.now() < until ? text : undefined
  },
  /** ms since the current notice appeared. */
  age(): number {
    return Date.now() - shownAt
  },
  sinceHit(): number {
    return Date.now() - hitAt
  }
}
