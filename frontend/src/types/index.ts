// Track data from FastF1 GPS extraction
export interface TrackData {
  key: string
  name: string
  country: string
  total_laps: number
  pit_loss: number
  base_lap_time: number
  safety_car_prob: number
  circuit_length_m: number
  sector_boundaries: number[]
  waypoints_xy: [number, number][]
  waypoints: [number, number, number, number][] // x, y, speed, heading
  corners: Corner[]
  bounds: { x_min: number; x_max: number; y_min: number; y_max: number }
  speeds: number[]
  headings: number[]
  track_width: number
}

export interface Corner {
  index: number
  fraction: number
  x: number
  y: number
  min_speed: number
}

// Live telemetry frame from WebSocket
export interface TelemetryFrame {
  type: 'telemetry'
  timestamp: number
  lap_number: number
  lap_fraction: number
  sector: number
  speed_kph: number
  throttle: number
  brake: number
  gear: number
  rpm: number
  drs: boolean
  fuel_remaining_kg: number
  tyre_compound: 'soft' | 'medium' | 'hard'
  tyre_age_laps: number
  tyre_temp_c: number
  tyre_wear_pct: number
  current_lap_time: number
  last_lap_time: number
  sector_1_time: number
  sector_2_time: number
  sector_3_time: number
  x: number
  y: number
  heading: number
  gap_to_leader: number
  safety_car: boolean
  in_pit: boolean
  total_race_time: number
  position: number
}

// Strategy simulation result
export interface StrategyResult {
  recommended: '1-stop' | '2-stop'
  confidence: number
  one_stop_win_rate: number
  two_stop_win_rate: number
  pit_loss: number
  safety_car_probability: number
  mean_delta_seconds: number
  std_delta_seconds: number
}

export interface RaceDecisionSummary {
  current_lap: number
  pit_window_lap_range: [number, number]
  in_pit_window_now: boolean
  pit_now: boolean
  reasoning: {
    strategy_choice: string
    strategy_confidence?: number
    line_choice: string
    line_delta_to_second_best: number
    wear_pct: number
    safety_car: boolean
  }
}

export interface RacingLineResult {
  line: string
  label: string
  mean_horizon_time: number
  std_horizon_time: number
  p10_horizon_time: number
  p90_horizon_time: number
  incident_rate: number
  mean_incidents: number
  delta_to_best: number
}

export interface RaceDecisionPayload {
  decision: RaceDecisionSummary
  strategy: StrategyResult & {
    track?: string
    track_total_laps?: number
    base_lap_time_estimate?: number
    pit_windows?: {
      one_stop: { p10: number; p50: number; p90: number }
      two_stop: { pit1_p50: number; pit2_p50: number }
    }
  }
  racing_lines_now: {
    recommended_line: string
    recommended_label: string
    lines: RacingLineResult[]
  }
  racing_lines_rolling: {
    rollout: Array<{
      lap: number
      recommended_line: string
      recommended_label: string
      best_mean_horizon_time: number
      second_best_delta: number
      projected_wear_pct: number
      projected_temp_c: number
    }>
  }
  context: {
    driver_code: string
    track: string
    race_running: boolean
    telemetry_used: boolean
  }
}

// Lap time record
export interface LapTime {
  lap: number
  time: number
  compound: string
}

// WebSocket message types
export type WSMessage =
  | { type: 'track_info'; name: string; country: string; total_laps: number; waypoints_xy: [number, number][]; track_width: number }
  | TelemetryFrame
  | { type: 'race_finished'; total_laps: number; total_time: number; pit_history: any[] }
  | { type: 'race_stopped' }

// Race state
export type RaceStatus = 'idle' | 'running' | 'finished' | 'stopped' | 'error'

// Camera mode
export type CameraMode = 'orbit' | 'visor' | 'tv' | 'top'
