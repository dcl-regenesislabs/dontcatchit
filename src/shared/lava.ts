import { LAVA_TRIANGLES } from './lavaShape'

// Precompute each triangle's area so random points are spread evenly over the real lava surface.
const areas = LAVA_TRIANGLES.map(([ax, az, bx, bz, cx, cz]) => Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2)
const totalArea = areas.reduce((sum, a) => sum + a, 0)

/** True if the point (world X/Z) is over the lava surface. */
export function isOnLava(x: number, z: number): boolean {
  for (const [ax, az, bx, bz, cx, cz] of LAVA_TRIANGLES) {
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (d === 0) continue
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
    if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) return true
  }
  return false
}

/** A uniformly random point on the lava surface (world X/Z). */
export function randomLavaPoint(): { x: number; z: number } {
  let pick = Math.random() * totalArea
  let i = 0
  while (i < areas.length - 1 && pick > areas[i]) {
    pick -= areas[i]
    i++
  }
  const [ax, az, bx, bz, cx, cz] = LAVA_TRIANGLES[i]
  let u = Math.random()
  let v = Math.random()
  if (u + v > 1) {
    u = 1 - u
    v = 1 - v
  }
  return { x: ax + u * (bx - ax) + v * (cx - ax), z: az + u * (bz - az) + v * (cz - az) }
}
