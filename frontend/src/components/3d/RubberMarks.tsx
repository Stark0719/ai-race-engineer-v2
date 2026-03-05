import { useMemo } from 'react'
import * as THREE from 'three'
import { useRacingLinePoints } from './useRacingLinePoints'

export function RubberMarks() {
  const racingPts = useRacingLinePoints()

  const geometry = useMemo(() => {
    if (!racingPts || racingPts.length < 3) return null
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
  }, [racingPts])

  if (!geometry) return null
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#1a1a1a" roughness={0.7} metalness={0} transparent opacity={0.6} />
    </mesh>
  )
}
