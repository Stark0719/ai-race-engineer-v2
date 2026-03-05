import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useRaceStore } from '../../stores/raceStore'
import { carState } from './carState'
import { ghostFocusState } from '../GhostCars'

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return a + d * t
}

export function CameraController() {
  const { camera } = useThree()
  const controlsRef = useRef<any>(null)
  const cameraMode = useRaceStore((s) => s.cameraMode)

  // Smooth state for each camera mode
  const smoothHeading = useRef(0)
  const smoothPos = useRef(new THREE.Vector3())
  const inited = useRef(false)

  useFrame(() => {
    const focusedDriver = useRaceStore.getState().focusedDriver
    const useGhost = focusedDriver && ghostFocusState.active
    const trackPos = useGhost ? ghostFocusState.pos : carState.pos
    const trackHeading = useGhost ? ghostFocusState.heading : carState.heading
    const isActive = useGhost ? ghostFocusState.active : carState.active

    if (!isActive) return
    const mode = useRaceStore.getState().cameraMode

    const carX = trackPos.x
    const carY = trackPos.y || 0.5
    const carZ = trackPos.z

    if (!inited.current) {
      smoothHeading.current = trackHeading
      smoothPos.current.set(carX, carY, carZ)
      inited.current = true
    }

    if (mode === 'orbit') {
      // Free camera — OrbitControls handles everything
      if (controlsRef.current) {
        const target = controlsRef.current.target as THREE.Vector3
        target.lerp(new THREE.Vector3(carX, carY + 1, carZ), 0.15)
        controlsRef.current.update()
      }
      return
    }

    if (mode === 'onboard') {
      // Cockpit cam — driver POV, tight heading tracking
      smoothHeading.current = lerpAngle(smoothHeading.current, trackHeading, 0.08)
      const h = smoothHeading.current
      const fwdX = Math.cos(h)
      const fwdZ = Math.sin(h)
      // Camera at driver head position: centered, 0.4m above car surface
      camera.position.set(carX, carY + 0.4, carZ)
      camera.lookAt(carX + fwdX * 60, carY + 0.5, carZ + fwdZ * 60)
    } else if (mode === 'tcam') {
      // T-Camera — mounted on top of airbox, looking forward
      smoothHeading.current = lerpAngle(smoothHeading.current, trackHeading, 0.06)
      const h = smoothHeading.current
      const fwdX = Math.cos(h)
      const fwdZ = Math.sin(h)
      // 2.0m above car, 0.5m behind driver along car axis
      camera.position.set(
        carX - fwdX * 0.5,
        carY + 2.0,
        carZ - fwdZ * 0.5,
      )
      // Look ahead and slightly down
      camera.lookAt(carX + fwdX * 40, carY + 0.3, carZ + fwdZ * 40)
    } else if (mode === 'chase') {
      // Tracking shot — cinematic behind-car chase cam
      smoothHeading.current = lerpAngle(smoothHeading.current, trackHeading, 0.12)
      const h = smoothHeading.current
      const fwdX = Math.cos(h)
      const fwdZ = Math.sin(h)
      // 8m behind, 3.5m above
      const camX = carX - fwdX * 8
      const camZ = carZ - fwdZ * 8
      smoothPos.current.lerp(new THREE.Vector3(camX, carY + 3.5, camZ), 0.08)
      camera.position.copy(smoothPos.current)
      // Look slightly ahead of car
      camera.lookAt(carX + fwdX * 5, carY + 0.5, carZ + fwdZ * 5)
    } else if (mode === 'tv') {
      // Helicopter broadcast cam — elevated side view, slow pan
      smoothPos.current.lerp(new THREE.Vector3(carX + 50, 25, carZ + 50), 0.05)
      camera.position.copy(smoothPos.current)
      // Look at car with slight lead
      const h = trackHeading
      camera.lookAt(carX + Math.cos(h) * 8, carY, carZ + Math.sin(h) * 8)
    } else if (mode === 'rear') {
      // Rear-facing onboard — looking backwards from rear wing
      smoothHeading.current = lerpAngle(smoothHeading.current, trackHeading, 0.08)
      const h = smoothHeading.current
      const fwdX = Math.cos(h)
      const fwdZ = Math.sin(h)
      // On rear wing, slightly above
      camera.position.set(
        carX - fwdX * 1.5,
        carY + 1.2,
        carZ - fwdZ * 1.5,
      )
      // Look backwards
      camera.lookAt(carX - fwdX * 60, carY + 0.8, carZ - fwdZ * 60)
    }
  })

  if (cameraMode === 'orbit') {
    return (
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.1}
        minDistance={10}
        maxDistance={500}
        maxPolarAngle={Math.PI / 2.1}
      />
    )
  }
  return null
}
