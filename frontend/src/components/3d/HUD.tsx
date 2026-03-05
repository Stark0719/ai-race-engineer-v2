import { useRaceStore } from '../../stores/raceStore'

export function HUD() {
  const { telemetry, totalLaps, raceDecision } = useRaceStore()
  if (!telemetry) return null

  const tyreColors: Record<string, string> = {
    soft: 'text-red-400', medium: 'text-yellow-400', hard: 'text-gray-400',
  }
  const activeLineLabel = raceDecision?.racing_lines_now?.recommended_label
  const lineColors: Record<string, string> = {
    Conservative: 'text-blue-400',
    Balanced: 'text-green-400',
    'Late Apex': 'text-yellow-400',
    'Early Apex': 'text-orange-400',
    Aggressive: 'text-red-400',
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      <div className="absolute top-1 left-2 right-2 flex justify-between text-[9px]">
        <span className="bg-black/75 px-1.5 py-0.5 rounded">
          LAP {telemetry.lap_number}/{totalLaps}
        </span>
        <span className="bg-black/75 px-1.5 py-0.5 rounded">S{telemetry.sector}</span>
        <span className="bg-black/75 px-1.5 py-0.5 rounded">
          {telemetry.last_lap_time > 0 ? `LAST ${telemetry.last_lap_time.toFixed(3)}s` : 'LAST —'}
        </span>
        {activeLineLabel && (
          <span className={`bg-black/75 px-1.5 py-0.5 rounded font-bold ${lineColors[activeLineLabel] || 'text-cyan-400'}`}>
            LINE: {activeLineLabel.toUpperCase()}
          </span>
        )}
        {telemetry.safety_car && (
          <span className="bg-black/75 px-1.5 py-0.5 rounded text-f1yellow font-bold">SC</span>
        )}
      </div>

      <div className="absolute bottom-1 left-2">
        <div className="text-4xl font-black text-white leading-none">{Math.round(telemetry.speed_kph)}</div>
        <div className="text-[7px] text-gray-500 uppercase">KPH</div>
      </div>

      <div className="absolute bottom-1 right-2 flex gap-3">
        <div className="text-center">
          <div className="text-sm font-bold">{telemetry.gear}</div>
          <div className="text-[7px] text-gray-500 uppercase">Gear</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-bold ${telemetry.drs ? 'text-f1cyan' : 'text-gray-500'}`}>
            {telemetry.drs ? 'ON' : '—'}
          </div>
          <div className="text-[7px] text-gray-500 uppercase">DRS</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-bold ${tyreColors[telemetry.tyre_compound] || ''}`}>
            {telemetry.tyre_compound.slice(0, 3).toUpperCase()}
          </div>
          <div className="text-[7px] text-gray-500 uppercase">Tyre</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold">{telemetry.tyre_age_laps}</div>
          <div className="text-[7px] text-gray-500 uppercase">Age</div>
        </div>
      </div>
    </div>
  )
}
