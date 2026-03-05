import { useEffect, useState } from 'react'
import { useRaceStore } from './stores/raceStore'
import { useWebSocket } from './hooks/useWebSocket'
import { useRadioComms } from './hooks/useRadioComms'
import { TopBar } from './components/TopBar'
import { LeftPanel } from './components/LeftPanel'
import { CenterView } from './components/CenterView'
import { RightPanel } from './components/RightPanel'
import { MobileTabBar, type MobileTab } from './components/MobileTabBar'
import { MobileContent } from './components/MobileContent'
import { DashboardAnalytics } from './components/DashboardAnalytics'

export default function App() {
  const { loadTracks, loadDrivers, raceStatus, fetchRaceDecision, showDashboard } = useRaceStore()
  const [activeTab, setActiveTab] = useState<MobileTab>('3d')
  useWebSocket()
  useRadioComms()

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

      {/* Desktop: 3-column layout */}
      <div className="flex-1 hidden md:flex overflow-hidden">
        <LeftPanel />
        <CenterView />
        <RightPanel />
      </div>

      {/* Mobile: tabbed layout */}
      <div className="flex-1 flex flex-col md:hidden overflow-hidden">
        <MobileContent activeTab={activeTab} />
        <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Dashboard overlay */}
      {showDashboard && <DashboardAnalytics />}
    </div>
  )
}
