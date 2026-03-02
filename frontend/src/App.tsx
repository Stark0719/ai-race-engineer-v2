import { useEffect } from 'react'
import { useRaceStore } from './stores/raceStore'
import { useWebSocket } from './hooks/useWebSocket'
import { TopBar } from './components/TopBar'
import { LeftPanel } from './components/LeftPanel'
import { CenterView } from './components/CenterView'
import { RightPanel } from './components/RightPanel'

export default function App() {
  const { loadTracks, loadDrivers, raceStatus, fetchRaceDecision } = useRaceStore()
  useWebSocket()

  useEffect(() => {
    loadTracks()
    loadDrivers()
  }, [loadTracks, loadDrivers])

  useEffect(() => {
    if (raceStatus !== 'running') return
    fetchRaceDecision()
    const timer = window.setInterval(() => {
      fetchRaceDecision()
    }, 3500)
    return () => window.clearInterval(timer)
  }, [raceStatus, fetchRaceDecision])

  return (
    <div className="h-screen w-screen flex flex-col bg-bg text-gray-200 font-mono text-xs overflow-hidden">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <LeftPanel />
        <CenterView />
        <RightPanel />
      </div>
    </div>
  )
}
