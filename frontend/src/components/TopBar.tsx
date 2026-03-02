import { useRaceStore } from '../stores/raceStore'

export function TopBar() {
  const {
    tracks, selectedTrack, selectTrack,
    drivers, selectedDriver, setDriver,
    selectedCompound, setCompound,
    speedMultiplier, setSpeedMultiplier,
    pitLap, setPitLap, nextCompound, setNextCompound,
    raceStatus, startRace, stopRace, pitNow,
    cameraMode, setCameraMode,
  } = useRaceStore()

  const trackKeys = Object.keys(tracks)
  const isRunning = raceStatus === 'running'

  return (
    <div className="h-9 bg-panel border-b border-border flex items-center px-2 gap-2 shrink-0">
      {/* Logo */}
      <h1 className="text-xs font-bold whitespace-nowrap mr-2">
        🏎️ <span className="text-f1red">Race Engineer</span>
      </h1>

      {/* Track selector */}
      <label className="text-[9px] text-gray-500">Track</label>
      <select
        value={selectedTrack || ''}
        onChange={(e) => selectTrack(e.target.value)}
        className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px] max-w-[180px]"
      >
        {trackKeys.length === 0 && <option value="">Loading...</option>}
        {trackKeys.map((k) => (
          <option key={k} value={k}>
            {tracks[k].name} ({tracks[k].country})
          </option>
        ))}
      </select>

      {/* Driver */}
      <label className="text-[9px] text-gray-500">Driver</label>
      <select
        value={selectedDriver}
        onChange={(e) => setDriver(e.target.value)}
        className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px] w-16"
      >
        {drivers.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      {/* Compound */}
      <label className="text-[9px] text-gray-500">Tyre</label>
      <select
        value={selectedCompound}
        onChange={(e) => setCompound(e.target.value as any)}
        className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px]"
      >
        <option value="soft">Soft</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
      </select>

      {/* Speed */}
      <label className="text-[9px] text-gray-500">Speed</label>
      <div className="flex gap-0.5">
        {[{ label: '1x', value: 1 }, { label: '5x', value: 5 }, { label: '10x', value: 10 }, { label: '25x', value: 25 }].map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setSpeedMultiplier(value)}
            className={`px-1 py-0.5 rounded text-[8px] border ${
              speedMultiplier === value
                ? 'bg-f1blue text-white border-f1blue'
                : 'bg-transparent text-gray-500 border-border'
            }`}
          >
            {label}
          </button>
        ))}
        <select
          value={[30, 50, 75, 100].includes(speedMultiplier) ? speedMultiplier : ''}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v) setSpeedMultiplier(v)
          }}
          className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[9px] w-[58px]"
        >
          <option value="">More</option>
          <option value={30}>30x</option>
          <option value={50}>50x</option>
          <option value={75}>75x</option>
          <option value={100}>100x</option>
        </select>
      </div>

      {/* Pit */}
      <label className="text-[9px] text-gray-500">Pit@</label>
      <input
        type="number"
        value={pitLap}
        onChange={(e) => setPitLap(Number(e.target.value))}
        min={0}
        className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px] w-9"
      />
      <select
        value={nextCompound}
        onChange={(e) => setNextCompound(e.target.value)}
        className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px]"
      >
        <option value="hard">→H</option>
        <option value="medium">→M</option>
        <option value="soft">→S</option>
      </select>

      {/* Race controls */}
      {!isRunning ? (
        <button
          onClick={startRace}
          className="bg-f1green text-black px-2 py-0.5 rounded text-[9px] font-bold uppercase"
        >
          ▶ Start
        </button>
      ) : (
        <>
          <button
            onClick={stopRace}
            className="bg-f1red text-white px-2 py-0.5 rounded text-[9px] font-bold uppercase"
          >
            ■ Stop
          </button>
          <button
            onClick={() => {
              const c = prompt('Compound? (soft/medium/hard)', 'hard')
              if (c) pitNow(c)
            }}
            className="bg-f1yellow text-black px-2 py-0.5 rounded text-[9px] font-bold uppercase"
          >
            🔧 Pit
          </button>
        </>
      )}

      {/* Camera */}
      <div className="flex gap-0.5 ml-1">
        {(['orbit', 'visor', 'tv', 'top'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setCameraMode(m)}
            className={`px-1.5 py-0.5 rounded text-[8px] border ${
              cameraMode === m
                ? 'bg-f1red text-white border-f1red'
                : 'bg-transparent text-gray-500 border-border'
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Status */}
      <span className={`text-[9px] font-bold ${
        raceStatus === 'running' ? 'text-f1red' :
        raceStatus === 'finished' ? 'text-f1green' :
        'text-gray-500'
      }`}>
        {raceStatus.toUpperCase()}
      </span>
    </div>
  )
}
