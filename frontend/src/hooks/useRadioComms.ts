import { useCallback, useEffect, useRef } from 'react'
import { useRaceStore } from '../stores/raceStore'

type Priority = 'low' | 'normal' | 'urgent'

export function useRadioComms() {
  const { audioEnabled, telemetry, raceStatus } = useRaceStore()
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const prevLapRef = useRef<number>(0)
  const prevSCRef = useRef<boolean>(false)
  const pitWarningRef = useRef<boolean>(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      synthRef.current = window.speechSynthesis
    }
  }, [])

  const speak = useCallback((text: string, priority: Priority = 'normal') => {
    if (!audioEnabled || !synthRef.current) return

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = priority === 'urgent' ? 1.1 : 0.95
    utterance.pitch = 0.85 // slightly deeper for F1 engineer voice
    utterance.volume = 0.8

    // Try to pick a suitable voice
    const voices = synthRef.current.getVoices()
    const englishVoice = voices.find(
      (v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('male')
    ) || voices.find(
      (v) => v.lang.startsWith('en-GB')
    ) || voices.find(
      (v) => v.lang.startsWith('en')
    )
    if (englishVoice) utterance.voice = englishVoice

    if (priority === 'urgent') {
      synthRef.current.cancel()
    }

    synthRef.current.speak(utterance)
  }, [audioEnabled])

  // React to telemetry events
  useEffect(() => {
    if (!audioEnabled || !telemetry || raceStatus !== 'running') return

    // Lap completion
    if (telemetry.lap_number > prevLapRef.current && prevLapRef.current > 0) {
      const lapTime = telemetry.last_lap_time
      if (lapTime > 0) {
        const mins = Math.floor(lapTime / 60)
        const secs = (lapTime % 60).toFixed(1)
        speak(`Lap ${telemetry.lap_number - 1}, ${mins > 0 ? `${mins} ${secs}` : `${secs} seconds`}.`)
      }
    }
    prevLapRef.current = telemetry.lap_number

    // Safety car
    if (telemetry.safety_car && !prevSCRef.current) {
      speak('Safety car deployed.', 'urgent')
    } else if (!telemetry.safety_car && prevSCRef.current) {
      speak('Safety car in. Race restart.', 'urgent')
    }
    prevSCRef.current = telemetry.safety_car

    // Tyre wear critical
    if (telemetry.tyre_wear_pct > 0.65 && !pitWarningRef.current) {
      speak('Tyres are gone. We need to box.', 'urgent')
      pitWarningRef.current = true
    } else if (telemetry.tyre_wear_pct > 0.4 && !pitWarningRef.current) {
      speak('Box box box. Pit window is open.', 'normal')
      pitWarningRef.current = true
    }

    // Reset pit warning on new stint (fresh tyres)
    if (telemetry.tyre_wear_pct < 0.1) {
      pitWarningRef.current = false
    }
  }, [audioEnabled, telemetry, raceStatus, speak])

  // Cancel speech when race stops
  useEffect(() => {
    if (raceStatus !== 'running' && synthRef.current) {
      synthRef.current.cancel()
    }
  }, [raceStatus])

  return { speak }
}
