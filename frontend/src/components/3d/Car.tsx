import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useRaceStore } from '../../stores/raceStore'
import { carState } from './carState'
import { buildRacingLine, clamp, wrap01, wrapPi } from './buildRacingLine'

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return a + d * t
}

export function CarContactShadow() {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!groupRef.current || !carState.active) return
    groupRef.current.position.set(carState.pos.x, 0.01, carState.pos.z)
  })

  return (
    <group ref={groupRef}>
      <ContactShadows
        opacity={0.6}
        scale={20}
        blur={2.5}
        far={4}
        resolution={256}
        color="#000000"
      />
    </group>
  )
}

interface FrameTarget {
  x: number
  z: number
  heading: number
  speed: number
  timestamp: number
}

export function Car() {
  const rootRef = useRef<THREE.Group>(null)
  const chassisRef = useRef<THREE.Group>(null)
  const flSteerRef = useRef<THREE.Group>(null)
  const frSteerRef = useRef<THREE.Group>(null)
  const wheelMeshes = useRef<Array<THREE.Mesh | null>>([])
  const [carModel, setCarModel] = useState<THREE.Object3D | null>(null)
  const modelWheels = useRef<{ front: THREE.Object3D[]; all: THREE.Object3D[] }>({ front: [], all: [] })

  const target = useRef<FrameTarget | null>(null)
  const prevTarget = useRef<FrameTarget | null>(null)
  const frameArrival = useRef(0)
  const frameInterval = useRef(100) // ms between WS frames
  const vis = useRef({ x: 0, z: 0, heading: 0, steer: 0, wheelSpin: 0, prevHeading: 0, init: false })

  const currentTrack = useRaceStore((s) => s.currentTrack)
  const raceDecision = useRaceStore((s) => s.raceDecision)
  const lineMode = (raceDecision?.racing_lines_now?.recommended_line || 'balanced') as
    'conservative' | 'balanced' | 'late_apex' | 'early_apex' | 'aggressive'
  const appMode = useRaceStore((s) => s.mode)

  // Racing line fallback for sim mode (no real x/y from backend)
  const cachedLine = useMemo(() => {
    if (!currentTrack?.waypoints_xy || currentTrack.waypoints_xy.length < 3) return null
    return buildRacingLine(
      currentTrack.waypoints_xy,
      currentTrack.track_width || 12,
      currentTrack.corners,
      lineMode
    )
  }, [currentTrack, lineMode])

  useEffect(() => {
    const modelUrl = String(import.meta.env.VITE_CAR_GLB_URL || '').trim() || '/models/f1_car.glb'
    let cancelled = false
    const loader = new GLTFLoader()
    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) return
        const scene = gltf.scene.clone(true)
        const front: THREE.Object3D[] = []
        const all: THREE.Object3D[] = []
        scene.traverse((obj) => {
          obj.castShadow = true
          obj.receiveShadow = true
          const n = obj.name.toLowerCase()
          if (n.includes('wheel') || n.includes('tyre') || n.includes('tire')) {
            all.push(obj)
            const isFront = n.includes('front') || n.includes('fl') || n.includes('fr')
            if (isFront) front.push(obj)
          }
        })
        modelWheels.current = { front, all }
        setCarModel(scene)
      },
      undefined,
      () => {
        if (!cancelled) setCarModel(null)
      }
    )
    return () => { cancelled = true }
  }, [])

  // Helper: sample racing line at a fraction (for sim mode fallback)
  const sampleLine = (line: number[][], fraction: number) => {
    const n = line.length - 1
    const f = wrap01(fraction)
    const idx = f * n
    const i0 = Math.floor(idx)
    const i1 = (i0 + 1) % n
    const t = idx - i0
    return {
      x: line[i0][0] + (line[i1][0] - line[i0][0]) * t,
      z: -(line[i0][1] + (line[i1][1] - line[i0][1]) * t),
    }
  }

  useFrame((_, delta) => {
    if (!rootRef.current) return
    const { telemetry, raceStatus } = useRaceStore.getState()
    const dt = clamp(delta, 1 / 240, 1 / 20)
    const v = vis.current

    if (!telemetry) {
      target.current = null
      v.init = false
      carState.active = false
      return
    }

    // On new telemetry frame, update target
    // Always position on the racing line using lap_fraction — this works for both
    // sim and replay modes since FastF1 x/y coordinates don't match our track geometry
    if (!target.current || telemetry.timestamp !== target.current.timestamp) {
      let newX: number, newZ: number, newHeading: number

      if (cachedLine && cachedLine.length > 2) {
        const p = sampleLine(cachedLine, telemetry.lap_fraction)
        newX = p.x
        newZ = p.z
        const pAhead = sampleLine(cachedLine, telemetry.lap_fraction + 0.003)
        newHeading = Math.atan2(-(pAhead.z - p.z), pAhead.x - p.x)
      } else {
        return
      }

      const now = performance.now()
      prevTarget.current = target.current
      if (target.current) {
        frameInterval.current = Math.max(16, now - frameArrival.current)
      }
      frameArrival.current = now

      target.current = {
        x: newX,
        z: newZ,
        heading: newHeading,
        speed: (telemetry.speed_kph || 0) / 3.6,
        timestamp: telemetry.timestamp,
      }

      if (!v.init) {
        v.x = newX
        v.z = newZ
        v.heading = newHeading
        v.prevHeading = newHeading
        v.init = true
      }
    }

    if (!target.current) return

    // Smooth interpolation: lerp from previous position toward target,
    // then gently extrapolate using velocity so the car never stops between frames
    const elapsed = performance.now() - frameArrival.current
    const t = clamp(elapsed / frameInterval.current, 0, 2)

    const prev = prevTarget.current
    let goalX: number, goalZ: number, goalH: number
    if (prev && t <= 1) {
      // Interpolate between prev and curr target
      goalX = prev.x + (target.current.x - prev.x) * t
      goalZ = prev.z + (target.current.z - prev.z) * t
      goalH = lerpAngle(prev.heading, target.current.heading, t)
    } else {
      // Past curr target — gently extrapolate using speed+heading
      const extra = (t - 1) * frameInterval.current / 1000
      const hdg = target.current.heading
      goalX = target.current.x + Math.cos(hdg) * target.current.speed * extra
      goalZ = target.current.z - Math.sin(hdg) * target.current.speed * extra
      goalH = target.current.heading
    }

    // Apply final smoothing to remove any micro-jitter
    const smooth = 1 - Math.exp(-25 * dt)
    v.x += (goalX - v.x) * smooth
    v.z += (goalZ - v.z) * smooth
    v.heading = lerpAngle(v.heading, goalH, smooth)
    const speed = target.current.speed

    // Set car position and rotation
    rootRef.current.position.set(v.x, 0.05, v.z)
    rootRef.current.rotation.y = -v.heading + Math.PI / 2

    // Visual effects: steering from heading change rate
    const headingDelta = v.heading - v.prevHeading
    const headingRate = headingDelta / Math.max(dt, 0.001)
    v.prevHeading = v.heading
    const steerTarget = clamp(headingRate * 0.15, -0.55, 0.55)
    v.steer += (steerTarget - v.steer) * clamp(dt * 8, 0, 1)

    // Visual effects: chassis roll from lateral G
    const latG = clamp((headingRate * speed) / 9.81, -2.5, 2.5)
    if (chassisRef.current) chassisRef.current.rotation.z = clamp(latG * 0.035, -0.09, 0.09)
    if (flSteerRef.current) flSteerRef.current.rotation.y = -v.steer
    if (frSteerRef.current) frSteerRef.current.rotation.y = -v.steer

    // Wheel spin from speed
    v.wheelSpin += (speed / 0.33) * dt
    for (const w of wheelMeshes.current) {
      if (w) w.rotation.x = v.wheelSpin
    }
    for (const w of modelWheels.current.all) {
      w.rotation.x = v.wheelSpin
    }
    for (const fw of modelWheels.current.front) {
      fw.rotation.y = -v.steer
    }

    // Update shared car state for camera and other components
    carState.pos.set(v.x, 0.05, v.z)
    carState.forward.set(Math.cos(v.heading), 0, Math.sin(v.heading))
    carState.heading = v.heading
    carState.active = true
  })

  // In replay mode, render an invisible group — still updates carState for camera tracking
  const isSim = appMode === 'sim'

  return (
    <group ref={rootRef}>
      {isSim && (
        <group scale={[1.5, 1.5, 1.5]}>
          {carModel ? (
            <primitive
              ref={chassisRef as any}
              object={carModel}
              position={[0, 0, -1.85]}
              scale={[1.15, 1.15, 1.15]}
            />
          ) : (
            <>
              <group ref={chassisRef} position={[0, 0, -1.85]}>
                <mesh position={[0, 0.38, 0]} castShadow>
                  <boxGeometry args={[1.6, 0.45, 5.5]} />
                  <meshPhongMaterial color="#e10600" shininess={100} />
                </mesh>
                <mesh position={[0, 0.32, -3.8]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <coneGeometry args={[0.35, 2.2, 6]} />
                  <meshPhongMaterial color="#e10600" shininess={100} />
                </mesh>
                <mesh position={[0, 0.65, 0.25]}>
                  <boxGeometry args={[0.65, 0.18, 1]} />
                  <meshPhongMaterial color="#222222" />
                </mesh>
                <mesh position={[0, 0.88, 0.4]}>
                  <sphereGeometry args={[0.16, 8, 8]} />
                  <meshPhongMaterial color="#e10600" />
                </mesh>
                <mesh position={[0, 0.12, -4.1]}>
                  <boxGeometry args={[1.85, 0.04, 0.55]} />
                  <meshPhongMaterial color="#e10600" />
                </mesh>
                <mesh position={[0, 0.95, 2.7]}>
                  <boxGeometry args={[0.95, 0.04, 0.25]} />
                  <meshPhongMaterial color="#e10600" />
                </mesh>
                <mesh position={[-0.88, 0.33, 0.2]} castShadow>
                  <boxGeometry args={[0.55, 0.38, 2.8]} />
                  <meshPhongMaterial color="#cccccc" shininess={80} />
                </mesh>
                <mesh position={[0.88, 0.33, 0.2]} castShadow>
                  <boxGeometry args={[0.55, 0.38, 2.8]} />
                  <meshPhongMaterial color="#cccccc" shininess={80} />
                </mesh>
                <group ref={flSteerRef} position={[-0.82, 0.33, -2.05]}>
                  <mesh ref={(el) => { wheelMeshes.current[0] = el }} rotation={[0, 0, Math.PI / 2]} castShadow>
                    <cylinderGeometry args={[0.33, 0.33, 0.26, 16]} />
                    <meshPhongMaterial color="#333333" />
                  </mesh>
                </group>
                <group ref={frSteerRef} position={[0.82, 0.33, -2.05]}>
                  <mesh ref={(el) => { wheelMeshes.current[1] = el }} rotation={[0, 0, Math.PI / 2]} castShadow>
                    <cylinderGeometry args={[0.33, 0.33, 0.26, 16]} />
                    <meshPhongMaterial color="#333333" />
                  </mesh>
                </group>
                <mesh ref={(el) => { wheelMeshes.current[2] = el }} position={[-0.82, 0.35, 1.85]} rotation={[0, 0, Math.PI / 2]} castShadow>
                  <cylinderGeometry args={[0.33, 0.33, 0.26, 16]} />
                  <meshPhongMaterial color="#333333" />
                </mesh>
                <mesh ref={(el) => { wheelMeshes.current[3] = el }} position={[0.82, 0.35, 1.85]} rotation={[0, 0, Math.PI / 2]} castShadow>
                  <cylinderGeometry args={[0.33, 0.33, 0.26, 16]} />
                  <meshPhongMaterial color="#333333" />
                </mesh>
              </group>
            </>
          )}
        </group>
      )}
    </group>
  )
}
