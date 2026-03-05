import { create } from 'zustand'
import type {
  TrackData, TelemetryFrame, StrategyResult, LapTime, RaceDecisionPayload,
  RaceStatus, CameraMode, AppMode, F1Event, F1DriverInfo, CarPosition,
  TimingGap, UndercutOpportunity, SavedSessionSummary, PostRaceAnalytics,
} from '../types'

const API = '' // Vite proxy handles /api -> localhost:8000

interface RaceStore {
  // Track data
  tracks: Record<string, TrackData>
  selectedTrack: string | null
  currentTrack: TrackData | null

  // Race state
  raceStatus: RaceStatus
  totalLaps: number
  speedMultiplier: number
  selectedCompound: 'soft' | 'medium' | 'hard'
  pitLap: number
  nextCompound: string
  selectedDriver: string
  drivers: string[]

  // Telemetry
  telemetry: TelemetryFrame | null
  speedHistory: number[]
  tempHistory: number[]
  throttleBrakeHistory: number[]
  lapTimes: LapTime[]
  bestLapTime: number | null
  sectorBest: { s1: number | null; s2: number | null; s3: number | null }
  lastLapSectors: { s1: number | null; s2: number | null; s3: number | null }
  lastLapSectorColors: { s1: 'purple' | 'yellow' | 'none'; s2: 'purple' | 'yellow' | 'none'; s3: 'purple' | 'yellow' | 'none' }

  // 3D
  cameraMode: CameraMode

  // Strategy
  strategyResult: StrategyResult | null
  strategyLoading: boolean
  raceDecision: RaceDecisionPayload | null
  raceDecisionLoading: boolean

  // Chat
  chatMessages: { role: 'user' | 'assistant'; text: string }[]
  chatLoading: boolean

  // Errors
  error: string | null

  // Replay
  mode: AppMode
  replayYear: number
  replaySchedule: F1Event[]
  replayGP: string
  replaySessionType: string
  replayDrivers: F1DriverInfo[]
  replayDriver: string
  sessionLoading: boolean
  sessionLoaded: boolean

  // Multi-car
  multiCarEnabled: boolean
  carPositions: Record<string, CarPosition> | null
  replayStarting: boolean
  focusedDriver: string | null  // null = follow main replay driver

  // Timing gaps
  timingGaps: TimingGap[]

  // Undercut/overcut
  undercutAlerts: UndercutOpportunity[]

  // Audio
  audioEnabled: boolean

  // Dashboard
  showDashboard: boolean
  dashboardData: PostRaceAnalytics | null

  // Session persistence
  savedSessions: SavedSessionSummary[]

  // WS-driven updates
  setTrackInfo: (info: { name: string; country: string; total_laps: number; waypoints_xy: [number, number][]; track_width: number }) => void
  setDriversInfo: (drivers: F1DriverInfo[]) => void

  // Actions
  loadTracks: () => Promise<void>
  loadDrivers: () => Promise<void>
  selectTrack: (key: string) => void
  setCompound: (c: 'soft' | 'medium' | 'hard') => void
  setSpeedMultiplier: (s: number) => Promise<void>
  setPitLap: (l: number) => void
  setNextCompound: (c: string) => void
  setDriver: (d: string) => void
  setCameraMode: (m: CameraMode) => void

  startRace: () => Promise<void>
  stopRace: () => Promise<void>
  pitNow: (compound: string) => Promise<void>

  updateTelemetry: (frame: TelemetryFrame) => void
  setRaceStatus: (s: RaceStatus) => void

  runStrategy: (pitLoss: number, scProb: number, iterations: number) => Promise<void>
  fetchRaceDecision: () => Promise<void>
  sendChat: (message: string) => Promise<void>

  // Replay actions
  setMode: (m: AppMode) => void
  setReplayYear: (y: number) => void
  setReplayGP: (gp: string) => void
  setReplaySessionType: (s: string) => void
  loadSchedule: (year: number) => Promise<void>
  loadReplaySession: () => Promise<void>
  setReplayDriver: (d: string) => void
  startReplay: () => Promise<void>

  // Multi-car actions
  setMultiCarEnabled: (v: boolean) => void
  updateCarPositions: (positions: Record<string, CarPosition>) => void
  setFocusedDriver: (d: string | null) => void

  // Timing
  updateTimingGaps: (gaps: TimingGap[]) => void

  // Undercut
  updateUndercutAlerts: (alerts: UndercutOpportunity[]) => void

  // Audio
  setAudioEnabled: (v: boolean) => void

  // Dashboard
  setShowDashboard: (v: boolean) => void
  fetchDashboard: () => Promise<void>

  // Session persistence
  loadSavedSessions: () => Promise<void>
  saveCurrentSession: () => Promise<void>
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  // Initial state
  tracks: {},
  selectedTrack: null,
  currentTrack: null,
  raceStatus: 'idle',
  totalLaps: 57,
  speedMultiplier: 1,
  selectedCompound: 'medium',
  pitLap: 0,
  nextCompound: 'hard',
  selectedDriver: 'VER',
  drivers: [],
  telemetry: null,
  speedHistory: [],
  tempHistory: [],
  throttleBrakeHistory: [],
  lapTimes: [],
  bestLapTime: null,
  sectorBest: { s1: null, s2: null, s3: null },
  lastLapSectors: { s1: null, s2: null, s3: null },
  lastLapSectorColors: { s1: 'none', s2: 'none', s3: 'none' },
  cameraMode: 'chase',
  strategyResult: null,
  strategyLoading: false,
  raceDecision: null,
  raceDecisionLoading: false,
  chatMessages: [],
  chatLoading: false,
  error: null,

  // Replay initial state
  mode: 'sim',
  replayYear: 2024,
  replaySchedule: [],
  replayGP: '',
  replaySessionType: 'R',
  replayDrivers: [],
  replayDriver: '',
  sessionLoading: false,
  sessionLoaded: false,

  // Multi-car initial state
  multiCarEnabled: true,
  carPositions: null,
  replayStarting: false,
  focusedDriver: null,

  // Timing gaps
  timingGaps: [],

  // Undercut/overcut
  undercutAlerts: [],

  // Audio
  audioEnabled: false,

  // Dashboard
  showDashboard: false,
  dashboardData: null,

  // Session persistence
  savedSessions: [],

  // WS-driven updates
  setTrackInfo: (info) => {
    set({ totalLaps: info.total_laps })
  },

  setDriversInfo: (drivers) => {
    set({ replayDrivers: drivers })
  },

  // Load available tracks from API
  loadTracks: async () => {
    try {
      const res = await fetch('/api/tracks')
      const data = await res.json()
      const tracks = data.tracks as Record<string, TrackData>
      set({ tracks })
      // Auto-select first track
      const keys = Object.keys(tracks)
      if (keys.length > 0) {
        const key = keys[0]
        set({ selectedTrack: key, currentTrack: tracks[key], totalLaps: tracks[key].total_laps })
      }
    } catch (err) {
      set({ error: `Failed to load tracks: ${err}` })
    }
  },

  loadDrivers: async () => {
    try {
      const res = await fetch('/api/drivers')
      const data = await res.json()
      set({ drivers: data.drivers, selectedDriver: data.drivers[0] || 'VER' })
    } catch (err) {
      console.error('Failed to load drivers:', err)
    }
  },

  selectTrack: (key) => {
    const tracks = get().tracks
    if (tracks[key]) {
      set({ selectedTrack: key, currentTrack: tracks[key], totalLaps: tracks[key].total_laps })
    }
  },

  setCompound: (c) => set({ selectedCompound: c }),
  setSpeedMultiplier: async (s) => {
    const next = Math.max(1, Math.min(100, Math.round(s)))
    set({ speedMultiplier: next })
    if (get().raceStatus !== 'running') return
    try {
      const res = await fetch(`/api/race/speed?speed=${next}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.text()
        set({ error: `Failed to update speed (${res.status}): ${body || 'unknown error'}` })
        return
      }
      const data = await res.json()
      if (typeof data?.speed === 'number') {
        set({ speedMultiplier: Math.max(1, Math.min(100, Math.round(data.speed))) })
      }
    } catch (err) {
      set({ error: `Failed to update speed: ${err}` })
    }
  },
  setPitLap: (l) => set({ pitLap: l }),
  setNextCompound: (c) => set({ nextCompound: c }),
  setDriver: (d) => set({ selectedDriver: d }),
  setCameraMode: (m) => set({ cameraMode: m }),

  startRace: async () => {
    const { selectedTrack, selectedCompound, speedMultiplier, pitLap, nextCompound, selectedDriver } = get()
    if (!selectedTrack) return

    try {
      const params = new URLSearchParams({
        track: selectedTrack,
        compound: selectedCompound,
        speed: String(speedMultiplier),
        pit_lap: String(pitLap),
        next_compound: nextCompound,
        driver: selectedDriver,
      })
      const res = await fetch(`/api/race/start?${params}`, { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        set({ error: data.error })
        return
      }
      set({
        raceStatus: 'running',
        totalLaps: data.laps,
        speedHistory: [],
        tempHistory: [],
        throttleBrakeHistory: [],
        lapTimes: [],
        bestLapTime: null,
        sectorBest: { s1: null, s2: null, s3: null },
        lastLapSectors: { s1: null, s2: null, s3: null },
        lastLapSectorColors: { s1: 'none', s2: 'none', s3: 'none' },
        telemetry: null,
        error: null,
      })
    } catch (err) {
      set({ error: `Failed to start race: ${err}` })
    }
  },

  stopRace: async () => {
    set({ raceStatus: 'stopped', carPositions: null, focusedDriver: null })
    try {
      await fetch('/api/race/stop', { method: 'POST' })
    } catch (err) {
      set({ error: `Failed to stop: ${err}` })
    }
  },

  pitNow: async (compound) => {
    try {
      await fetch(`/api/race/pit?compound=${compound}`, { method: 'POST' })
    } catch (err) {
      console.error('Pit failed:', err)
    }
  },

  updateTelemetry: (frame) => {
    const {
      speedHistory, tempHistory, throttleBrakeHistory, lapTimes, telemetry,
      bestLapTime, sectorBest,
    } = get()

    // Ring buffer push: mutate in place then replace reference
    // Much faster than [...arr, val].slice(-200)
    const HISTORY_CAP = 200
    const pushHistory = (arr: number[], val: number): number[] => {
      if (arr.length >= HISTORY_CAP) {
        arr.shift()
      }
      arr.push(val)
      return arr
    }
    pushHistory(speedHistory, frame.speed_kph)
    pushHistory(tempHistory, frame.tyre_temp_c)
    pushHistory(throttleBrakeHistory, frame.throttle * 100 - frame.brake * 100)

    // Detect lap completion
    let newLaps = lapTimes
    let nextBestLap = bestLapTime
    let nextSectorBest = sectorBest
    let nextLastLapSectors = get().lastLapSectors
    let nextLastLapColors = get().lastLapSectorColors
    if (telemetry && frame.lap_number > telemetry.lap_number && frame.last_lap_time > 0) {
      newLaps = [...lapTimes, {
        lap: telemetry.lap_number,
        time: frame.last_lap_time,
        compound: frame.tyre_compound,
      }]

      const s1 = frame.sector_1_time > 0 ? frame.sector_1_time : null
      const s2 = frame.sector_2_time > 0 ? frame.sector_2_time : null
      const s3 = frame.sector_3_time > 0 ? frame.sector_3_time : null
      nextLastLapSectors = { s1, s2, s3 }
      nextSectorBest = { ...sectorBest }
      const colors: { s1: 'purple' | 'yellow' | 'none'; s2: 'purple' | 'yellow' | 'none'; s3: 'purple' | 'yellow' | 'none' } = {
        s1: 'none', s2: 'none', s3: 'none',
      }
      ;(['s1', 's2', 's3'] as const).forEach((k) => {
        const cur = k === 's1' ? s1 : k === 's2' ? s2 : s3
        const best = nextSectorBest[k]
        if (cur == null) return
        if (best == null || cur <= best) {
          nextSectorBest[k] = cur
          colors[k] = 'purple'
        } else {
          colors[k] = 'yellow'
        }
      })
      nextLastLapColors = colors
      if (nextBestLap == null || frame.last_lap_time < nextBestLap) nextBestLap = frame.last_lap_time
    }

    set({
      telemetry: frame,
      speedHistory: [...speedHistory],   // new ref so subscribers see change
      tempHistory: [...tempHistory],
      throttleBrakeHistory: [...throttleBrakeHistory],
      lapTimes: newLaps,
      bestLapTime: nextBestLap,
      sectorBest: nextSectorBest,
      lastLapSectors: nextLastLapSectors,
      lastLapSectorColors: nextLastLapColors,
    })
  },

  setRaceStatus: (s) => set({ raceStatus: s }),

  runStrategy: async (pitLoss, scProb, iterations) => {
    set({ strategyLoading: true })
    try {
      const params = new URLSearchParams({
        driver_code: get().selectedDriver,
        pit_loss: String(pitLoss),
        safety_car_prob: String(scProb),
        iterations: String(iterations),
      })
      const res = await fetch(`/api/recommend?${params}`, { method: 'POST' })
      const data = await res.json()
      set({ strategyResult: data, strategyLoading: false })
    } catch (err) {
      set({ strategyLoading: false, error: `Strategy failed: ${err}` })
    }
  },

  fetchRaceDecision: async () => {
    const { selectedDriver, selectedTrack, currentTrack } = get()
    if (!selectedTrack || !currentTrack) return
    set({ raceDecisionLoading: true })
    try {
      const params = new URLSearchParams({
        driver_code: selectedDriver,
        track: selectedTrack,
        pit_loss: String(currentTrack.pit_loss),
        safety_car_prob: String(currentTrack.safety_car_prob),
        strategy_iterations: '500',
        line_horizon_laps: '6',
        line_iterations: '400',
        rolling_window_laps: '10',
        rolling_horizon_laps: '4',
        rolling_iterations: '250',
      })
      const res = await fetch(`/api/decision/race?${params}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        set({ raceDecisionLoading: false, error: data.detail || 'Race decision failed' })
        return
      }
      set({ raceDecision: data, raceDecisionLoading: false })
    } catch (err) {
      set({ raceDecisionLoading: false, error: `Race decision failed: ${err}` })
    }
  },

  sendChat: async (message) => {
    const { chatMessages, selectedDriver } = get()
    set({
      chatMessages: [...chatMessages, { role: 'user', text: message }],
      chatLoading: true,
    })
    try {
      const params = new URLSearchParams({ driver_code: selectedDriver, message })
      const res = await fetch(`/api/chat?${params}`, { method: 'POST' })
      const data = await res.json()
      set((s) => ({
        chatMessages: [...s.chatMessages, { role: 'assistant', text: data.response }],
        chatLoading: false,
      }))
    } catch (err) {
      set((s) => ({
        chatMessages: [...s.chatMessages, { role: 'assistant', text: `Error: ${err}` }],
        chatLoading: false,
      }))
    }
  },

  // ---- Replay actions ----

  setMode: (m) => {
    const { raceStatus } = get()
    if (raceStatus === 'running') return // can't switch while running
    set({ mode: m, sessionLoaded: false, replayDrivers: [], replayDriver: '' })
  },

  setReplayYear: (y) => set({ replayYear: y, replaySchedule: [], replayGP: '', sessionLoaded: false, replayDrivers: [] }),

  setReplayGP: (gp) => set({ replayGP: gp, sessionLoaded: false, replayDrivers: [], replayDriver: '' }),

  setReplaySessionType: (s) => set({ replaySessionType: s, sessionLoaded: false, replayDrivers: [], replayDriver: '' }),

  loadSchedule: async (year) => {
    try {
      const res = await fetch(`/api/sessions/schedule?year=${year}`)
      const data = await res.json()
      set({ replaySchedule: data.events || [], replayYear: year, replayGP: '' })
    } catch (err) {
      set({ error: `Failed to load schedule: ${err}` })
    }
  },

  loadReplaySession: async () => {
    const { replayYear, replayGP, replaySessionType } = get()
    if (!replayGP) return
    set({ sessionLoading: true, error: null })
    try {
      const params = new URLSearchParams({
        year: String(replayYear),
        gp: replayGP,
        session_type: replaySessionType,
      })
      const res = await fetch(`/api/sessions/load?${params}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }))
        set({ sessionLoading: false, error: body.detail || 'Session load failed' })
        return
      }
      const data = await res.json()
      const drivers: F1DriverInfo[] = data.drivers || []
      // If a matching track exists, select it
      if (data.track_key) {
        const tracks = get().tracks
        if (tracks[data.track_key]) {
          get().selectTrack(data.track_key)
        }
      }
      set({
        replayDrivers: drivers,
        replayDriver: drivers[0]?.abbreviation || '',
        sessionLoaded: true,
        sessionLoading: false,
        totalLaps: data.total_laps || 0,
      })
    } catch (err) {
      set({ sessionLoading: false, error: `Session load failed: ${err}` })
    }
  },

  setReplayDriver: (d) => set({ replayDriver: d }),

  // Multi-car actions
  setMultiCarEnabled: (v) => set({ multiCarEnabled: v }),
  updateCarPositions: (positions) => set({ carPositions: positions }),
  setFocusedDriver: (d) => set({ focusedDriver: d }),

  // Timing
  updateTimingGaps: (gaps) => set({ timingGaps: gaps }),

  // Undercut
  updateUndercutAlerts: (alerts) => set({ undercutAlerts: alerts }),

  // Audio
  setAudioEnabled: (v) => set({ audioEnabled: v }),

  // Dashboard
  setShowDashboard: (v) => set({ showDashboard: v }),
  fetchDashboard: async () => {
    try {
      const res = await fetch('/api/analytics/post-race')
      if (!res.ok) return
      const data = await res.json()
      set({ dashboardData: data, showDashboard: true })
    } catch (err) {
      console.error('Failed to fetch dashboard:', err)
    }
  },

  // Session persistence
  loadSavedSessions: async () => {
    try {
      const res = await fetch('/api/sessions/saved')
      const data = await res.json()
      set({ savedSessions: data.sessions || [] })
    } catch (err) {
      console.error('Failed to load sessions:', err)
    }
  },

  saveCurrentSession: async () => {
    try {
      await fetch('/api/sessions/save', { method: 'POST' })
    } catch (err) {
      console.error('Failed to save session:', err)
    }
  },

  startReplay: async () => {
    const { replayYear, replayGP, replaySessionType, replayDriver, speedMultiplier, multiCarEnabled } = get()
    if (!replayGP || !replayDriver) return
    set({ error: null, carPositions: null, replayStarting: true })
    try {
      const params = new URLSearchParams({
        year: String(replayYear),
        gp: replayGP,
        session_type: replaySessionType,
        driver: replayDriver,
        speed: String(speedMultiplier),
        multi_car: String(multiCarEnabled),
      })
      const res = await fetch(`/api/race/start-replay?${params}`, { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        set({ error: data.error, replayStarting: false })
        return
      }
      set({
        raceStatus: 'running',
        replayStarting: false,
        totalLaps: data.total_laps || get().totalLaps,
        speedHistory: [],
        tempHistory: [],
        throttleBrakeHistory: [],
        lapTimes: [],
        bestLapTime: null,
        sectorBest: { s1: null, s2: null, s3: null },
        lastLapSectors: { s1: null, s2: null, s3: null },
        lastLapSectorColors: { s1: 'none', s2: 'none', s3: 'none' },
        telemetry: null,
        error: null,
      })
    } catch (err) {
      set({ error: `Failed to start replay: ${err}`, replayStarting: false })
    }
  },
}))
