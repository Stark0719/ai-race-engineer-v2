import { create } from 'zustand'
import type {
  TrackData, TelemetryFrame, StrategyResult, LapTime, RaceDecisionPayload,
  RaceStatus, CameraMode,
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
  cameraMode: 'orbit',
  strategyResult: null,
  strategyLoading: false,
  raceDecision: null,
  raceDecisionLoading: false,
  chatMessages: [],
  chatLoading: false,
  error: null,

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
    set({ raceStatus: 'stopped' })
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
    const newSpeed = [...speedHistory, frame.speed_kph].slice(-200)
    const newTemp = [...tempHistory, frame.tyre_temp_c].slice(-200)
    const newTB = [...throttleBrakeHistory, frame.throttle * 100 - frame.brake * 100].slice(-200)

    // Detect lap completion
    const newLaps = [...lapTimes]
    let nextBestLap = bestLapTime
    const nextSectorBest = { ...sectorBest }
    let nextLastLapSectors = get().lastLapSectors
    let nextLastLapColors = get().lastLapSectorColors
    if (telemetry && frame.lap_number > telemetry.lap_number && frame.last_lap_time > 0) {
      newLaps.push({
        lap: telemetry.lap_number,
        time: frame.last_lap_time,
        compound: frame.tyre_compound,
      })

      const s1 = frame.sector_1_time > 0 ? frame.sector_1_time : null
      const s2 = frame.sector_2_time > 0 ? frame.sector_2_time : null
      const s3 = frame.sector_3_time > 0 ? frame.sector_3_time : null
      nextLastLapSectors = { s1, s2, s3 }
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
      speedHistory: newSpeed,
      tempHistory: newTemp,
      throttleBrakeHistory: newTB,
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
}))
