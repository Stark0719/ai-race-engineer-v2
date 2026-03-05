import { useEffect, useState } from 'react'
import { useRaceStore } from '../stores/raceStore'
import type { UndercutOpportunity } from '../types'

export function UndercutPanel() {
  const { raceStatus, multiCarEnabled } = useRaceStore()
  const [opportunities, setOpportunities] = useState<UndercutOpportunity[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (raceStatus !== 'running' || !multiCarEnabled) {
      setOpportunities([])
      return
    }

    const fetchUndercuts = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/analytics/undercut', { method: 'POST' })
        if (res.ok) {
          const data = await res.json()
          setOpportunities(data.opportunities || [])
        }
      } catch {
        // Silently ignore
      }
      setLoading(false)
    }

    fetchUndercuts()
    const timer = setInterval(fetchUndercuts, 5000)
    return () => clearInterval(timer)
  }, [raceStatus, multiCarEnabled])

  // Only show viable opportunities
  const viable = opportunities.filter((o) => o.viable).slice(0, 5)

  if (!viable.length && !loading) {
    return <div className="text-[10px] text-gray-500">No opportunities detected</div>
  }

  const typeColor = (type: string) => type === 'undercut' ? 'text-f1cyan' : 'text-f1orange'
  const gainColor = (gain: number) => {
    if (gain >= 1.0) return 'text-f1green'
    if (gain >= 0.3) return 'text-f1yellow'
    return 'text-gray-400'
  }
  const confBar = (conf: number) => (
    <div className="w-8 h-1 bg-[#080810] rounded overflow-hidden">
      <div className="h-full bg-f1green rounded" style={{ width: `${conf * 100}%` }} />
    </div>
  )

  return (
    <div className="space-y-1">
      {loading && !viable.length && (
        <div className="text-[10px] text-gray-500">Scanning...</div>
      )}
      {viable.map((opp, i) => (
        <div
          key={`${opp.rival}-${opp.type}-${i}`}
          className="flex items-center gap-1.5 text-[10px] py-0.5"
        >
          <span className={`font-bold uppercase text-[8px] w-12 ${typeColor(opp.type)}`}>
            {opp.type}
          </span>
          <span className="font-bold w-8">{opp.rival}</span>
          <span className={`font-mono w-12 text-right ${gainColor(opp.net_gain_seconds)}`}>
            {opp.net_gain_seconds > 0 ? '+' : ''}{opp.net_gain_seconds.toFixed(1)}s
          </span>
          {confBar(opp.confidence)}
          {opp.optimal_pit_lap && (
            <span className="text-[8px] text-gray-500">L{opp.optimal_pit_lap}</span>
          )}
        </div>
      ))}
    </div>
  )
}
