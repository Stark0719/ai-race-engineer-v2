import { useEffect } from 'react'
import { useRaceStore } from '../stores/raceStore'
import { useShallow } from 'zustand/react/shallow'

export function TopBar() {
  const {
    tracks, selectedTrack, selectTrack,
    drivers, selectedDriver, setDriver,
    selectedCompound, setCompound,
    speedMultiplier, setSpeedMultiplier,
    pitLap, setPitLap, nextCompound, setNextCompound,
    raceStatus, startRace, stopRace, pitNow,
    cameraMode, setCameraMode,
    mode, setMode,
    replayYear, setReplayYear, replaySchedule, loadSchedule,
    replayGP, setReplayGP,
    replaySessionType, setReplaySessionType,
    replayDrivers, replayDriver, setReplayDriver,
    sessionLoading, sessionLoaded, loadReplaySession,
    startReplay, replayStarting,
    multiCarEnabled, setMultiCarEnabled,
    audioEnabled, setAudioEnabled,
    error,
  } = useRaceStore(useShallow((s) => ({
    tracks: s.tracks, selectedTrack: s.selectedTrack, selectTrack: s.selectTrack,
    drivers: s.drivers, selectedDriver: s.selectedDriver, setDriver: s.setDriver,
    selectedCompound: s.selectedCompound, setCompound: s.setCompound,
    speedMultiplier: s.speedMultiplier, setSpeedMultiplier: s.setSpeedMultiplier,
    pitLap: s.pitLap, setPitLap: s.setPitLap, nextCompound: s.nextCompound, setNextCompound: s.setNextCompound,
    raceStatus: s.raceStatus, startRace: s.startRace, stopRace: s.stopRace, pitNow: s.pitNow,
    cameraMode: s.cameraMode, setCameraMode: s.setCameraMode,
    mode: s.mode, setMode: s.setMode,
    replayYear: s.replayYear, setReplayYear: s.setReplayYear, replaySchedule: s.replaySchedule, loadSchedule: s.loadSchedule,
    replayGP: s.replayGP, setReplayGP: s.setReplayGP,
    replaySessionType: s.replaySessionType, setReplaySessionType: s.setReplaySessionType,
    replayDrivers: s.replayDrivers, replayDriver: s.replayDriver, setReplayDriver: s.setReplayDriver,
    sessionLoading: s.sessionLoading, sessionLoaded: s.sessionLoaded, loadReplaySession: s.loadReplaySession,
    startReplay: s.startReplay, replayStarting: s.replayStarting,
    multiCarEnabled: s.multiCarEnabled, setMultiCarEnabled: s.setMultiCarEnabled,
    audioEnabled: s.audioEnabled, setAudioEnabled: s.setAudioEnabled,
    error: s.error,
  })))

  const trackKeys = Object.keys(tracks)
  const isRunning = raceStatus === 'running'
  const isReplay = mode === 'replay'

  // Auto-load schedule when switching to replay mode or changing year
  useEffect(() => {
    if (isReplay && replaySchedule.length === 0) {
      loadSchedule(replayYear)
    }
  }, [isReplay, replayYear, replaySchedule.length, loadSchedule])

  return (
    <div className="bg-panel border-b border-border shrink-0">
      <div className="h-9 flex items-center px-2 gap-2">
        {/* Logo */}
        <h1 className="text-xs font-bold whitespace-nowrap mr-1">
          <span className="text-f1red">Race Engineer</span>
        </h1>

        {/* Mode toggle */}
        <div className="flex gap-0.5">
          {(['sim', 'replay'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={isRunning}
              className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border ${
                mode === m
                  ? 'bg-f1blue text-white border-f1blue'
                  : 'bg-transparent text-gray-500 border-border'
              } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-border hidden md:block" />

        {/* ---------- SIM MODE CONTROLS (hidden on mobile) ---------- */}
        {!isReplay && (
          <div className="hidden md:contents">
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

            <label className="text-[9px] text-gray-500">Tyre</label>
            <select
              value={selectedCompound}
              onChange={(e) => setCompound(e.target.value as 'soft' | 'medium' | 'hard')}
              className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px]"
            >
              <option value="soft">Soft</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>

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
          </div>
        )}

        {/* ---------- REPLAY MODE CONTROLS (hidden on mobile) ---------- */}
        {isReplay && (
          <div className="hidden md:contents">
            <label className="text-[9px] text-gray-500">Year</label>
            <select
              value={replayYear}
              onChange={(e) => {
                const y = Number(e.target.value)
                setReplayYear(y)
                loadSchedule(y)
              }}
              disabled={isRunning}
              className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px] w-14"
            >
              {[2024, 2023, 2022, 2021, 2020, 2019, 2018].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            <label className="text-[9px] text-gray-500">GP</label>
            <select
              value={replayGP}
              onChange={(e) => setReplayGP(e.target.value)}
              disabled={isRunning || replaySchedule.length === 0}
              className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px] max-w-[150px]"
            >
              <option value="">Select GP</option>
              {replaySchedule.map((ev) => (
                <option key={ev.round} value={ev.name}>
                  R{ev.round} {ev.name}
                </option>
              ))}
            </select>

            <label className="text-[9px] text-gray-500">Sess</label>
            <select
              value={replaySessionType}
              onChange={(e) => setReplaySessionType(e.target.value)}
              disabled={isRunning}
              className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px] w-12"
            >
              <option value="R">Race</option>
              <option value="Q">Qual</option>
              <option value="FP1">FP1</option>
              <option value="FP2">FP2</option>
              <option value="FP3">FP3</option>
            </select>

            <button
              onClick={loadReplaySession}
              disabled={isRunning || !replayGP || sessionLoading}
              className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
                sessionLoading
                  ? 'bg-gray-600 text-gray-300 border-gray-600 animate-pulse'
                  : 'bg-f1blue text-white border-f1blue hover:brightness-110'
              } ${(isRunning || !replayGP) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {sessionLoading ? 'Loading...' : 'Load'}
            </button>

            {sessionLoaded && (
              <>
                <label className="text-[9px] text-gray-500">Driver</label>
                <select
                  value={replayDriver}
                  onChange={(e) => setReplayDriver(e.target.value)}
                  disabled={isRunning}
                  className="bg-bg text-gray-200 border border-border rounded px-1 py-0.5 text-[10px] w-20"
                >
                  {replayDrivers.map((d) => (
                    <option key={d.abbreviation} value={d.abbreviation}>
                      {d.abbreviation} — {d.team.slice(0, 12)}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => setMultiCarEnabled(!multiCarEnabled)}
                  disabled={isRunning}
                  className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border ${
                    multiCarEnabled
                      ? 'bg-f1cyan text-black border-f1cyan'
                      : 'bg-transparent text-gray-500 border-border'
                  } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Multi
                </button>
              </>
            )}
          </div>
        )}

        <div className="w-px h-5 bg-border hidden md:block" />

        {/* Speed (hidden on mobile) */}
        <label className="text-[9px] text-gray-500 hidden md:block">Speed</label>
        <div className="hidden md:flex gap-0.5">
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

        {/* Race / Replay controls */}
        {!isReplay ? (
          // SIM mode start/stop
          !isRunning ? (
            <button
              onClick={startRace}
              className="bg-f1green text-black px-2 py-0.5 rounded text-[9px] font-bold uppercase"
            >
              Start
            </button>
          ) : (
            <>
              <button
                onClick={stopRace}
                className="bg-f1red text-white px-2 py-0.5 rounded text-[9px] font-bold uppercase"
              >
                Stop
              </button>
              <button
                onClick={() => {
                  const c = prompt('Compound? (soft/medium/hard)', 'hard')
                  if (c) pitNow(c)
                }}
                className="bg-f1yellow text-black px-2 py-0.5 rounded text-[9px] font-bold uppercase"
              >
                Pit
              </button>
            </>
          )
        ) : (
          // REPLAY mode start/stop
          !isRunning ? (
            <button
              onClick={startReplay}
              disabled={!sessionLoaded || !replayDriver || replayStarting}
              className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                replayStarting
                  ? 'bg-gray-600 text-gray-300 animate-pulse'
                  : 'bg-f1green text-black'
              } ${(!sessionLoaded || !replayDriver || replayStarting) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {replayStarting ? 'Preparing...' : 'Replay'}
            </button>
          ) : (
            <button
              onClick={stopRace}
              className="bg-f1red text-white px-2 py-0.5 rounded text-[9px] font-bold uppercase"
            >
              Stop
            </button>
          )
        )}

        {/* Camera (hidden on mobile) */}
        <div className="hidden md:flex gap-0.5 ml-1">
          {([
            { key: 'onboard', label: 'Onboard' },
            { key: 'tcam', label: 'T-Cam' },
            { key: 'chase', label: 'Chase' },
            { key: 'tv', label: 'TV' },
            { key: 'rear', label: 'Rear' },
            { key: 'orbit', label: 'Orbit' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setCameraMode(key)}
              className={`px-1.5 py-0.5 rounded text-[8px] border ${
                cameraMode === key
                  ? 'bg-f1red text-white border-f1red'
                  : 'bg-transparent text-gray-500 border-border'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Audio toggle */}
        <button
          onClick={() => setAudioEnabled(!audioEnabled)}
          className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${
            audioEnabled
              ? 'bg-f1green text-black border-f1green'
              : 'bg-transparent text-gray-500 border-border'
          }`}
          title={audioEnabled ? 'Mute radio' : 'Enable radio comms'}
        >
          {audioEnabled ? 'RADIO ON' : 'RADIO'}
        </button>

        <div className="flex-1" />

        {/* Error indicator */}
        {error && (
          <span className="text-[8px] text-f1red truncate max-w-[200px]" title={error}>
            {error}
          </span>
        )}

        {/* Status */}
        <span className={`text-[9px] font-bold ${
          raceStatus === 'running' ? 'text-f1red' :
          raceStatus === 'finished' ? 'text-f1green' :
          'text-gray-500'
        }`}>
          {isReplay && raceStatus === 'running' ? 'REPLAY' : raceStatus.toUpperCase()}
        </span>
      </div>
    </div>
  )
}
