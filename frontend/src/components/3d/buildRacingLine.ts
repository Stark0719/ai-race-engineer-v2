export type XY = [number, number]

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const wrap01 = (v: number) => ((v % 1) + 1) % 1
export const wrapPi = (a: number) => {
  let x = a
  while (x > Math.PI) x -= 2 * Math.PI
  while (x < -Math.PI) x += 2 * Math.PI
  return x
}

export const AERO_PARAMS = {
  airDensity: 1.225,
  cdA: 1.55,
  clA: 3.8,
  massKg: 798,
  downforceGripFactor: 0.16,
}

export function buildRacingLine(
  pts: XY[],
  trackWidth = 12,
  corners?: { index: number; min_speed: number }[],
  lineMode: 'conservative' | 'balanced' | 'late_apex' | 'early_apex' | 'aggressive' = 'balanced',
) {
  if (!pts || pts.length < 4) return pts || []
  const n = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
    ? pts.length - 1
    : pts.length
  const base = pts.slice(0, n)
  const normals: XY[] = new Array(n).fill([0, 0] as XY)
  const turnSign: number[] = new Array(n).fill(0)
  const offsets = new Array(n).fill(0)

  for (let i = 0; i < n; i++) {
    const p0 = base[(i - 1 + n) % n]
    const p1 = base[i]
    const p2 = base[(i + 1) % n]
    const t1x = p1[0] - p0[0]
    const t1y = p1[1] - p0[1]
    const t2x = p2[0] - p1[0]
    const t2y = p2[1] - p1[1]
    const tx = t1x + t2x
    const ty = t1y + t2y
    const tl = Math.hypot(tx, ty) || 1
    normals[i] = [-ty / tl, tx / tl]
    const cross = t1x * t2y - t1y * t2x
    turnSign[i] = cross === 0 ? 0 : (cross > 0 ? 1 : -1)
  }

  const modeScale = {
    conservative: 0.65,
    balanced: 0.85,
    late_apex: 0.95,
    early_apex: 0.9,
    aggressive: 1.1,
  } as const
  const maxOffset = trackWidth * 0.35 * modeScale[lineMode]
  if (corners && corners.length) {
    for (const c of corners) {
      const idx = ((Math.floor(c.index) % n) + n) % n
      const sign = turnSign[idx] || 1
      const severity = clamp((260 - (c.min_speed || 180)) / 180, 0, 1)
      const amp = maxOffset * (0.2 + 0.8 * severity)
      const spreadAdj = lineMode === 'late_apex' ? 1.15 : lineMode === 'early_apex' ? 0.9 : 1.0
      const spread = Math.floor(clamp((8 + severity * 16) * spreadAdj, 8, 32))
      const sigma = spread * 0.5
      for (let k = -spread; k <= spread; k++) {
        const j = (idx + k + n) % n
        const w = Math.exp(-(k * k) / (2 * sigma * sigma))
        offsets[j] += -sign * amp * w
      }
    }
  } else {
    for (let i = 0; i < n; i++) offsets[i] = -turnSign[i] * maxOffset * 0.2
  }

  const smooth = (arr: number[], r: number) => {
    const out = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      let s = 0
      let w = 0
      for (let k = -r; k <= r; k++) {
        const j = (i + k + n) % n
        const wk = r + 1 - Math.abs(k)
        s += arr[j] * wk
        w += wk
      }
      out[i] = s / w
    }
    return out
  }
  let sm = offsets
  sm = smooth(sm, 5)
  sm = smooth(sm, 5)

  const racing: XY[] = []
  for (let i = 0; i < n; i++) {
    const off = clamp(sm[i], -maxOffset, maxOffset)
    const nx = normals[i][0]
    const ny = normals[i][1]
    racing.push([base[i][0] + nx * off, base[i][1] + ny * off])
  }
  racing.push([racing[0][0], racing[0][1]])
  return racing
}
