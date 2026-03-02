/**
 * Generate a low-poly F1 car GLB model using @gltf-transform/core.
 *
 * Parts: monocoque, nose, halo, front wing, rear wing, sidepods, floor,
 *        4 named wheels (wheel_front_left, wheel_front_right, etc.)
 *
 * Run: node scripts/generate_f1_car.mjs
 * Output: public/models/f1_car.glb
 */

import { Document, NodeIO } from '@gltf-transform/core'
import { writeFile, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/models/f1_car.glb')

// ── geometry helpers ─────────────────────────────────────────────────

function boxGeometry(w, h, d) {
  const hw = w / 2, hh = h / 2, hd = d / 2
  // 6 faces, 4 verts each = 24 verts, 36 indices
  const positions = new Float32Array([
    // +Z face
    -hw, -hh, hd,  hw, -hh, hd,  hw, hh, hd,  -hw, hh, hd,
    // -Z face
    hw, -hh, -hd,  -hw, -hh, -hd,  -hw, hh, -hd,  hw, hh, -hd,
    // +Y face
    -hw, hh, hd,  hw, hh, hd,  hw, hh, -hd,  -hw, hh, -hd,
    // -Y face
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh, hd,  -hw, -hh, hd,
    // +X face
    hw, -hh, hd,  hw, -hh, -hd,  hw, hh, -hd,  hw, hh, hd,
    // -X face
    -hw, -hh, -hd,  -hw, -hh, hd,  -hw, hh, hd,  -hw, hh, -hd,
  ])
  const normals = new Float32Array([
    0,0,1,  0,0,1,  0,0,1,  0,0,1,
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    0,1,0,  0,1,0,  0,1,0,  0,1,0,
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    1,0,0,  1,0,0,  1,0,0,  1,0,0,
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
  ])
  const indices = new Uint16Array([
    0,1,2,  0,2,3,
    4,5,6,  4,6,7,
    8,9,10, 8,10,11,
    12,13,14, 12,14,15,
    16,17,18, 16,18,19,
    20,21,22, 20,22,23,
  ])
  return { positions, normals, indices }
}

function taperedBoxGeometry(wFront, wBack, hFront, hBack, depth) {
  // Box tapered along Z axis: front face at -depth/2, back face at +depth/2
  const hd = depth / 2
  const wf = wFront / 2, wb = wBack / 2
  const hf = hFront / 2, hb = hBack / 2

  const positions = new Float32Array([
    // Front face (-Z)
    wf, -hf, -hd,  -wf, -hf, -hd,  -wf, hf, -hd,  wf, hf, -hd,
    // Back face (+Z)
    -wb, -hb, hd,  wb, -hb, hd,  wb, hb, hd,  -wb, hb, hd,
    // Top face
    -wf, hf, -hd,  -wb, hb, hd,  wb, hb, hd,  wf, hf, -hd,
    // Bottom face
    -wf, -hf, -hd,  wf, -hf, -hd,  wb, -hb, hd,  -wb, -hb, hd,
    // Right face (+X)
    wf, -hf, -hd,  wf, hf, -hd,  wb, hb, hd,  wb, -hb, hd,
    // Left face (-X)
    -wf, -hf, -hd,  -wb, -hb, hd,  -wb, hb, hd,  -wf, hf, -hd,
  ])
  // Approximate normals (flat-shaded per face)
  const normals = new Float32Array([
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    0,0,1,  0,0,1,  0,0,1,  0,0,1,
    0,1,0,  0,1,0,  0,1,0,  0,1,0,
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    1,0,0,  1,0,0,  1,0,0,  1,0,0,
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
  ])
  const indices = new Uint16Array([
    0,1,2,  0,2,3,
    4,5,6,  4,6,7,
    8,9,10, 8,10,11,
    12,13,14, 12,14,15,
    16,17,18, 16,18,19,
    20,21,22, 20,22,23,
  ])
  return { positions, normals, indices }
}

function cylinderGeometry(radius, height, segments = 16) {
  // Cylinder along Y axis (rotated in the scene to be along X for wheels)
  const positions = []
  const normals = []
  const indices = []
  const hh = height / 2

  // Side vertices: 2 rings of (segments+1) vertices
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const cos = Math.cos(a), sin = Math.sin(a)
    // Bottom ring
    positions.push(cos * radius, -hh, sin * radius)
    normals.push(cos, 0, sin)
    // Top ring
    positions.push(cos * radius, hh, sin * radius)
    normals.push(cos, 0, sin)
  }
  // Side indices
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3
    indices.push(a, c, b, b, c, d)
  }

  // Top cap
  const topCenter = positions.length / 3
  positions.push(0, hh, 0)
  normals.push(0, 1, 0)
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    positions.push(Math.cos(a) * radius, hh, Math.sin(a) * radius)
    normals.push(0, 1, 0)
  }
  for (let i = 0; i < segments; i++) {
    indices.push(topCenter, topCenter + 1 + i, topCenter + 2 + i)
  }

  // Bottom cap
  const botCenter = positions.length / 3
  positions.push(0, -hh, 0)
  normals.push(0, -1, 0)
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    positions.push(Math.cos(a) * radius, -hh, Math.sin(a) * radius)
    normals.push(0, -1, 0)
  }
  for (let i = 0; i < segments; i++) {
    indices.push(botCenter, botCenter + 2 + i, botCenter + 1 + i)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

// ── GLB assembly ─────────────────────────────────────────────────────

async function main() {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene()

  function makeMaterial(name, r, g, b, metallic = 0.3, roughness = 0.5) {
    return doc.createMaterial(name)
      .setBaseColorFactor([r, g, b, 1])
      .setMetallicFactor(metallic)
      .setRoughnessFactor(roughness)
  }

  // Materials
  const matBody    = makeMaterial('body',     0.01, 0.02, 0.08, 0.7, 0.25)   // dark blue-black
  const matCarbon  = makeMaterial('carbon',   0.05, 0.05, 0.05, 0.1, 0.35)   // matte carbon
  const matWing    = makeMaterial('wing',     0.9,  0.05, 0.05, 0.5, 0.3)    // F1 red
  const matWheel   = makeMaterial('wheel',    0.12, 0.12, 0.12, 0.8, 0.2)    // dark metallic
  const matTyre    = makeMaterial('tyre_mat', 0.08, 0.08, 0.08, 0.0, 0.9)    // rubber black
  const matHalo    = makeMaterial('halo',     0.6,  0.55, 0.45, 0.95, 0.15)  // titanium
  const matFloor   = makeMaterial('floor',    0.04, 0.04, 0.04, 0.1, 0.6)    // dark carbon

  function addPart(name, geom, material, translation, rotation, scale) {
    const posAcc = doc.createAccessor(name + '_pos')
      .setBuffer(buffer).setType('VEC3').setArray(geom.positions)
    const normAcc = doc.createAccessor(name + '_norm')
      .setBuffer(buffer).setType('VEC3').setArray(geom.normals)
    const idxAcc = doc.createAccessor(name + '_idx')
      .setBuffer(buffer).setType('SCALAR').setArray(geom.indices)

    const prim = doc.createPrimitive()
      .setAttribute('POSITION', posAcc)
      .setAttribute('NORMAL', normAcc)
      .setIndices(idxAcc)
      .setMaterial(material)

    const mesh = doc.createMesh(name).addPrimitive(prim)
    const node = doc.createNode(name).setMesh(mesh)
    if (translation) node.setTranslation(translation)
    if (rotation) node.setRotation(rotation)
    if (scale) node.setScale(scale)
    return node
  }

  // Car root node
  const carRoot = doc.createNode('f1_car')

  // ── MONOCOQUE (tapered body) ──
  // Length 4.5m along -Z (front), tapering from 1.4m rear to 0.6m front
  // Height 0.35m, center at y=0.25
  const monoGeom = taperedBoxGeometry(0.55, 1.4, 0.30, 0.38, 4.5)
  const mono = addPart('monocoque', monoGeom, matBody, [0, 0.25, 0.0])
  carRoot.addChild(mono)

  // ── NOSE CONE ──
  // Extends forward from monocoque, tapers to point
  const noseGeom = taperedBoxGeometry(0.12, 0.55, 0.10, 0.28, 1.4)
  const nose = addPart('nose', noseGeom, matBody, [0, 0.15, -2.95])
  carRoot.addChild(nose)

  // ── COCKPIT SURROUND ──
  // Raised edges around the cockpit opening
  const cockpitL = addPart('cockpit_left', boxGeometry(0.08, 0.18, 0.9), matCarbon, [-0.28, 0.52, -0.6])
  const cockpitR = addPart('cockpit_right', boxGeometry(0.08, 0.18, 0.9), matCarbon, [0.28, 0.52, -0.6])
  carRoot.addChild(cockpitL)
  carRoot.addChild(cockpitR)

  // ── HALO ──
  // Front pillar
  const haloPillar = addPart('halo_pillar', boxGeometry(0.06, 0.06, 0.65), matHalo, [0, 0.65, -1.15])
  carRoot.addChild(haloPillar)
  // Top bar
  const haloTop = addPart('halo_top', boxGeometry(0.06, 0.06, 0.45), matHalo, [0, 0.70, -0.55])
  carRoot.addChild(haloTop)
  // Left arm
  const haloL = addPart('halo_left', boxGeometry(0.04, 0.06, 0.4), matHalo, [-0.22, 0.60, -0.35])
  carRoot.addChild(haloL)
  // Right arm
  const haloR = addPart('halo_right', boxGeometry(0.04, 0.06, 0.4), matHalo, [0.22, 0.60, -0.35])
  carRoot.addChild(haloR)

  // ── FRONT WING ──
  // Main plane
  const fwMain = addPart('front_wing_main', boxGeometry(1.8, 0.035, 0.32), matWing, [0, 0.05, -3.65])
  carRoot.addChild(fwMain)
  // Flap
  const fwFlap = addPart('front_wing_flap', boxGeometry(1.6, 0.025, 0.18), matWing, [0, 0.10, -3.72])
  carRoot.addChild(fwFlap)
  // Endplates
  const fwEndL = addPart('front_wing_endplate_l', boxGeometry(0.03, 0.15, 0.35), matCarbon, [-0.92, 0.08, -3.65])
  const fwEndR = addPart('front_wing_endplate_r', boxGeometry(0.03, 0.15, 0.35), matCarbon, [0.92, 0.08, -3.65])
  carRoot.addChild(fwEndL)
  carRoot.addChild(fwEndR)
  // Nose tip connecting to wing
  const noseTip = addPart('nose_tip', boxGeometry(0.10, 0.06, 0.30), matBody, [0, 0.08, -3.55])
  carRoot.addChild(noseTip)

  // ── REAR WING ──
  // Main plane
  const rwMain = addPart('rear_wing_main', boxGeometry(0.82, 0.035, 0.22), matWing, [0, 0.72, 2.1])
  carRoot.addChild(rwMain)
  // DRS flap
  const rwFlap = addPart('rear_wing_flap', boxGeometry(0.78, 0.025, 0.14), matWing, [0, 0.78, 2.05])
  carRoot.addChild(rwFlap)
  // Endplates
  const rwEndL = addPart('rear_wing_endplate_l', boxGeometry(0.025, 0.30, 0.28), matCarbon, [-0.42, 0.68, 2.1])
  const rwEndR = addPart('rear_wing_endplate_r', boxGeometry(0.025, 0.30, 0.28), matCarbon, [0.42, 0.68, 2.1])
  carRoot.addChild(rwEndL)
  carRoot.addChild(rwEndR)

  // ── SIDEPODS ──
  const sidepodGeom = taperedBoxGeometry(0.38, 0.50, 0.30, 0.35, 1.8)
  const sidepodL = addPart('sidepod_left', sidepodGeom, matBody, [-0.65, 0.22, 0.3])
  const sidepodR = addPart('sidepod_right', sidepodGeom, matBody, [0.65, 0.22, 0.3])
  carRoot.addChild(sidepodL)
  carRoot.addChild(sidepodR)

  // Sidepod intakes
  const intakeGeom = boxGeometry(0.04, 0.20, 0.08)
  const intakeL = addPart('intake_left', intakeGeom, matCarbon, [-0.88, 0.32, -0.45])
  const intakeR = addPart('intake_right', intakeGeom, matCarbon, [0.88, 0.32, -0.45])
  carRoot.addChild(intakeL)
  carRoot.addChild(intakeR)

  // ── FLOOR / DIFFUSER ──
  const floor = addPart('floor', boxGeometry(1.6, 0.025, 4.2), matFloor, [0, 0.01, 0.0])
  carRoot.addChild(floor)
  // Diffuser ramp (angled piece at rear)
  const diffuser = addPart('diffuser', boxGeometry(1.4, 0.04, 0.6), matCarbon, [0, 0.08, 2.35])
  carRoot.addChild(diffuser)

  // ── ENGINE COVER / AIRBOX ──
  const airbox = addPart('airbox', boxGeometry(0.22, 0.28, 0.35), matBody, [0, 0.58, -0.15])
  carRoot.addChild(airbox)

  // Engine cover tapering to rear
  const engineCover = addPart('engine_cover', taperedBoxGeometry(0.10, 0.45, 0.12, 0.30, 1.8), matBody, [0, 0.45, 1.1])
  carRoot.addChild(engineCover)

  // ── SUSPENSION ARMS (simplified) ──
  const suspGeom = boxGeometry(0.42, 0.025, 0.025)
  // Front suspension
  const suspFL_u = addPart('susp_fl_upper', suspGeom, matCarbon, [-0.50, 0.28, -1.85])
  const suspFR_u = addPart('susp_fr_upper', suspGeom, matCarbon, [0.50, 0.28, -1.85])
  const suspFL_l = addPart('susp_fl_lower', suspGeom, matCarbon, [-0.50, 0.12, -1.85])
  const suspFR_l = addPart('susp_fr_lower', suspGeom, matCarbon, [0.50, 0.12, -1.85])
  carRoot.addChild(suspFL_u)
  carRoot.addChild(suspFR_u)
  carRoot.addChild(suspFL_l)
  carRoot.addChild(suspFR_l)
  // Rear suspension
  const suspRL_u = addPart('susp_rl_upper', suspGeom, matCarbon, [-0.50, 0.28, 1.85])
  const suspRR_u = addPart('susp_rr_upper', suspGeom, matCarbon, [0.50, 0.28, 1.85])
  const suspRL_l = addPart('susp_rl_lower', suspGeom, matCarbon, [-0.50, 0.12, 1.85])
  const suspRR_l = addPart('susp_rr_lower', suspGeom, matCarbon, [0.50, 0.12, 1.85])
  carRoot.addChild(suspRL_u)
  carRoot.addChild(suspRR_u)
  carRoot.addChild(suspRL_l)
  carRoot.addChild(suspRR_l)

  // ── WHEELS ──
  // The existing loader code checks for 'wheel'/'tyre'/'tire' in name, and
  // 'front'/'fl'/'fr' to identify front wheels for steering animation.
  // Wheels are cylinders rotated 90° around Z to lay along X axis.
  const wheelRot = [0, 0, 0.7071068, 0.7071068] // 90° around Z

  // Front wheels: radius 0.33, width 0.30
  const fWheelGeom = cylinderGeometry(0.33, 0.30, 20)
  const fTyreGeom = cylinderGeometry(0.34, 0.26, 20)

  // Front-left
  const wheelFL_hub = addPart('wheel_front_left', fWheelGeom, matWheel, [-0.78, 0.33, -2.05], wheelRot)
  const tyreFL = addPart('tyre_front_left', fTyreGeom, matTyre, [-0.78, 0.33, -2.05], wheelRot, [1.08, 1.08, 1.08])
  carRoot.addChild(wheelFL_hub)
  carRoot.addChild(tyreFL)

  // Front-right
  const wheelFR_hub = addPart('wheel_front_right', fWheelGeom, matWheel, [0.78, 0.33, -2.05], wheelRot)
  const tyreFR = addPart('tyre_front_right', fTyreGeom, matTyre, [0.78, 0.33, -2.05], wheelRot, [1.08, 1.08, 1.08])
  carRoot.addChild(wheelFR_hub)
  carRoot.addChild(tyreFR)

  // Rear wheels: radius 0.34, width 0.38 (wider rears)
  const rWheelGeom = cylinderGeometry(0.34, 0.38, 20)
  const rTyreGeom = cylinderGeometry(0.35, 0.34, 20)

  // Rear-left
  const wheelRL_hub = addPart('wheel_rear_left', rWheelGeom, matWheel, [-0.80, 0.34, 1.85], wheelRot)
  const tyreRL = addPart('tyre_rear_left', rTyreGeom, matTyre, [-0.80, 0.34, 1.85], wheelRot, [1.08, 1.08, 1.08])
  carRoot.addChild(wheelRL_hub)
  carRoot.addChild(tyreRL)

  // Rear-right
  const wheelRR_hub = addPart('wheel_rear_right', rWheelGeom, matWheel, [0.80, 0.34, 1.85], wheelRot)
  const tyreRR = addPart('tyre_rear_right', rTyreGeom, matTyre, [0.80, 0.34, 1.85], wheelRot, [1.08, 1.08, 1.08])
  carRoot.addChild(wheelRR_hub)
  carRoot.addChild(tyreRR)

  // Add car root to scene
  scene.addChild(carRoot)

  // ── Export ──
  const io = new NodeIO()
  const glb = await io.writeBinary(doc)

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, Buffer.from(glb))

  // Stats
  let totalVerts = 0, totalTris = 0
  doc.getRoot().listMeshes().forEach(m => {
    m.listPrimitives().forEach(p => {
      const pos = p.getAttribute('POSITION')
      const idx = p.getIndices()
      if (pos) totalVerts += pos.getCount()
      if (idx) totalTris += idx.getCount() / 3
    })
  })

  console.log(`✓ Written ${OUT}`)
  console.log(`  ${doc.getRoot().listNodes().length} nodes, ${totalVerts} vertices, ${totalTris} triangles`)
  console.log(`  File size: ${(glb.byteLength / 1024).toFixed(1)} KB`)
}

main().catch(err => { console.error(err); process.exit(1) })
