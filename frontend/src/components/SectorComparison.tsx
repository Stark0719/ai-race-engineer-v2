import { useEffect, useState } from 'react'
import { useRaceStore } from '../stores/raceStore'
import type { SectorComparison as SectorComparisonType } from '../types'

export function SectorComparison() {
  const { focusedDriver, raceStatus } = useRaceStore()
  const [data, setData] = useState<SectorComparisonType | null>(null)

  useEffect(() => {
    if (!focusedDriver || raceStatus !== 'running') {
      setData(null)
      return
    }

    const fetchSectors = async () => {
      try {
        const res = await fetch(`/api/analytics/sectors?target_driver=${focusedDriver}`)
        if (res.ok) {
          setData(await res.json())
        }
      } catch {
        // Silently ignore fetch errors
      }
    }

    fetchSectors()
    const timer = setInterval(fetchSectors, 2000)
    return () => clearInterval(timer)
  }, [focusedDriver, raceStatus])

  if (!data) return null

  const deltaColor = (d: number) => {
    if (d < -0.05) return 'text-f1green'  // faster
    if (d > 0.05) return 'text-f1red'     // slower
    return 'text-gray-400'
  }

  const formatTime = (t: number) => t > 0 ? t.toFixed(3) : '--'
  const formatDelta = (d: number) => {
    if (d === 0) return '--'
    return `${d > 0 ? '+' : ''}${d.toFixed(3)}`
  }

  const sectors = [
    { label: 'S1', key: 's1' as const },
    { label: 'S2', key: 's2' as const },
    { label: 'S3', key: 's3' as const },
  ]

  return (
    <div className="text-[10px]">
      <div className="flex justify-between text-[8px] text-gray-500 mb-0.5 px-1">
        <span className="w-6" />
        <span className="w-14 text-right">{data.focused_driver}</span>
        <span className="w-14 text-right">{data.target_driver}</span>
        <span className="w-14 text-right">Delta</span>
      </div>
      {sectors.map(({ label, key }) => (
        <div key={key} className="flex justify-between items-center px-1 py-0.5">
          <span className="text-gray-500 w-6 font-bold">{label}</span>
          <span className="w-14 text-right font-mono">{formatTime(data.focused[key])}</span>
          <span className="w-14 text-right font-mono">{formatTime(data.target[key])}</span>
          <span className={`w-14 text-right font-mono font-bold ${deltaColor(data.delta[key])}`}>
            {formatDelta(data.delta[key])}
          </span>
        </div>
      ))}
    </div>
  )
}
