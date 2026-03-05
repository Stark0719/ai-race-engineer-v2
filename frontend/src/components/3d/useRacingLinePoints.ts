import { useMemo } from 'react'
import { useRaceStore } from '../../stores/raceStore'
import { buildRacingLine, XY } from './buildRacingLine'

/**
 * Shared hook that computes racing line points once.
 * Used by both RacingLine and RubberMarks to avoid duplicate computation.
 */
export function useRacingLinePoints(): XY[] | null {
  const currentTrack = useRaceStore((s) => s.currentTrack)
  const recommendedLine = useRaceStore((s) => s.raceDecision?.racing_lines_now?.recommended_line)

  return useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3) return null
    const mode = (recommendedLine || 'balanced') as
      'conservative' | 'balanced' | 'late_apex' | 'early_apex' | 'aggressive'
    return buildRacingLine(
      currentTrack.waypoints_xy,
      currentTrack.track_width || 12,
      currentTrack.corners,
      mode,
    )
  }, [currentTrack, recommendedLine])
}
