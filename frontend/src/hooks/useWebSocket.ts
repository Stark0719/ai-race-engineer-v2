import { useEffect, useRef, useCallback } from 'react'
import { useRaceStore } from '../stores/raceStore'
import type { WSMessage } from '../types'

const MAX_RECONNECT_DELAY_MS = 16_000
const HEARTBEAT_INTERVAL_MS = 25_000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempts = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const {
    raceStatus, updateTelemetry, setRaceStatus, updateCarPositions,
    updateTimingGaps, fetchDashboard, setTrackInfo, setDriversInfo,
  } = useRaceStore()

  const clearTimers = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current)
      heartbeatTimer.current = null
    }
  }, [])

  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase = import.meta.env.VITE_WS_BASE
      ? String(import.meta.env.VITE_WS_BASE).replace(/\/$/, '')
      : `${protocol}//${window.location.host}`
    return `${wsBase}/ws/telemetry`
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(getWsUrl())
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
      reconnectAttempts.current = 0

      // Start heartbeat
      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping')
        }
      }, HEARTBEAT_INTERVAL_MS)
    }

    ws.onmessage = (ev) => {
      try {
        // Ignore pong responses
        if (ev.data === 'pong' || ev.data === 'ping') return

        const msg: WSMessage = JSON.parse(ev.data)

        if (msg.type === 'track_info') {
          setTrackInfo(msg as any)
          return
        }
        if (msg.type === 'drivers_info') {
          setDriversInfo((msg as any).drivers)
          return
        }

        if (msg.type === 'telemetry') {
          const { cars, timing, ...telemetryOnly } = msg as any
          updateTelemetry(telemetryOnly)
          if (cars) updateCarPositions(cars)
          if (timing) updateTimingGaps(timing)
          return
        }

        if (msg.type === 'race_finished') {
          setRaceStatus('finished')
          fetchDashboard()
          return
        }

        if (msg.type === 'race_stopped') {
          setRaceStatus('stopped')
          return
        }
      } catch (err) {
        console.error('WS parse error:', err)
      }
    }

    ws.onerror = () => {
      console.error('WebSocket error')
    }

    ws.onclose = () => {
      console.log('WebSocket closed')
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current)
        heartbeatTimer.current = null
      }

      // Reconnect if race is still running
      const currentStatus = useRaceStore.getState().raceStatus
      if (currentStatus === 'running') {
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttempts.current),
          MAX_RECONNECT_DELAY_MS,
        )
        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`)
        reconnectAttempts.current += 1
        reconnectTimer.current = setTimeout(connect, delay)
      }
    }
  }, [getWsUrl, updateTelemetry, setRaceStatus, updateCarPositions, updateTimingGaps, fetchDashboard, setTrackInfo, setDriversInfo])

  useEffect(() => {
    if (raceStatus !== 'running') {
      clearTimers()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      return
    }

    connect()

    return () => {
      clearTimers()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [raceStatus, connect, clearTimers])

  return wsRef
}
