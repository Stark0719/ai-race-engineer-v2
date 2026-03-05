import { useRaceStore } from '../stores/raceStore'

export function FuelPanel() {
  const { telemetry, totalLaps } = useRaceStore()

  if (!telemetry) return <div className="text-[10px] text-gray-500">Start race to see fuel data</div>

  const fuelPct = (telemetry.fuel_remaining_kg / 110) * 100
  const fuelBarColor = fuelPct > 30 ? '#00c853' : fuelPct > 15 ? '#ffd54f' : '#e10600'
  const burnRate = 1.75 // kg per lap (from config)
  const lapsRemaining = totalLaps - telemetry.lap_number
  const fuelToFinish = lapsRemaining * burnRate
  const fuelDelta = telemetry.fuel_remaining_kg - fuelToFinish
  const weightPenalty = (telemetry.fuel_remaining_kg * 0.035).toFixed(2)

  return (
    <div className="text-[10px] space-y-1">
      {/* Fuel bar */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 w-10">Fuel</span>
        <div className="flex-1 h-1.5 bg-[#080810] rounded overflow-hidden">
          <div
            className="h-full rounded transition-all"
            style={{ width: `${Math.max(0, Math.min(100, fuelPct))}%`, background: fuelBarColor }}
          />
        </div>
        <span className="font-mono w-14 text-right">{telemetry.fuel_remaining_kg.toFixed(1)} kg</span>
      </div>

      <div className="flex justify-between">
        <span className="text-gray-500">Burn rate</span>
        <span className="font-mono">{burnRate} kg/lap</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">To finish</span>
        <span className="font-mono">{fuelToFinish.toFixed(1)} kg needed</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">Delta</span>
        <span className={`font-mono font-bold ${fuelDelta >= 0 ? 'text-f1green' : 'text-f1red'}`}>
          {fuelDelta >= 0 ? '+' : ''}{fuelDelta.toFixed(1)} kg
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">Weight penalty</span>
        <span className="font-mono">+{weightPenalty}s/lap</span>
      </div>
    </div>
  )
}
