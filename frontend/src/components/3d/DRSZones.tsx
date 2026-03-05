import { useMemo } from 'react'
import * as THREE from 'three'
import { useRaceStore } from '../../stores/raceStore'
import { DRS_ZONE_DATA } from '../../data/drsZones'

export function DRSZones() {
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
