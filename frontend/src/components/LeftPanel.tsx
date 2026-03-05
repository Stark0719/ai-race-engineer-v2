import { useEffect, useState, memo } from 'react'
import { useRaceStore } from '../stores/raceStore'
import { useShallow } from 'zustand/react/shallow'
import { TrackMap } from './track/TrackMap'
import { SessionBrowser } from './SessionBrowser'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-2 border-b border-border">
      <h3 className="text-[8px] font-bold text-gray-500 uppercase tracking-wider mb-1">{title}</h3>
      {children}
    </div>
  )
}

const StrategyPanel = memo(function StrategyPanel() {
  const { runStrategy, strategyResult, strategyLoading, currentTrack } = useRaceStore(useShallow((s) => ({
    runStrategy: s.runStrategy, strategyResult: s.strategyResult, strategyLoading: s.strategyLoading, currentTrack: s.currentTrack,
  })))
  const [pitLoss, setPitLoss] = useState(20)
  const [scProb, setScProb] = useState(20)
  const [iters, setIters] = useState(300)

  // Sync defaults from the selected track when it changes.
  useEffect(() => {
    if (!currentTrack) return
    setPitLoss(Math.round(currentTrack.pit_loss))
    setScProb(Math.round(currentTrack.safety_car_prob * 100))
  }, [currentTrack?.key])

  return (
    <>
      <div className="flex items-center gap-1 my-1">
        <label className="text-[9px] text-gray-500 w-10">Pit Loss</label>
        <input type="range" min={10} max={35} value={pitLoss}
          onChange={(e) => setPitLoss(Number(e.target.value))}
          className="flex-1 h-1 bg-border rounded accent-f1red" />
        <span className="text-[10px] font-bold w-7 text-right">{pitLoss}s</span>
      </div>
      <div className="flex items-center gap-1 my-1">
        <label className="text-[9px] text-gray-500 w-10">SC Prob</label>
        <input type="range" min={0} max={50} value={scProb}
          onChange={(e) => setScProb(Number(e.target.value))}
          className="flex-1 h-1 bg-border rounded accent-f1red" />
        <span className="text-[10px] font-bold w-7 text-right">{scProb}%</span>
      </div>
      <div className="flex items-center gap-1 my-1">
        <label className="text-[9px] text-gray-500 w-10">Iters</label>
        <input type="number" value={iters} min={50} max={5000} step={50}
          onChange={(e) => setIters(Number(e.target.value))}
          className="bg-bg border border-border rounded px-1 py-0.5 text-[10px] w-14" />
        <button
          onClick={() => runStrategy(pitLoss, scProb / 100, iters)}
          disabled={strategyLoading}
          className="bg-f1blue text-white px-2 py-0.5 rounded text-[9px] font-bold uppercase disabled:opacity-50"
        >
          {strategyLoading ? '...' : 'Run Monte Carlo'}
        </button>
      </div>
      {strategyResult && (
        <div className="bg-panel2 rounded p-1.5 mt-1 text-[10px]">
          <div className="text-xs font-bold">
            {strategyResult.recommended === '1-stop' ? '🔵' : '🟠'}{' '}
            {strategyResult.recommended.toUpperCase()}
          </div>
          <div className="text-gray-500">Confidence: {Math.round(strategyResult.confidence * 100)}%</div>
          <div className="flex gap-px h-1.5 rounded overflow-hidden my-1">
            <div className="bg-f1blue" style={{ width: `${strategyResult.one_stop_win_rate * 100}%` }} />
            <div className="bg-f1orange" style={{ width: `${strategyResult.two_stop_win_rate * 100}%` }} />
          </div>
          <div>1-Stop: {(strategyResult.one_stop_win_rate * 100).toFixed(1)}% · 2-Stop: {(strategyResult.two_stop_win_rate * 100).toFixed(1)}%</div>
        </div>
      )}
    </>
  )
})

const ChatPanel = memo(function ChatPanel() {
  const { chatMessages, chatLoading, sendChat } = useRaceStore(useShallow((s) => ({
    chatMessages: s.chatMessages, chatLoading: s.chatLoading, sendChat: s.sendChat,
  })))
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (!input.trim()) return
    sendChat(input.trim())
    setInput('')
  }

  return (
    <>
      <div className="max-h-24 overflow-y-auto mb-1">
        {chatMessages.map((m, i) => (
          <div key={i} className={`text-[10px] p-1 my-0.5 rounded ${
            m.role === 'user' ? 'bg-border text-right' : 'bg-[#0a1a0a] border-l-2 border-f1green'
          }`}>
            {m.text}
          </div>
        ))}
        {chatLoading && (
          <div className="text-[10px] text-gray-500 p-1">Thinking...</div>
        )}
      </div>
      <div className="flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask about strategy..."
          className="flex-1 bg-bg border border-border rounded px-1.5 py-0.5 text-[10px]"
        />
        <button onClick={handleSend}
          className="bg-f1blue text-white px-2 py-0.5 rounded text-[9px] font-bold">
          Ask
        </button>
      </div>
    </>
  )
})

// Team color mapping (same as GhostCars)
const TEAM_COLORS: Record<string, string> = {
  'Red Bull Racing': '#3671C6', 'Red Bull': '#3671C6',
  'Ferrari': '#E8002D', 'Scuderia Ferrari': '#E8002D',
  'Mercedes': '#27F4D2', 'McLaren': '#FF8000',
  'Aston Martin': '#229971',
  'Alpine': '#FF87BC', 'Alpine F1 Team': '#FF87BC',
  'Williams': '#64C4FF',
  'RB': '#6692FF', 'AlphaTauri': '#6692FF',
  'Haas F1 Team': '#B6BABD', 'Haas': '#B6BABD',
  'Kick Sauber': '#52E252', 'Alfa Romeo': '#52E252', 'Sauber': '#52E252',
}

function getTeamColor(team: string): string {
  if (TEAM_COLORS[team]) return TEAM_COLORS[team]
  const lower = team.toLowerCase()
  for (const [key, color] of Object.entries(TEAM_COLORS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return color
  }
  return '#888888'
}

const DriverListPanel = memo(function DriverListPanel() {
  const {
    carPositions, replayDrivers, replayDriver,
    focusedDriver, setFocusedDriver, telemetry, timingGaps,
  } = useRaceStore(useShallow((s) => ({
    carPositions: s.carPositions, replayDrivers: s.replayDrivers, replayDriver: s.replayDriver,
    focusedDriver: s.focusedDriver, setFocusedDriver: s.setFocusedDriver, telemetry: s.telemetry, timingGaps: s.timingGaps,
  })))

  if (!carPositions) return null

  // Build sorted driver list: main driver + ghosts sorted by position
  type DriverEntry = { abbrev: string; team: string; position: number; isMain: boolean; speed: number }
  const entries: DriverEntry[] = []

  // Add main replay driver
  if (telemetry) {
    const mainDrv = replayDrivers.find((d) => d.abbreviation === replayDriver)
    entries.push({
      abbrev: replayDriver,
      team: mainDrv?.team || '',
      position: telemetry.position,
      isMain: true,
      speed: Math.round(telemetry.speed_kph),
    })
  }

  // Add ghost drivers
  for (const [abbrev, pos] of Object.entries(carPositions)) {
    const drv = replayDrivers.find((d) => d.abbreviation === abbrev)
    entries.push({
      abbrev,
      team: drv?.team || '',
      position: pos.position,
      isMain: false,
      speed: Math.round(pos.speed_kph),
    })
  }

  entries.sort((a, b) => a.position - b.position)

  const isFocused = (abbrev: string, isMain: boolean) => {
    if (isMain) return !focusedDriver
    return focusedDriver === abbrev
  }

  // Build gap lookup from timing data
  const gapMap = new Map(timingGaps.map((g) => [g.driver, g]))

  const formatGap = (gap: number) => {
    if (gap <= 0) return ''
    return `+${gap.toFixed(1)}s`
  }

  const gapColor = (gap: number) => {
    if (gap <= 0) return ''
    if (gap < 1.0) return 'text-f1red'      // DRS range
    if (gap < 3.0) return 'text-f1yellow'
    return 'text-gray-500'
  }

  return (
    <div className="max-h-[200px] overflow-y-auto">
      {entries.map(({ abbrev, team, position, isMain, speed }) => {
        const color = getTeamColor(team)
        const focused = isFocused(abbrev, isMain)
        const timing = gapMap.get(abbrev)
        const gap = timing?.gap_to_leader ?? 0
        return (
          <button
            key={abbrev}
            onClick={() => setFocusedDriver(isMain ? null : abbrev)}
            className={`w-full flex items-center gap-1.5 px-1.5 py-[3px] text-left transition-colors ${
              focused ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            {/* Position */}
            <span className="text-[9px] text-gray-500 w-4 text-right font-mono">
              {position}
            </span>
            {/* Team color bar */}
            <span
              className="w-[3px] h-3 rounded-sm shrink-0"
              style={{ background: color }}
            />
            {/* Abbreviation */}
            <span className={`text-[10px] font-bold w-8 ${focused ? 'text-white' : 'text-gray-300'}`}>
              {abbrev}
            </span>
            {/* Gap to leader */}
            <span className={`text-[8px] font-mono w-12 text-right ${gapColor(gap)}`}>
              {position === 1 ? 'LEADER' : formatGap(gap)}
            </span>
            {/* Speed */}
            <span className="text-[8px] text-gray-500 font-mono w-8 text-right">
              {speed}
            </span>
            {/* Focus indicator */}
            {focused && (
              <span className="w-1.5 h-1.5 rounded-full bg-f1cyan shrink-0" />
            )}
          </button>
        )
      })}
    </div>
  )
})

export function LeftPanel() {
  const {
    currentTrack, telemetry, totalLaps, bestLapTime, lastLapSectors, lastLapSectorColors,
    multiCarEnabled, carPositions,
  } = useRaceStore(useShallow((s) => ({
    currentTrack: s.currentTrack, telemetry: s.telemetry, totalLaps: s.totalLaps,
    bestLapTime: s.bestLapTime, lastLapSectors: s.lastLapSectors, lastLapSectorColors: s.lastLapSectorColors,
    multiCarEnabled: s.multiCarEnabled, carPositions: s.carPositions,
  })))
  const sectorColor = (c: 'purple' | 'yellow' | 'none') => (
    c === 'purple' ? '#b388ff' : c === 'yellow' ? '#ffd54f' : '#9ca3af'
  )

  const showDriverList = multiCarEnabled && carPositions

  return (
    <div className="w-full md:w-[280px] md:shrink-0 bg-panel border-r border-border overflow-y-auto">
      <Panel title="📍 Circuit Map">
        <TrackMap />
        <div className="text-[9px] mt-1 bg-panel2 rounded px-1.5 py-1">
          <div className="flex items-center gap-2 text-gray-400">
            <span>Best {bestLapTime ? `${bestLapTime.toFixed(3)}s` : '--'}</span>
            <span style={{ color: sectorColor(lastLapSectorColors.s1) }}>S1 {lastLapSectors.s1 ? `${lastLapSectors.s1.toFixed(3)}s` : '--'}</span>
            <span style={{ color: sectorColor(lastLapSectorColors.s2) }}>S2 {lastLapSectors.s2 ? `${lastLapSectors.s2.toFixed(3)}s` : '--'}</span>
            <span style={{ color: sectorColor(lastLapSectorColors.s3) }}>S3 {lastLapSectors.s3 ? `${lastLapSectors.s3.toFixed(3)}s` : '--'}</span>
          </div>
          <div className="flex items-center gap-2 text-[8px] text-gray-500 mt-0.5">
            <span className="inline-flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#69f0ae' }} />Current</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#b388ff' }} />Best</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#ffd54f' }} />Off best</span>
          </div>
        </div>
        {currentTrack && (
          <div className="text-[9px] text-gray-500 mt-1">
            <strong className="text-gray-400">{currentTrack.name}</strong> — {currentTrack.country}
            <br />
            {currentTrack.circuit_length_m}m · {currentTrack.total_laps} laps · Pit: {currentTrack.pit_loss}s · SC: {Math.round(currentTrack.safety_car_prob * 100)}%
          </div>
        )}
      </Panel>

      {showDriverList && (
        <Panel title="🏎 Drivers">
          <DriverListPanel />
        </Panel>
      )}

      <Panel title="🎲 Strategy Simulation">
        <StrategyPanel />
      </Panel>

      <Panel title="💬 AI Race Engineer">
        <ChatPanel />
      </Panel>

      <Panel title="💾 Sessions">
        <SessionBrowser />
      </Panel>

      <Panel title="🔮 Pit Window">
        {telemetry && telemetry.lap_number > 2 ? (
          <div className="text-[10px]">
            {telemetry.tyre_wear_pct > 0.65 ? (
              <span className="text-f1red font-bold">⚠️ PIT NOW</span>
            ) : telemetry.tyre_wear_pct > 0.4 ? (
              <span className="text-f1yellow">
                💡 Window: L{telemetry.lap_number + 2}–{Math.min(telemetry.lap_number + 8, totalLaps - 3)}
              </span>
            ) : (
              <span className="text-f1green">✅ Tyres OK</span>
            )}
            {telemetry.safety_car && <><br /><span className="text-f1yellow">SC — reduced pit loss!</span></>}
            <br />
            <span className="text-gray-500">
              Wear: {Math.round(telemetry.tyre_wear_pct * 100)}% · Rem: {totalLaps - telemetry.lap_number}
            </span>
          </div>
        ) : (
          <div className="text-[10px] text-gray-500">Start race to see pit window</div>
        )}
      </Panel>
    </div>
  )
}
