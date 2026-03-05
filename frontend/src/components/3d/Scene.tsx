import { Canvas } from '@react-three/fiber'
import { GhostCars } from '../GhostCars'
import { HUD } from './HUD'
import { Lighting } from './Lighting'
import { TrackSurface, TrackKerbs, WhiteLines, RunoffAreas, Barriers, PitLane } from './TrackGeometry'
import { RubberMarks } from './RubberMarks'
import { DRSZones } from './DRSZones'
import { RacingLine } from './RacingLine'
import { Car, CarContactShadow } from './Car'
import { CameraController } from './CameraController'
export function CenterView() {
  return (
    <div className="flex-1 relative bg-[#050510]">
      <HUD />
      <Canvas
        shadows
        camera={{ position: [0, 30, 50], fov: 55, near: 0.5, far: 12000 }}
        gl={{ antialias: true }}
      >
        <Lighting />
        <TrackSurface />
        <RubberMarks />
        <WhiteLines />
        <TrackKerbs />
        <RunoffAreas />
        <Barriers />
        <PitLane />
        <DRSZones />
        <RacingLine />
        <Car />
        <GhostCars />
        <CarContactShadow />
        <CameraController />
      </Canvas>
    </div>
  )
}
