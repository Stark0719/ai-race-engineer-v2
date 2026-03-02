import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky, Environment, ContactShadows, SoftShadows } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useRaceStore } from '../stores/raceStore'
import { DRS_ZONE_DATA } from '../data/drsZones'

type XY = [number, number]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const wrap01 = (v: number) => ((v % 1) + 1) % 1
const wrapPi = (a: number) => {
  let x = a
  while (x > Math.PI) x -= 2 * Math.PI
  while (x < -Math.PI) x += 2 * Math.PI
  return x
}

// Placeholder aero coefficients for F1-style behavior.
const AERO_PARAMS = {
  airDensity: 1.225,
  cdA: 1.55,
  clA: 3.8,
  massKg: 798,
  downforceGripFactor: 0.16,
}

function buildRacingLine(
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

function useAsphaltTexture() {
  return useMemo(() => {
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#3a3a3a'
    ctx.fillRect(0, 0, size, size)
    const imageData = ctx.getImageData(0, 0, size, size)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const noise = (Math.random() - 0.5) * 30
      d[i] = Math.max(0, Math.min(255, d[i] + noise))
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + noise))
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + noise))
    }
    ctx.putImageData(imageData, 0, 0)
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(200, 200)
    return tex
  }, [])
}

function TrackSurface() {
  const { currentTrack } = useRaceStore()
  const asphaltMap = useAsphaltTexture()

  const geometry = useMemo(() => {
    if (!currentTrack || !currentTrack.waypoints_xy || currentTrack.waypoints_xy.length < 3) return null

    const pts = currentTrack.waypoints_xy
    const W = currentTrack.track_width || 12
    const verts: number[] = []

    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[i + 1]
      const dx = bx - ax, dy = by - ay
      const ln = Math.sqrt(dx * dx + dy * dy)
      if (ln < 0.01) continue
      const nx = -dy / ln, ny = dx / ln

      verts.push(
        ax + nx * W, 0, -(ay + ny * W),
        ax - nx * W, 0, -(ay - ny * W),
        bx + nx * W, 0, -(by + ny * W),
        bx - nx * W, 0, -(by - ny * W),
        bx + nx * W, 0, -(by + ny * W),
        ax - nx * W, 0, -(ay - ny * W),
      )
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.computeVertexNormals()
    return geo
  }, [currentTrack])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial map={asphaltMap} roughness={0.85} metalness={0} />
    </mesh>
  )
}

function TrackKerbs() {
  const { currentTrack } = useRaceStore()

  const geometries = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3) return []
    const pts = currentTrack.waypoints_xy
    const W = currentTrack.track_width || 12
    const stripeLen = 3
    const result: THREE.BufferGeometry[] = []

    for (const side of [1, -1]) {
      const verts: number[] = []
      const colors: number[] = []
      let cumLen = 0

      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[i + 1]
        const dx = bx - ax, dy = by - ay
        const segLen = Math.sqrt(dx * dx + dy * dy)
        if (segLen < 0.01) continue
        const nx = (-dy / segLen) * side, ny = (dx / segLen) * side
        verts.push(
          ax + nx * W, 0.06, -(ay + ny * W),
          ax + nx * (W + 2), 0.06, -(ay + ny * (W + 2)),
          bx + nx * W, 0.06, -(by + ny * W),
          bx + nx * (W + 2), 0.06, -(by + ny * (W + 2)),
          bx + nx * W, 0.06, -(by + ny * W),
          ax + nx * (W + 2), 0.06, -(ay + ny * (W + 2)),
        )
        const isRed = Math.floor(cumLen / stripeLen) % 2 === 0
        const r = isRed ? 0.8 : 1.0
        const g = isRed ? 0.0 : 1.0
        const b = isRed ? 0.0 : 1.0
        for (let v = 0; v < 6; v++) colors.push(r, g, b)
        cumLen += segLen
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      geo.computeVertexNormals()
      result.push(geo)
    }
    return result
  }, [currentTrack])

  return (
    <>
      {geometries.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial vertexColors roughness={0.6} metalness={0} />
        </mesh>
      ))}
    </>
  )
}

function WhiteLines() {
  const { currentTrack } = useRaceStore()

  const geometries = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3) return []
    const pts = currentTrack.waypoints_xy
    const W = currentTrack.track_width || 12
    const lineW = 0.3
    const result: THREE.BufferGeometry[] = []

    for (const side of [1, -1]) {
      const verts: number[] = []
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[i + 1]
        const dx = bx - ax, dy = by - ay
        const ln = Math.sqrt(dx * dx + dy * dy)
        if (ln < 0.01) continue
        const nx = (-dy / ln) * side, ny = (dx / ln) * side
        const inner = W
        const outer = W + lineW
        verts.push(
          ax + nx * inner, 0.03, -(ay + ny * inner),
          ax + nx * outer, 0.03, -(ay + ny * outer),
          bx + nx * inner, 0.03, -(by + ny * inner),
          bx + nx * outer, 0.03, -(by + ny * outer),
          bx + nx * inner, 0.03, -(by + ny * inner),
          ax + nx * outer, 0.03, -(ay + ny * outer),
        )
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      geo.computeVertexNormals()
      result.push(geo)
    }
    return result
  }, [currentTrack])

  if (geometries.length === 0) return null

  return (
    <>
      {geometries.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial color="#ffffff" roughness={0.5} metalness={0} />
        </mesh>
      ))}
    </>
  )
}

function RunoffAreas() {
  const { currentTrack } = useRaceStore()

  const { gravelGeos, grassGeos } = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3)
      return { gravelGeos: [], grassGeos: [] }
    const pts = currentTrack.waypoints_xy
    const W = currentTrack.track_width || 12
    const kerbW = 2
    const gravelW = 6
    const grassW = 10

    const buildStrip = (innerOff: number, outerOff: number, y: number) => {
      const result: THREE.BufferGeometry[] = []
      for (const side of [1, -1]) {
        const verts: number[] = []
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i]
          const [bx, by] = pts[i + 1]
          const dx = bx - ax, dy = by - ay
          const ln = Math.sqrt(dx * dx + dy * dy)
          if (ln < 0.01) continue
          const nx = (-dy / ln) * side, ny = (dx / ln) * side
          verts.push(
            ax + nx * (W + innerOff), y, -(ay + ny * (W + innerOff)),
            ax + nx * (W + outerOff), y, -(ay + ny * (W + outerOff)),
            bx + nx * (W + innerOff), y, -(by + ny * (W + innerOff)),
            bx + nx * (W + outerOff), y, -(by + ny * (W + outerOff)),
            bx + nx * (W + innerOff), y, -(by + ny * (W + innerOff)),
            ax + nx * (W + outerOff), y, -(ay + ny * (W + outerOff)),
          )
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
        geo.computeVertexNormals()
        result.push(geo)
      }
      return result
    }

    return {
      gravelGeos: buildStrip(kerbW, kerbW + gravelW, -0.05),
      grassGeos: buildStrip(kerbW + gravelW, kerbW + gravelW + grassW, -0.1),
    }
  }, [currentTrack])

  return (
    <>
      {gravelGeos.map((geo, i) => (
        <mesh key={`gravel-${i}`} geometry={geo} receiveShadow>
          <meshStandardMaterial color="#c4a862" roughness={1.0} metalness={0} />
        </mesh>
      ))}
      {grassGeos.map((geo, i) => (
        <mesh key={`grass-${i}`} geometry={geo} receiveShadow>
          <meshStandardMaterial color="#2d5a1e" roughness={0.95} metalness={0} />
        </mesh>
      ))}
    </>
  )
}

function Barriers() {
  const { currentTrack } = useRaceStore()

  const geometries = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3) return []
    const pts = currentTrack.waypoints_xy
    const W = currentTrack.track_width || 12
    const barrierOffset = W + 2 + 6 + 10
    const barrierH = 2.5
    const result: THREE.BufferGeometry[] = []

    for (const side of [1, -1]) {
      const verts: number[] = []
      for (let i = 0; i < pts.length - 3; i += 3) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[Math.min(i + 3, pts.length - 1)]
        const dx = bx - ax, dy = by - ay
        const ln = Math.sqrt(dx * dx + dy * dy)
        if (ln < 0.01) continue
        const nx = (-dy / ln) * side, ny = (dx / ln) * side
        const x0 = ax + nx * barrierOffset, z0 = -(ay + ny * barrierOffset)
        const x1 = bx + nx * barrierOffset, z1 = -(by + ny * barrierOffset)
        verts.push(
          x0, -0.1, z0,  x1, -0.1, z1,  x0, barrierH, z0,
          x1, -0.1, z1,  x1, barrierH, z1,  x0, barrierH, z0,
        )
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      geo.computeVertexNormals()
      result.push(geo)
    }
    return result
  }, [currentTrack])

  return (
    <>
      {geometries.map((geo, i) => (
        <mesh key={`barrier-${i}`} geometry={geo} castShadow receiveShadow>
          <meshStandardMaterial color="#888888" roughness={0.9} metalness={0.1} />
        </mesh>
      ))}
    </>
  )
}

function PitLane() {
  const { currentTrack } = useRaceStore()

  const geometry = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 30) return null
    const pts = currentTrack.waypoints_xy
    const W = currentTrack.track_width || 12
    const [x0, y0] = pts[0]
    const [x1, y1] = pts[Math.min(30, pts.length - 1)]
    const dx = x1 - x0, dy = y1 - y0
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1) return null
    const fx = dx / len, fy = dy / len
    const nx = -fy, ny = fx
    const pitOff = W + 5
    const pitW = 8
    const pitLen = Math.min(len * 1.5, 300)
    const verts = new Float32Array([
      x0 + nx * pitOff, 0.01, -(y0 + ny * pitOff),
      x0 + nx * (pitOff + pitW), 0.01, -(y0 + ny * (pitOff + pitW)),
      x0 + fx * pitLen + nx * pitOff, 0.01, -(y0 + fy * pitLen + ny * pitOff),
      x0 + nx * (pitOff + pitW), 0.01, -(y0 + ny * (pitOff + pitW)),
      x0 + fx * pitLen + nx * (pitOff + pitW), 0.01, -(y0 + fy * pitLen + ny * (pitOff + pitW)),
      x0 + fx * pitLen + nx * pitOff, 0.01, -(y0 + fy * pitLen + ny * pitOff),
    ])
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.computeVertexNormals()
    return geo
  }, [currentTrack])

  if (!geometry) return null
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#3d3d3d" roughness={0.8} metalness={0} />
    </mesh>
  )
}

function RubberMarks() {
  const currentTrack = useRaceStore((s) => s.currentTrack)
  const raceDecision = useRaceStore((s) => s.raceDecision)

  const geometry = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3) return null
    const mode = (raceDecision?.racing_lines_now?.recommended_line || 'balanced') as
      'conservative' | 'balanced' | 'late_apex' | 'early_apex' | 'aggressive'
    const racingPts = buildRacingLine(
      currentTrack.waypoints_xy,
      currentTrack.track_width || 12,
      currentTrack.corners,
      mode,
    )
    const rubW = 1.0
    const verts: number[] = []
    for (let i = 0; i < racingPts.length - 1; i++) {
      const [ax, ay] = racingPts[i]
      const [bx, by] = racingPts[i + 1]
      const dx = bx - ax, dy = by - ay
      const ln = Math.sqrt(dx * dx + dy * dy)
      if (ln < 0.01) continue
      const nx = -dy / ln, ny = dx / ln
      verts.push(
        ax + nx * rubW, 0.02, -(ay + ny * rubW),
        ax - nx * rubW, 0.02, -(ay - ny * rubW),
        bx + nx * rubW, 0.02, -(by + ny * rubW),
        bx - nx * rubW, 0.02, -(by - ny * rubW),
        bx + nx * rubW, 0.02, -(by + ny * rubW),
        ax - nx * rubW, 0.02, -(ay - ny * rubW),
      )
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.computeVertexNormals()
    return geo
  }, [currentTrack, raceDecision?.racing_lines_now?.recommended_line])

  if (!geometry) return null
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#1a1a1a" roughness={0.7} metalness={0} transparent opacity={0.6} />
    </mesh>
  )
}

function DRSZones() {
  const currentTrack = useRaceStore((s) => s.currentTrack)
  const selectedTrack = useRaceStore((s) => s.selectedTrack)
  const telemetry = useRaceStore((s) => s.telemetry)

  const zones = useMemo(() => {
    if (!selectedTrack) return []
    return DRS_ZONE_DATA[selectedTrack] || []
  }, [selectedTrack])

  const stripGeometries = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3 || zones.length === 0) return []
    const pts = currentTrack.waypoints_xy
    const W = currentTrack.track_width || 12
    const n = pts.length - 1
    const geos: THREE.BufferGeometry[] = []

    for (const zone of zones) {
      const startIdx = Math.floor(zone.activation * n)
      const endIdx = Math.floor(zone.end * n)
      const verts: number[] = []
      for (let i = startIdx; i < endIdx && i < pts.length - 1; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[i + 1]
        const dx = bx - ax, dy = by - ay
        const ln = Math.sqrt(dx * dx + dy * dy)
        if (ln < 0.01) continue
        const nx = -dy / ln, ny = dx / ln
        const hw = W * 0.9
        verts.push(
          ax + nx * hw, 0.04, -(ay + ny * hw),
          ax - nx * hw, 0.04, -(ay - ny * hw),
          bx + nx * hw, 0.04, -(by + ny * hw),
          bx - nx * hw, 0.04, -(by - ny * hw),
          bx + nx * hw, 0.04, -(by + ny * hw),
          ax - nx * hw, 0.04, -(ay - ny * hw),
        )
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      geo.computeVertexNormals()
      geos.push(geo)
    }
    return geos
  }, [currentTrack, zones])

  const markerData = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3 || zones.length === 0) return []
    const pts = currentTrack.waypoints_xy
    const W = currentTrack.track_width || 12
    const n = pts.length - 1
    const markers: { pos: [number, number, number]; color: string }[] = []

    for (const zone of zones) {
      for (const [frac, color] of [[zone.detection, '#ff8800'], [zone.activation, '#00cc44']] as const) {
        const idx = Math.min(Math.floor(frac * n), pts.length - 2)
        const [px, py] = pts[idx]
        const [bx, by] = pts[idx + 1]
        const dx = bx - px, dy = by - py
        const ln = Math.hypot(dx, dy) || 1
        const nx = (-dy / ln), ny = (dx / ln)
        markers.push({
          pos: [px + nx * (W + 4), 1.5, -(py + ny * (W + 4))],
          color,
        })
      }
    }
    return markers
  }, [currentTrack, zones])

  if (stripGeometries.length === 0) return null
  const drsActive = telemetry?.drs ?? false

  return (
    <>
      {stripGeometries.map((geo, i) => (
        <mesh key={`drs-strip-${i}`} geometry={geo}>
          <meshStandardMaterial
            color={drsActive ? '#00ff88' : '#00cc44'}
            transparent
            opacity={drsActive ? 0.45 : 0.25}
            roughness={0.9}
            metalness={0}
            depthWrite={false}
          />
        </mesh>
      ))}
      {markerData.map((m, i) => (
        <group key={`drs-marker-${i}`} position={m.pos}>
          <mesh>
            <boxGeometry args={[0.3, 3, 2]} />
            <meshStandardMaterial color={m.color} roughness={0.5} metalness={0.2} />
          </mesh>
          <mesh position={[0, -2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 2, 8]} />
            <meshStandardMaterial color="#666666" roughness={0.8} />
          </mesh>
        </group>
      ))}
    </>
  )
}

function CarContactShadow() {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!groupRef.current || !carState.active) return
    groupRef.current.position.set(carState.pos.x, 0.01, carState.pos.z)
  })

  return (
    <group ref={groupRef}>
      <ContactShadows
        opacity={0.6}
        scale={20}
        blur={2.5}
        far={4}
        resolution={256}
        color="#000000"
      />
    </group>
  )
}

function RacingLine() {
  const { currentTrack, raceDecision } = useRaceStore()

  const lineArray = useMemo(() => {
    if (!currentTrack || !currentTrack.waypoints_xy || currentTrack.waypoints_xy.length < 3) return null
    const mode = (raceDecision?.racing_lines_now?.recommended_line || 'balanced') as
      'conservative' | 'balanced' | 'late_apex' | 'early_apex' | 'aggressive'
    const pts = buildRacingLine(
      currentTrack.waypoints_xy,
      currentTrack.track_width || 12,
      currentTrack.corners,
      mode
    )
    const arr = new Float32Array(pts.length * 3)
    for (let i = 0; i < pts.length; i++) {
      arr[i * 3] = pts[i][0]
      arr[i * 3 + 1] = 0.15
      arr[i * 3 + 2] = -pts[i][1]
    }
    return arr
  }, [currentTrack, raceDecision?.racing_lines_now?.recommended_line])

  if (!lineArray) return null

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={lineArray.length / 3}
          array={lineArray}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#00e5ff" opacity={0.6} transparent />
    </line>
  )
}

// Shared car state for camera tracking
const carState = {
  pos: new THREE.Vector3(),
  forward: new THREE.Vector3(1, 0, 0),
  heading: 0,
  active: false,
}

function Car() {
  const rootRef = useRef<THREE.Group>(null)
  const chassisRef = useRef<THREE.Group>(null)
  const flSteerRef = useRef<THREE.Group>(null)
  const frSteerRef = useRef<THREE.Group>(null)
  const wheelMeshes = useRef<Array<THREE.Mesh | null>>([])
  const [carModel, setCarModel] = useState<THREE.Object3D | null>(null)
  const modelWheels = useRef<{ front: THREE.Object3D[]; all: THREE.Object3D[] }>({ front: [], all: [] })
  const sim = useRef({
    toFrac: 0,
    renderFrac: 0,
    fracRatePerMs: 0,
    prevTs: 0,
    prevUpdateTime: 0,
    avgIntervalMs: 50,
    init: false,
    x: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    steer: 0,
    wheelSpin: 0,
  })

  // Cache the racing line so it's not rebuilt every frame
  const currentTrack = useRaceStore((s) => s.currentTrack)
  const raceDecision = useRaceStore((s) => s.raceDecision)
  const lineMode = (raceDecision?.racing_lines_now?.recommended_line || 'balanced') as
    'conservative' | 'balanced' | 'late_apex' | 'early_apex' | 'aggressive'

  const cachedLine = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3) return null
    return buildRacingLine(
      currentTrack.waypoints_xy,
      currentTrack.track_width || 12,
      currentTrack.corners,
      lineMode
    )
  }, [currentTrack, lineMode])

  useEffect(() => {
    const modelUrl = String(import.meta.env.VITE_CAR_GLB_URL || '').trim() || '/models/f1_car.glb'
    let cancelled = false
    const loader = new GLTFLoader()
    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) return
        const scene = gltf.scene.clone(true)
        const front: THREE.Object3D[] = []
        const all: THREE.Object3D[] = []
        scene.traverse((obj) => {
          obj.castShadow = true
          obj.receiveShadow = true
          const n = obj.name.toLowerCase()
          if (n.includes('wheel') || n.includes('tyre') || n.includes('tire')) {
            all.push(obj)
            const isFront = n.includes('front') || n.includes('fl') || n.includes('fr')
            if (isFront) front.push(obj)
          }
        })
        modelWheels.current = { front, all }
        setCarModel(scene)
      },
      undefined,
      () => {
        if (!cancelled) setCarModel(null)
      }
    )
    return () => { cancelled = true }
  }, [])

  useFrame((_, delta) => {
    if (!rootRef.current || !cachedLine || cachedLine.length < 3) return
    const { telemetry, raceStatus } = useRaceStore.getState()
    const track = currentTrack

    const dt = clamp(delta, 1 / 240, 1 / 20)
    const now = performance.now()
    const s = sim.current
    const line = cachedLine
    const n = line.length - 1
    if (n < 2 || !track) return

    const sampleLine = (fraction: number) => {
      const f = wrap01(fraction)
      const idx = f * n
      const i0 = Math.floor(idx)
      const i1 = (i0 + 1) % n
      const t = idx - i0
      return {
        x: line[i0][0] + (line[i1][0] - line[i0][0]) * t,
        z: -(line[i0][1] + (line[i1][1] - line[i0][1]) * t),
      }
    }

    if (!telemetry) {
      s.init = false
      carState.active = false
      return
    }

    if (telemetry.timestamp !== s.prevTs) {
      if (!s.init) {
        s.toFrac = telemetry.lap_fraction
        s.renderFrac = telemetry.lap_fraction
        const p = sampleLine(s.toFrac)
        const p2 = sampleLine(s.toFrac + 0.003)
        s.x = p.x
        s.z = p.z
        s.yaw = Math.atan2(p2.z - p.z, p2.x - p.x)
        s.init = true
        s.prevUpdateTime = now
      } else {
        const interval = Math.max(1, now - s.prevUpdateTime)
        let dFrac = telemetry.lap_fraction - s.toFrac
        if (dFrac < -0.5) dFrac += 1
        if (dFrac > 0.5) dFrac -= 1
        s.fracRatePerMs = dFrac / interval
        s.toFrac = telemetry.lap_fraction
        s.avgIntervalMs = s.avgIntervalMs * 0.8 + interval * 0.2
        s.prevUpdateTime = now
      }
      s.prevTs = telemetry.timestamp
    }

    if (raceStatus === 'running') {
      const elapsed = Math.min(now - s.prevUpdateTime, s.avgIntervalMs * 4)
      const predictedFrac = wrap01(s.toFrac + s.fracRatePerMs * elapsed)
      let d = predictedFrac - s.renderFrac
      if (d < -0.5) d += 1
      if (d > 0.5) d -= 1
      s.renderFrac = wrap01(s.renderFrac + d * 0.35)
    } else {
      s.renderFrac = s.toFrac
    }

    const target = sampleLine(s.renderFrac)
    const pBehind = sampleLine(s.renderFrac - 0.004)
    const pAhead = sampleLine(s.renderFrac + 0.004)
    const v1x = target.x - pBehind.x
    const v1z = target.z - pBehind.z
    const v2x = pAhead.x - target.x
    const v2z = pAhead.z - target.z
    const l1 = Math.hypot(v1x, v1z)
    const l2 = Math.hypot(v2x, v2z)
    const cross = v1x * v2z - v1z * v2x
    const curvatureMag = (l1 > 0.001 && l2 > 0.001) ? Math.abs(cross) / (l1 * l2) : 0
    const curvatureNorm = clamp(curvatureMag * 4.0, 0, 1)

    const speedMul = Math.max(1, useRaceStore.getState().speedMultiplier || 1)
    // Drive render speed from lap-fraction progression so runtime speed changes are visible immediately.
    const fracVelPerSec = Math.abs(s.fracRatePerMs) * 1000
    const fracBasedSpeed = fracVelPerSec * Math.max(1, track.circuit_length_m || 1)
    const telemetrySpeed = (telemetry.speed_kph || 0) / 3.6
    const cmdSpeedRaw = clamp(
      Math.max(telemetrySpeed * speedMul, fracBasedSpeed),
      5,
      150 * speedMul
    )
    const cmdSpeed = Math.max(6, cmdSpeedRaw * (1 - 0.22 * curvatureNorm))
    s.speed += (cmdSpeed - s.speed) * clamp(dt * 4.5, 0, 1)

    // Aero placeholders: drag slows top speed, downforce boosts available grip.
    const dragForce = 0.5 * AERO_PARAMS.airDensity * AERO_PARAMS.cdA * s.speed * s.speed
    const dragDecel = dragForce / AERO_PARAMS.massKg
    s.speed = Math.max(0, s.speed - dragDecel * dt)
    const downforce = 0.5 * AERO_PARAMS.airDensity * AERO_PARAMS.clA * s.speed * s.speed
    const gripScale = 1 + (downforce / (AERO_PARAMS.massKg * 9.81)) * AERO_PARAMS.downforceGripFactor

    const wheelBase = 3.6
    const lookAheadBase = clamp(8 + s.speed * 0.34, 8, 28)
    const lookAheadM = clamp(lookAheadBase * (1 - 0.55 * curvatureNorm), 6, 28)
    const lookAheadFrac = lookAheadM / Math.max(1, track.circuit_length_m)
    const carrot = sampleLine(s.renderFrac + lookAheadFrac)

    const toCarrot = Math.atan2(carrot.z - s.z, carrot.x - s.x)
    const alpha = wrapPi(toCarrot - s.yaw)
    const steerLimit = clamp(0.55 * gripScale, 0.45, 0.75)
    const steerTarget = clamp(Math.atan2(2 * wheelBase * Math.sin(alpha), lookAheadM), -steerLimit, steerLimit)
    s.steer += (steerTarget - s.steer) * clamp(dt * 10, 0, 1)

    const yawRate = (s.speed / wheelBase) * Math.tan(s.steer)
    s.yaw += yawRate * dt
    s.x += s.speed * Math.cos(s.yaw) * dt
    s.z += s.speed * Math.sin(s.yaw) * dt

    const corr = clamp(dt * (2.8 + 4.2 * curvatureNorm), 0, 0.38)
    s.x += (target.x - s.x) * corr
    s.z += (target.z - s.z) * corr

    // Hard cross-track clamp to keep the car on track envelope.
    const ex = s.x - target.x
    const ez = s.z - target.z
    const errDist = Math.hypot(ex, ez)
    const maxCrossTrack = Math.max(1.8, (track.track_width || 12) * 0.32)
    if (errDist > maxCrossTrack) {
      const k = maxCrossTrack / errDist
      s.x = target.x + ex * k
      s.z = target.z + ez * k
      s.speed *= 0.96
    }

    rootRef.current.position.set(s.x, 0.05, s.z)
    rootRef.current.rotation.y = -s.yaw + Math.PI / 2

    const latG = clamp((yawRate * s.speed) / 9.81, -2.5, 2.5)
    if (chassisRef.current) chassisRef.current.rotation.z = clamp(latG * 0.035, -0.09, 0.09)
    if (flSteerRef.current) flSteerRef.current.rotation.y = -s.steer
    if (frSteerRef.current) frSteerRef.current.rotation.y = -s.steer

    s.wheelSpin += (s.speed / 0.33) * dt
    for (const w of wheelMeshes.current) {
      if (w) w.rotation.x = s.wheelSpin
    }
    for (const w of modelWheels.current.all) {
      w.rotation.x = s.wheelSpin
    }
    for (const fw of modelWheels.current.front) {
      fw.rotation.y = -s.steer
    }

    carState.pos.set(s.x, 0.05, s.z)
    carState.forward.set(Math.cos(s.yaw), 0, Math.sin(s.yaw))
    carState.heading = s.yaw
    carState.active = true
  })

  return (
    <group ref={rootRef} scale={[1.5, 1.5, 1.5]}>
      {carModel ? (
        <primitive
          ref={chassisRef as any}
          object={carModel}
          position={[0, 0, -1.85]}
          scale={[1.15, 1.15, 1.15]}
        />
      ) : (
        <>
          {/* All car parts inside chassis group so body roll applies uniformly */}
          <group ref={chassisRef} position={[0, 0, -1.85]}>
            {/* Body */}
            <mesh position={[0, 0.38, 0]} castShadow>
              <boxGeometry args={[1.6, 0.45, 5.5]} />
              <meshPhongMaterial color="#e10600" shininess={100} />
            </mesh>
            {/* Nose */}
            <mesh position={[0, 0.32, -3.8]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <coneGeometry args={[0.35, 2.2, 6]} />
              <meshPhongMaterial color="#e10600" shininess={100} />
            </mesh>
            {/* Cockpit */}
            <mesh position={[0, 0.65, 0.25]}>
              <boxGeometry args={[0.65, 0.18, 1]} />
              <meshPhongMaterial color="#222222" />
            </mesh>
            {/* Helmet */}
            <mesh position={[0, 0.88, 0.4]}>
              <sphereGeometry args={[0.16, 8, 8]} />
              <meshPhongMaterial color="#e10600" />
            </mesh>
            {/* Front wing */}
            <mesh position={[0, 0.12, -4.1]}>
              <boxGeometry args={[1.85, 0.04, 0.55]} />
              <meshPhongMaterial color="#e10600" />
            </mesh>
            {/* Rear wing */}
            <mesh position={[0, 0.95, 2.7]}>
              <boxGeometry args={[0.95, 0.04, 0.25]} />
              <meshPhongMaterial color="#e10600" />
            </mesh>
            {/* Sidepods */}
            <mesh position={[-0.88, 0.33, 0.2]} castShadow>
              <boxGeometry args={[0.55, 0.38, 2.8]} />
              <meshPhongMaterial color="#cccccc" shininess={80} />
            </mesh>
            <mesh position={[0.88, 0.33, 0.2]} castShadow>
              <boxGeometry args={[0.55, 0.38, 2.8]} />
              <meshPhongMaterial color="#cccccc" shininess={80} />
            </mesh>
            {/* Front wheels — inside chassis, positions relative to chassis origin */}
            <group ref={flSteerRef} position={[-0.82, 0.33, -2.05]}>
              <mesh ref={(el) => { wheelMeshes.current[0] = el }} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.33, 0.33, 0.26, 16]} />
                <meshPhongMaterial color="#333333" />
              </mesh>
            </group>
            <group ref={frSteerRef} position={[0.82, 0.33, -2.05]}>
              <mesh ref={(el) => { wheelMeshes.current[1] = el }} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.33, 0.33, 0.26, 16]} />
                <meshPhongMaterial color="#333333" />
              </mesh>
            </group>
            {/* Rear wheels */}
            <mesh ref={(el) => { wheelMeshes.current[2] = el }} position={[-0.82, 0.35, 1.85]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.33, 0.33, 0.26, 16]} />
              <meshPhongMaterial color="#333333" />
            </mesh>
            <mesh ref={(el) => { wheelMeshes.current[3] = el }} position={[0.82, 0.35, 1.85]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.33, 0.33, 0.26, 16]} />
              <meshPhongMaterial color="#333333" />
            </mesh>
          </group>
        </>
      )}
    </group>
  )
}

function CameraController() {
  const { camera } = useThree()
  const targetRef = useRef(new THREE.Vector3())
  const controlsRef = useRef<any>(null)
  const cameraMode = useRaceStore((s) => s.cameraMode)
  // Pre-allocated vectors to avoid per-frame GC pressure
  const _carPos = useRef(new THREE.Vector3())
  const _camPos = useRef(new THREE.Vector3())
  const _lookAt = useRef(new THREE.Vector3())
  // Smoothed visor heading — much slower lerp for gyro-stabilized feel
  const visorHeading = useRef(0)
  const visorInited = useRef(false)

  useFrame(() => {
    if (!carState.active) return
    const mode = useRaceStore.getState().cameraMode

    _carPos.current.set(carState.pos.x, 1.5, carState.pos.z)
    targetRef.current.lerp(_carPos.current, 0.2)

    if (mode === 'orbit') {
      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetRef.current, 0.2)
        controlsRef.current.update()
      }
    } else if (mode === 'visor') {
      // Smooth heading separately — slow lerp gives onboard camera stability
      const rawH = carState.heading
      if (!visorInited.current) {
        visorHeading.current = rawH
        visorInited.current = true
      } else {
        let dh = rawH - visorHeading.current
        if (dh > Math.PI) dh -= 2 * Math.PI
        if (dh < -Math.PI) dh += 2 * Math.PI
        visorHeading.current += dh * 0.045
      }
      const h = visorHeading.current
      const fwdX = Math.cos(h)
      const fwdZ = Math.sin(h)
      _camPos.current.set(
        _carPos.current.x + fwdX * 0.8,
        _carPos.current.y + 1.15,
        _carPos.current.z + fwdZ * 0.8,
      )
      camera.position.copy(_camPos.current)
      _lookAt.current.set(
        _camPos.current.x + fwdX * 80,
        _camPos.current.y + 0.2,
        _camPos.current.z + fwdZ * 80,
      )
      camera.lookAt(_lookAt.current)
    } else if (mode === 'tv') {
      camera.position.set(targetRef.current.x + 60, 35, targetRef.current.z + 60)
      camera.lookAt(targetRef.current)
    } else if (mode === 'top') {
      camera.position.set(targetRef.current.x, 200, targetRef.current.z)
      camera.lookAt(targetRef.current)
    }
  })

  if (cameraMode === 'orbit') {
    return (
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.1}
        minDistance={10}
        maxDistance={500}
        maxPolarAngle={Math.PI / 2.1}
      />
    )
  }
  return null
}

function HUD() {
  const { telemetry, totalLaps, raceDecision } = useRaceStore()
  if (!telemetry) return null

  const tyreColors: Record<string, string> = {
    soft: 'text-red-400', medium: 'text-yellow-400', hard: 'text-gray-400',
  }
  const activeLineLabel = raceDecision?.racing_lines_now?.recommended_label
  const lineColors: Record<string, string> = {
    Conservative: 'text-blue-400',
    Balanced: 'text-green-400',
    'Late Apex': 'text-yellow-400',
    'Early Apex': 'text-orange-400',
    Aggressive: 'text-red-400',
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {/* Top bar */}
      <div className="absolute top-1 left-2 right-2 flex justify-between text-[9px]">
        <span className="bg-black/75 px-1.5 py-0.5 rounded">
          LAP {telemetry.lap_number}/{totalLaps}
        </span>
        <span className="bg-black/75 px-1.5 py-0.5 rounded">S{telemetry.sector}</span>
        <span className="bg-black/75 px-1.5 py-0.5 rounded">
          {telemetry.last_lap_time > 0 ? `LAST ${telemetry.last_lap_time.toFixed(3)}s` : 'LAST —'}
        </span>
        {activeLineLabel && (
          <span className={`bg-black/75 px-1.5 py-0.5 rounded font-bold ${lineColors[activeLineLabel] || 'text-cyan-400'}`}>
            LINE: {activeLineLabel.toUpperCase()}
          </span>
        )}
        {telemetry.safety_car && (
          <span className="bg-black/75 px-1.5 py-0.5 rounded text-f1yellow font-bold">SC</span>
        )}
      </div>

      {/* Bottom left: speed */}
      <div className="absolute bottom-1 left-2">
        <div className="text-4xl font-black text-white leading-none">{Math.round(telemetry.speed_kph)}</div>
        <div className="text-[7px] text-gray-500 uppercase">KPH</div>
      </div>

      {/* Bottom right: gear, tyre, drs */}
      <div className="absolute bottom-1 right-2 flex gap-3">
        <div className="text-center">
          <div className="text-sm font-bold">{telemetry.gear}</div>
          <div className="text-[7px] text-gray-500 uppercase">Gear</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-bold ${telemetry.drs ? 'text-f1cyan' : 'text-gray-500'}`}>
            {telemetry.drs ? 'ON' : '—'}
          </div>
          <div className="text-[7px] text-gray-500 uppercase">DRS</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-bold ${tyreColors[telemetry.tyre_compound] || ''}`}>
            {telemetry.tyre_compound.slice(0, 3).toUpperCase()}
          </div>
          <div className="text-[7px] text-gray-500 uppercase">Tyre</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold">{telemetry.tyre_age_laps}</div>
          <div className="text-[7px] text-gray-500 uppercase">Age</div>
        </div>
      </div>
    </div>
  )
}

export function CenterView() {
  return (
    <div className="flex-1 relative bg-[#050510]">
      <HUD />
      <Canvas
        shadows
        camera={{ position: [0, 30, 50], fov: 55, near: 0.5, far: 12000 }}
        gl={{ antialias: true }}
      >
        <Sky
          distance={450000}
          sunPosition={[600, 800, 400]}
          turbidity={8}
          rayleigh={0.5}
          mieCoefficient={0.005}
          mieDirectionalG={0.8}
        />
        <Environment preset="sunset" background={false} environmentIntensity={0.4} />
        <fog attach="fog" args={['#8899bb', 800, 5000]} />
        <SoftShadows size={25} samples={16} />

        <ambientLight intensity={0.4} />
        <directionalLight
          position={[600, 800, 400]}
          intensity={1.0}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0005}
          shadow-normalBias={0.02}
          shadow-camera-left={-100}
          shadow-camera-right={100}
          shadow-camera-top={100}
          shadow-camera-bottom={-100}
          shadow-camera-near={1}
          shadow-camera-far={2000}
        />
        <hemisphereLight args={['#87ceeb', '#2d5a1e', 0.4]} />

        {/* Ground */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
          <planeGeometry args={[20000, 20000]} />
          <meshStandardMaterial color="#1a2e1a" roughness={1.0} metalness={0} />
        </mesh>

        <TrackSurface />
        <RubberMarks />
        <WhiteLines />
        <TrackKerbs />
        <RunoffAreas />
        <Barriers />
        <PitLane />
        <DRSZones />
        <RacingLine />
        <Car />
        <CarContactShadow />
        <CameraController />
      </Canvas>
    </div>
  )
}
