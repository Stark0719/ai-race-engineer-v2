import { useEffect, useState } from 'react'
import { useRaceStore } from '../stores/raceStore'
import { TrackMap } from './track/TrackMap'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-2 border-b border-border">
      <h3 className="text-[8px] font-bold text-gray-500 uppercase tracking-wider mb-1">{title}</h3>
      {children}
    </div>
  )
}

function StrategyPanel() {
  const { runStrategy, strategyResult, strategyLoading, currentTrack } = useRaceStore()
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
}

function ChatPanel() {
  const { chatMessages, chatLoading, sendChat } = useRaceStore()
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
}

export function LeftPanel() {
  const { currentTrack, telemetry, totalLaps, bestLapTime, lastLapSectors, lastLapSectorColors } = useRaceStore()
  const sectorColor = (c: 'purple' | 'yellow' | 'none') => (
    c === 'purple' ? '#b388ff' : c === 'yellow' ? '#ffd54f' : '#9ca3af'
  )

  return (
    <div className="w-[280px] shrink-0 bg-panel border-r border-border overflow-y-auto">
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

      <Panel title="🎲 Strategy Simulation">
        <StrategyPanel />
      </Panel>

      <Panel title="💬 AI Race Engineer">
        <ChatPanel />
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
