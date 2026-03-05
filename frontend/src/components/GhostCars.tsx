import { useRef, useMemo, memo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Text, Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { useRaceStore } from '../stores/raceStore'
import type { CarPosition } from '../types'

// Team color mapping
const TEAM_COLORS: Record<string, string> = {
  'Red Bull Racing': '#3671C6',
  'Red Bull': '#3671C6',
  'Ferrari': '#E8002D',
  'Scuderia Ferrari': '#E8002D',
  'Mercedes': '#27F4D2',
  'McLaren': '#FF8000',
  'Aston Martin': '#229971',
  'Alpine': '#FF87BC',
  'Alpine F1 Team': '#FF87BC',
  'Williams': '#64C4FF',
  'RB': '#6692FF',
  'AlphaTauri': '#6692FF',
  'Haas F1 Team': '#B6BABD',
  'Haas': '#B6BABD',
  'Kick Sauber': '#52E252',
  'Alfa Romeo': '#52E252',
  'Sauber': '#52E252',
}

const TYRE_COLORS: Record<string, string> = {
  soft: '#ff2222',
  medium: '#ffdd00',
  hard: '#cccccc',
}

const DEFAULT_COLOR = '#888888'

function getTeamColor(team: string): string {
  if (TEAM_COLORS[team]) return TEAM_COLORS[team]
  const lower = team.toLowerCase()
  for (const [key, color] of Object.entries(TEAM_COLORS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return color
    }
  }
  return DEFAULT_COLOR
}

// Shared state for camera to track the focused ghost car
export const ghostFocusState = {
  pos: new THREE.Vector3(),
  heading: 0,
  active: false,
}

// Sample track waypoints at a given fraction to get 3D position
function sampleWaypoints(waypoints: [number, number][], fraction: number) {
  const n = waypoints.length - 1
  const f = ((fraction % 1) + 1) % 1
  const idx = f * n
  const i0 = Math.floor(idx)
  const i1 = (i0 + 1) % waypoints.length
  const t = idx - i0
  const x = waypoints[i0][0] + (waypoints[i1][0] - waypoints[i0][0]) * t
  const y = waypoints[i0][1] + (waypoints[i1][1] - waypoints[i0][1]) * t
  return { x, z: -y }
}

interface GhostCarProps {
  abbreviation: string
  team: string
  position: CarPosition
  isFocused: boolean
  waypoints: [number, number][]
}

const GhostCar = memo(function GhostCar({ abbreviation, team, position, isFocused, waypoints }: GhostCarProps) {
  const groupRef = useRef<THREE.Group>(null)
  const smoothPos = useRef({ x: 0, z: 0, heading: 0, init: false })
  const distRef = useRef(0)
  const camera = useThree((s) => s.camera)

  const teamColor = getTeamColor(team)
  const tyreColor = TYRE_COLORS[position.tyre_compound] || TYRE_COLORS.hard

  useFrame((_, delta) => {
    if (!groupRef.current || !waypoints.length) return
    const s = smoothPos.current

    // Position on track using lap_fraction
    const p = sampleWaypoints(waypoints, position.lap_fraction)
    const pAhead = sampleWaypoints(waypoints, position.lap_fraction + 0.003)
    const targetHeading = Math.atan2(-(pAhead.z - p.z), pAhead.x - p.x)

    if (!s.init) {
      s.x = p.x
      s.z = p.z
      s.heading = targetHeading
      s.init = true
    }

    // Lerp position
    const lerpFactor = Math.min(1, delta * 6)
    s.x += (p.x - s.x) * lerpFactor
    s.z += (p.z - s.z) * lerpFactor

    // Heading wrap-aware lerp
    let dh = targetHeading - s.heading
    if (dh > Math.PI) dh -= 2 * Math.PI
    if (dh < -Math.PI) dh += 2 * Math.PI
    s.heading += dh * lerpFactor

    groupRef.current.position.set(s.x, 0.3, s.z)
    groupRef.current.rotation.y = -s.heading + Math.PI / 2

    // Compute distance to camera for LOD
    distRef.current = camera.position.distanceTo(groupRef.current.position)

    // Update ghost focus state for camera tracking
    if (isFocused) {
      ghostFocusState.pos.set(s.x, 0.3, s.z)
      ghostFocusState.heading = s.heading
      ghostFocusState.active = true
    }
  })

  // LOD: skip rendering label + detail for distant cars
  const isClose = distRef.current < 300
  const isMedium = distRef.current < 600

  return (
    <group ref={groupRef}>
      {/* Car body — always visible */}
      <mesh>
        <boxGeometry args={[1.8, 0.5, 4.5]} />
        <meshStandardMaterial color={teamColor} roughness={0.4} metalness={0.3} />
      </mesh>

      {/* Detail meshes only when close enough */}
      {isMedium && (
        <>
          {/* Cockpit */}
          <mesh position={[0, 0.35, 0.3]}>
            <boxGeometry args={[0.6, 0.15, 0.8]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
          </mesh>

          {/* Tyre compound stripe on nose */}
          <mesh position={[0, 0.28, -2.0]}>
            <boxGeometry args={[1.2, 0.08, 0.4]} />
            <meshStandardMaterial color={tyreColor} roughness={0.5} emissive={tyreColor} emissiveIntensity={0.3} />
          </mesh>
        </>
      )}

      {/* Focused highlight ring */}
      {isFocused && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.5, 4.0, 32]} />
          <meshBasicMaterial color={teamColor} transparent opacity={0.6} />
        </mesh>
      )}

      {/* Label — only when close or focused */}
      {(isClose || isFocused) && (
        <Billboard follow lockX={false} lockY={false} lockZ={false}>
          <group position={[0, 2.5, 0]}>
            <mesh>
              <planeGeometry args={[3.2, 1.2]} />
              <meshBasicMaterial color={isFocused ? '#111133' : '#000000'} transparent opacity={0.75} />
            </mesh>
            <Text
              position={[0, 0.15, 0.01]}
              fontSize={0.55}
              color={teamColor}
              anchorX="center"
              anchorY="middle"
              font={undefined}
            >
              {abbreviation}
            </Text>
            <Text
              position={[0, -0.35, 0.01]}
              fontSize={0.35}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              font={undefined}
            >
              {`P${position.position}`}
            </Text>
          </group>
        </Billboard>
      )}
    </group>
  )
})

export function GhostCars() {
  const carPositions = useRaceStore((s) => s.carPositions)
  const replayDrivers = useRaceStore((s) => s.replayDrivers)
  const multiCarEnabled = useRaceStore((s) => s.multiCarEnabled)
  const focusedDriver = useRaceStore((s) => s.focusedDriver)
  const currentTrack = useRaceStore((s) => s.currentTrack)

  // Reset ghost focus when no ghost is focused
  if (!focusedDriver) {
    ghostFocusState.active = false
  }

  if (!multiCarEnabled || !carPositions) return null

  const waypoints = currentTrack?.waypoints_xy
  if (!waypoints || waypoints.length < 3) return null

  // Build a team lookup from replayDrivers
  const teamMap: Record<string, string> = {}
  for (const d of replayDrivers) {
    teamMap[d.abbreviation] = d.team
  }

  return (
    <>
      {Object.entries(carPositions).map(([abbrev, pos]) => (
        <GhostCar
          key={abbrev}
          abbreviation={abbrev}
          team={teamMap[abbrev] || ''}
          position={pos}
          isFocused={focusedDriver === abbrev}
          waypoints={waypoints}
        />
      ))}
    </>
  )
}
