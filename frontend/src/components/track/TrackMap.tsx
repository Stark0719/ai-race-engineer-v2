import { useEffect, useRef } from 'react'
import { useRaceStore } from '../../stores/raceStore'

export function TrackMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const {
    currentTrack, telemetry, lastLapSectorColors,
  } = useRaceStore()

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const rect = cv.getBoundingClientRect()
    cv.width = rect.width * 2
    cv.height = rect.height * 2
    ctx.scale(2, 2)
    const w = rect.width
    const h = rect.height

    // Background
    ctx.fillStyle = '#080810'
    ctx.fillRect(0, 0, w, h)

    if (!currentTrack || !currentTrack.waypoints_xy || currentTrack.waypoints_xy.length < 3) {
      ctx.fillStyle = '#555'
      ctx.font = '11px monospace'
      ctx.fillText('No track data — run extract_tracks.py', 10, 20)
      return
    }

    const pts = currentTrack.waypoints_xy
    // Compute bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [px, py] of pts) {
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
    const range = Math.max(maxX - minX, maxY - minY) * 1.15 || 1
    const ox = (minX + maxX) / 2
    const oy = (minY + maxY) / 2
    const scale = Math.min(w, h) / range

    const tx = (p: [number, number]) => (p[0] - ox) * scale + w / 2
    const ty = (p: [number, number]) => -(p[1] - oy) * scale + h / 2

    // Track surface fill
    ctx.fillStyle = '#12122a'
    ctx.beginPath()
    ctx.moveTo(tx(pts[0]), ty(pts[0]))
    for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i]), ty(pts[i]))
    ctx.closePath()
    ctx.fill()

    // Base outline
    ctx.strokeStyle = '#5b5b6a'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(tx(pts[0]), ty(pts[0]))
    for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i]), ty(pts[i]))
    ctx.closePath()
    ctx.stroke()

    // Sector colored overlays (F1-like theme)
    if (currentTrack.sector_boundaries && currentTrack.sector_boundaries.length >= 4) {
      const b1 = Math.floor(currentTrack.sector_boundaries[1] * (pts.length - 1))
      const b2 = Math.floor(currentTrack.sector_boundaries[2] * (pts.length - 1))
      const segs: Array<{ start: number; end: number; sector: 1 | 2 | 3 }> = [
        { start: 0, end: b1, sector: 1 },
        { start: b1, end: b2, sector: 2 },
        { start: b2, end: pts.length - 1, sector: 3 },
      ]
      const colMap = {
        purple: '#b388ff',
        yellow: '#ffd54f',
        green: '#69f0ae',
        none: '#e10600',
      } as const
      const lapCol = {
        1: lastLapSectorColors.s1,
        2: lastLapSectorColors.s2,
        3: lastLapSectorColors.s3,
      } as const
      for (const seg of segs) {
        const active = telemetry?.sector === seg.sector
        const baseColor = colMap[lapCol[seg.sector] || 'none']
        ctx.strokeStyle = active ? colMap.green : baseColor
        ctx.lineWidth = active ? 3.4 : 2.8
        ctx.beginPath()
        const s = Math.max(0, seg.start)
        const e = Math.min(pts.length - 1, seg.end)
        ctx.moveTo(tx(pts[s]), ty(pts[s]))
        for (let i = s + 1; i <= e; i++) ctx.lineTo(tx(pts[i]), ty(pts[i]))
        ctx.stroke()
      }

      // Sector labels near each segment center
      const mids = [Math.floor(b1 * 0.5), Math.floor((b1 + b2) * 0.5), Math.floor((b2 + pts.length - 1) * 0.5)]
      ctx.font = '9px monospace'
      ctx.fillStyle = '#d1d5db'
      mids.forEach((mi, idx) => {
        const p = pts[Math.max(0, Math.min(pts.length - 1, mi))]
        ctx.fillText(`S${idx + 1}`, tx(p) + 5, ty(p) - 5)
      })
    } else {
      // Fallback single red outline
      ctx.strokeStyle = '#e10600'
      ctx.lineWidth = 2.8
      ctx.beginPath()
      ctx.moveTo(tx(pts[0]), ty(pts[0]))
      for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i]), ty(pts[i]))
      ctx.closePath()
      ctx.stroke()
    }

    // Corner markers
    if (currentTrack.corners) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      for (const corner of currentTrack.corners) {
        const ci = Math.min(corner.index, pts.length - 1)
        ctx.beginPath()
        ctx.arc(tx(pts[ci]), ty(pts[ci]), 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Sector boundaries
    if (currentTrack.sector_boundaries) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.lineWidth = 1
      for (let s = 1; s < currentTrack.sector_boundaries.length - 1; s++) {
        const idx = Math.floor(currentTrack.sector_boundaries[s] * (pts.length - 1))
        const p = pts[Math.min(idx, pts.length - 1)]
        ctx.beginPath()
        ctx.arc(tx(p), ty(p), 5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // S/F checkered flag
    const sx = tx(pts[0]), sy = ty(pts[0])
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#000' : '#fff'
        ctx.fillRect(sx - 6 + i * 4, sy - 4 + j * 4, 4, 4)
      }
    }

    // Direction arrows
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
    for (let i = 0; i < pts.length - 1; i += 40) {
      const ax = tx(pts[i]), ay = ty(pts[i])
      const bx = tx(pts[i + 1]), by = ty(pts[i + 1])
      const angle = Math.atan2(by - ay, bx - ax)
      ctx.save()
      ctx.translate(ax, ay)
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.moveTo(6, 0)
      ctx.lineTo(-2, -3)
      ctx.lineTo(-2, 3)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // Car position
    if (telemetry) {
      const carPt: [number, number] = [telemetry.x, telemetry.y]
      const colors: Record<string, string> = {
        soft: '#FF3333', medium: '#FFD700', hard: '#CCCCCC',
      }
      ctx.fillStyle = colors[telemetry.tyre_compound] || '#00ff00'
      ctx.beginPath()
      ctx.arc(tx(carPt), ty(carPt), 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

  }, [currentTrack, telemetry, lastLapSectorColors])

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded"
      style={{ height: '180px', background: '#080810' }}
    />
  )
}
