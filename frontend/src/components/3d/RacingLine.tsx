import { useMemo } from 'react'
import { useRacingLinePoints } from './useRacingLinePoints'

export function RacingLine() {
  const racingPts = useRacingLinePoints()

  const lineArray = useMemo(() => {
    if (!racingPts || racingPts.length < 3) return null
    const arr = new Float32Array(racingPts.length * 3)
    for (let i = 0; i < racingPts.length; i++) {
      arr[i * 3] = racingPts[i][0]
      arr[i * 3 + 1] = 0.15
      arr[i * 3 + 2] = -racingPts[i][1]
    }
    return arr
  }, [racingPts])

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
