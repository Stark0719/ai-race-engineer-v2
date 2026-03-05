import { Sky, Environment, SoftShadows } from '@react-three/drei'

export function Lighting() {
  return (
    <>
      <Sky
        distance={450000}
        sunPosition={[600, 800, 400]}
        turbidity={8}
        rayleigh={0.5}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />
      <Environment preset="sunset" background={false} environmentIntensity={0.4} />
      <fog attach="fog" args={['#8899bb', 800, 5000]} />
      <SoftShadows size={20} samples={6} />

      <ambientLight intensity={0.4} />
      <directionalLight
        position={[600, 800, 400]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-camera-near={1}
        shadow-camera-far={2000}
      />
      <hemisphereLight args={['#87ceeb', '#2d5a1e', 0.4]} />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[20000, 20000]} />
        <meshStandardMaterial color="#1a2e1a" roughness={1.0} metalness={0} />
      </mesh>
    </>
  )
}
