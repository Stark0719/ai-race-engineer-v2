import { useEffect } from 'react'
import { useRaceStore } from '../stores/raceStore'

export function SessionBrowser() {
  const { savedSessions, loadSavedSessions, setShowDashboard } = useRaceStore()

  useEffect(() => {
    loadSavedSessions()
  }, [loadSavedSessions])

  const handleLoad = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/saved/${id}`)
      if (!res.ok) return
      const data = await res.json()
      // Populate dashboard with the saved session data
      useRaceStore.setState({
        dashboardData: {
          lap_times: data.lap_times || [],
          stint_summary: [],
          degradation_curve: [],
          total_time: data.total_time || 0,
          pit_history: data.pit_history || [],
          consistency_score: 0,
          sector_evolution: [],
        },
        showDashboard: true,
      })
    } catch (err) {
      console.error('Failed to load session:', err)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/sessions/saved/${id}`, { method: 'DELETE' })
      loadSavedSessions()
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts)
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    } catch {
      return ts
    }
  }

  if (!savedSessions.length) {
    return <div className="text-[10px] text-gray-500">No saved sessions</div>
  }

  return (
    <div className="max-h-[150px] overflow-y-auto space-y-1">
      {savedSessions.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-1.5 bg-panel2 rounded px-1.5 py-1 text-[9px]"
        >
          <div className="flex-1 min-w-0">
            <div className="font-bold text-gray-300 truncate">
              {s.track} — {s.driver}
            </div>
            <div className="text-gray-500 text-[8px]">
              {formatDate(s.timestamp)} · {s.total_laps}L · {s.mode}
              {s.best_lap ? ` · Best: ${s.best_lap.toFixed(3)}s` : ''}
            </div>
          </div>
          <button
            onClick={() => handleLoad(s.id)}
            className="px-1.5 py-0.5 bg-f1blue text-white rounded text-[8px] font-bold shrink-0"
          >
            View
          </button>
          <button
            onClick={() => handleDelete(s.id)}
            className="px-1 py-0.5 border border-border text-gray-500 rounded text-[8px] shrink-0 hover:text-f1red hover:border-f1red"
          >
            Del
          </button>
        </div>
      ))}
    </div>
  )
}
