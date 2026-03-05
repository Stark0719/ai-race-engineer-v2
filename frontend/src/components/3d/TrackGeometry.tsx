import { useMemo } from 'react'
import * as THREE from 'three'
import { useRaceStore } from '../../stores/raceStore'

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

export function TrackSurface() {
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

export function TrackKerbs() {
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

export function WhiteLines() {
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

export function RunoffAreas() {
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

export function Barriers() {
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

export function PitLane() {
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
