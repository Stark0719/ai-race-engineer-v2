import { memo } from 'react'
import { useRaceStore } from '../stores/raceStore'
import { useShallow } from 'zustand/react/shallow'
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts'
import { SectorComparison } from './SectorComparison'
import { FuelPanel } from './FuelPanel'
import { UndercutPanel } from './UndercutPanel'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-2 border-b border-border">
      <h3 className="text-[8px] font-bold text-gray-500 uppercase tracking-wider mb-1">{title}</h3>
      {children}
    </div>
  )
}

const MiniChart = memo(function MiniChart({ data, color, min, max }: { data: number[]; color: string; min: number; max: number }) {
  const chartData = data.map((v, i) => ({ i, v }))
  return (
    <div className="h-11 w-full">
      <ResponsiveContainer>
        <LineChart data={chartData}>
          <YAxis domain={[min, max]} hide />
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})

function DataRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between py-0.5 text-[10px]">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold" style={color ? { color } : undefined}>{value}</span>
    </div>
  )
}

export function RightPanel() {
  const {
    telemetry, speedHistory, tempHistory, throttleBrakeHistory, lapTimes,
    raceDecision, raceDecisionLoading, fetchRaceDecision,
    bestLapTime, lastLapSectors, lastLapSectorColors,
    focusedDriver,
  } = useRaceStore(useShallow((s) => ({
    telemetry: s.telemetry,
    speedHistory: s.speedHistory,
    tempHistory: s.tempHistory,
    throttleBrakeHistory: s.throttleBrakeHistory,
    lapTimes: s.lapTimes,
    raceDecision: s.raceDecision,
    raceDecisionLoading: s.raceDecisionLoading,
    fetchRaceDecision: s.fetchRaceDecision,
    bestLapTime: s.bestLapTime,
    lastLapSectors: s.lastLapSectors,
    lastLapSectorColors: s.lastLapSectorColors,
    focusedDriver: s.focusedDriver,
  })))

  const tyreColors: Record<string, string> = {
    soft: '#FF3333', medium: '#FFD700', hard: '#CCCCCC',
  }

  return (
    <div className="w-full md:w-[320px] md:shrink-0 bg-panel border-l border-border overflow-y-auto">
      <Panel title="🧠 Race Decision">
        <div className="flex justify-end mb-1">
          <button
            onClick={fetchRaceDecision}
            disabled={raceDecisionLoading}
            className="text-[8px] px-1.5 py-0.5 rounded border border-border bg-bg text-gray-300 disabled:opacity-50"
          >
            {raceDecisionLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {raceDecision ? (
          <div className="text-[10px] space-y-1">
            {(() => {
              const c = raceDecision.decision.reasoning.strategy_confidence ?? 0
              const confColor = c >= 0.75 ? 'text-f1green' : c >= 0.6 ? 'text-f1yellow' : 'text-f1red'
              const lineGap = raceDecision.decision.reasoning.line_delta_to_second_best
              const lineColor = lineGap >= 0.2 ? 'text-f1green' : lineGap >= 0.08 ? 'text-f1yellow' : 'text-f1red'
              return (
                <div className="flex justify-between items-center border-b border-border pb-1">
                  <span className="text-gray-500">Confidence</span>
                  <span className={`font-bold ${confColor}`}>{Math.round(c * 100)}%</span>
                  <span className={`font-bold ${lineColor}`}>Line +{lineGap.toFixed(3)}s</span>
                </div>
              )
            })()}
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Strategy</span>
              <span className="font-bold">{raceDecision.decision.reasoning.strategy_choice.toUpperCase()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Line</span>
              <span className="font-bold">{raceDecision.racing_lines_now.recommended_label}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Pit Window</span>
              <span>
                L{raceDecision.decision.pit_window_lap_range[0]}–L{raceDecision.decision.pit_window_lap_range[1]}
              </span>
            </div>
            <div className={`font-bold ${raceDecision.decision.pit_now ? 'text-f1red' : 'text-f1green'}`}>
              {raceDecision.decision.pit_now ? 'PIT NOW' : 'STAY OUT'}
            </div>
            <div className="text-gray-500">
              Line delta: +{raceDecision.decision.reasoning.line_delta_to_second_best.toFixed(3)}s
              {' · '}
              Wear: {(raceDecision.decision.reasoning.wear_pct * 100).toFixed(1)}%
            </div>
            {raceDecision.racing_lines_rolling?.rollout?.length > 0 && (
              <div className="pt-1 border-t border-border">
                <div className="text-gray-500 mb-0.5">Rolling Line Outlook</div>
                {raceDecision.racing_lines_rolling.rollout.slice(0, 4).map((r) => (
                  <div key={r.lap} className="flex justify-between">
                    <span>L{r.lap}</span>
                    <span>{r.recommended_label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-gray-500">
            {raceDecisionLoading ? 'Computing decision...' : 'Start race to get live decision'}
          </div>
        )}
      </Panel>

      <Panel title="🔄 Undercut / Overcut">
        <UndercutPanel />
      </Panel>

      <Panel title="⛽ Fuel Strategy">
        <FuelPanel />
      </Panel>

      <Panel title="📊 Live Telemetry">
        {telemetry ? (
          <>
            <DataRow label="Speed" value={`${Math.round(telemetry.speed_kph)} kph`} />
            <DataRow label="Gear" value={`${telemetry.gear}${telemetry.drs ? ' DRS' : ''}`} color={telemetry.drs ? '#00bcd4' : undefined} />
            <DataRow label="Throttle" value={`${Math.round(telemetry.throttle * 100)}%`} color="#00c853" />
            <DataRow label="Brake" value={`${Math.round(telemetry.brake * 100)}%`} color="#e10600" />
            <DataRow label="Tyre" value={`${telemetry.tyre_compound.toUpperCase()} · ${telemetry.tyre_age_laps} laps`} />
            <DataRow label="Temp" value={`${Math.round(telemetry.tyre_temp_c)}°C`} />
            <DataRow label="Wear" value={`${(telemetry.tyre_wear_pct * 100).toFixed(1)}%`} />
            <DataRow label="Fuel" value={`${telemetry.fuel_remaining_kg.toFixed(1)} kg`} />
            <DataRow label="Position" value={`P${telemetry.position}`} />
          </>
        ) : (
          <div className="text-[10px] text-gray-500">Start race to see telemetry</div>
        )}
      </Panel>

      <Panel title="🏁 Lap / Sectors">
        <div className="text-[10px]">
          <DataRow label="Best Lap" value={bestLapTime ? `${bestLapTime.toFixed(3)}s` : '--'} />
          <DataRow
            label="S1"
            value={lastLapSectors.s1 ? `${lastLapSectors.s1.toFixed(3)}s` : '--'}
            color={lastLapSectorColors.s1 === 'purple' ? '#b388ff' : lastLapSectorColors.s1 === 'yellow' ? '#ffd54f' : undefined}
          />
          <DataRow
            label="S2"
            value={lastLapSectors.s2 ? `${lastLapSectors.s2.toFixed(3)}s` : '--'}
            color={lastLapSectorColors.s2 === 'purple' ? '#b388ff' : lastLapSectorColors.s2 === 'yellow' ? '#ffd54f' : undefined}
          />
          <DataRow
            label="S3"
            value={lastLapSectors.s3 ? `${lastLapSectors.s3.toFixed(3)}s` : '--'}
            color={lastLapSectorColors.s3 === 'purple' ? '#b388ff' : lastLapSectorColors.s3 === 'yellow' ? '#ffd54f' : undefined}
          />
        </div>
      </Panel>

      {focusedDriver && (
        <Panel title={`vs ${focusedDriver} Sectors`}>
          <SectorComparison />
        </Panel>
      )}

      <Panel title="Speed Trace">
        {speedHistory.length > 1 ? (
          <MiniChart data={speedHistory} color="#00bcd4" min={0} max={380} />
        ) : (
          <div className="h-11 bg-[#080810] rounded" />
        )}
      </Panel>

      <Panel title="Tyre Temperature">
        {tempHistory.length > 1 ? (
          <MiniChart data={tempHistory} color="#ff6b35" min={30} max={140} />
        ) : (
          <div className="h-11 bg-[#080810] rounded" />
        )}
      </Panel>

      <Panel title="Throttle / Brake">
        {throttleBrakeHistory.length > 1 ? (
          <MiniChart data={throttleBrakeHistory} color="#00c853" min={-100} max={100} />
        ) : (
          <div className="h-11 bg-[#080810] rounded" />
        )}
      </Panel>

      <Panel title="⏱ Lap Times">
        {lapTimes.length > 1 && (
          <MiniChart
            data={lapTimes.map((l) => l.time)}
            color="#2196F3"
            min={Math.min(...lapTimes.map((l) => l.time)) - 2}
            max={Math.max(...lapTimes.map((l) => l.time)) + 2}
          />
        )}
        <div className="max-h-20 overflow-y-auto mt-1">
          {lapTimes.slice().reverse().map((l, i) => (
            <div key={i} className="flex justify-between py-0.5 text-[9px]">
              <span>L{l.lap}</span>
              <span style={{ color: tyreColors[l.compound] || '#fff' }}>{l.compound.toUpperCase()}</span>
              <span className="font-bold">{l.time.toFixed(3)}s</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
