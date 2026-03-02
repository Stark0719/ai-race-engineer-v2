import { useEffect, useRef } from 'react'
import { useRaceStore } from '../stores/raceStore'
import type { WSMessage } from '../types'

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const {
    raceStatus, updateTelemetry, setRaceStatus,
  } = useRaceStore()

  useEffect(() => {
    if (raceStatus !== 'running') return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase = import.meta.env.VITE_WS_BASE
      ? String(import.meta.env.VITE_WS_BASE).replace(/\/$/, '')
      : `${protocol}//${window.location.host}`
    const ws = new WebSocket(`${wsBase}/ws/telemetry`)
    wsRef.current = ws

    ws.onmessage = (ev) => {
      try {
        const msg: WSMessage = JSON.parse(ev.data)

        if (msg.type === 'track_info') {
          // Track info received — could update store if needed
          return
        }

        if (msg.type === 'telemetry') {
          updateTelemetry(msg)
          return
        }

        if (msg.type === 'race_finished') {
          setRaceStatus('finished')
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
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [raceStatus, updateTelemetry, setRaceStatus])

  return wsRef
}
