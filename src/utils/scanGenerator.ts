import type {
  ExclusionZone,
  Point,
  SampleShape,
  ScanParameters,
  ScanPass,
  ScanResult,
  StageConstraints,
} from '../types/scan'

// ── Bounding box ───────────────────────────────────────────────────────────────

export function getBoundingBox(shape: SampleShape): [number, number, number, number] {
  if (shape.type === 'rectangle' && shape.rect) {
    const r = shape.rect
    return [r.x, r.y, r.x + r.width, r.y + r.height]
  }
  if (shape.type === 'circle' && shape.circle) {
    const c = shape.circle
    return [c.cx - c.radius, c.cy - c.radius, c.cx + c.radius, c.cy + c.radius]
  }
  if (shape.type === 'freeform' && shape.freeform) {
    const xs = shape.freeform.points.map((p) => p.x)
    const ys = shape.freeform.points.map((p) => p.y)
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  throw new Error('Unsupported or incomplete shape')
}

// ── Point containment ──────────────────────────────────────────────────────────

function inRect(x: number, y: number, shape: SampleShape): boolean {
  const r = shape.rect!
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
}

function inCircle(x: number, y: number, shape: SampleShape): boolean {
  const c = shape.circle!
  return (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.radius ** 2
}

export function polygonContains(x: number, y: number, pts: Point[]): boolean {
  const n = pts.length
  let inside = false
  let j = n - 1
  for (let i = 0; i < n; i++) {
    const xi = pts[i].x, yi = pts[i].y
    const xj = pts[j].x, yj = pts[j].y
    if ((yi > y) !== (yj > y)) {
      const intersectX = ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (x < intersectX) inside = !inside
    }
    j = i
  }
  return inside
}

function inPolygon(x: number, y: number, shape: SampleShape): boolean {
  return polygonContains(x, y, shape.freeform!.points)
}

export function pointInShape(x: number, y: number, shape: SampleShape, exclusionZones?: Point[][]): boolean {
  let inside = false
  if (shape.type === 'rectangle') inside = inRect(x, y, shape)
  else if (shape.type === 'circle') inside = inCircle(x, y, shape)
  else if (shape.type === 'freeform') inside = inPolygon(x, y, shape)
  if (!inside) return false
  if (exclusionZones) {
    for (const zone of exclusionZones) {
      if (polygonContains(x, y, zone)) return false
    }
  }
  return true
}

// ── Region splitting ───────────────────────────────────────────────────────────

function splitRegion(
  bounds: [number, number, number, number],
  maxW: number,
  maxH: number,
  tileOverlap: number,
): [number, number, number, number][] {
  const [xMin, yMin, xMax, yMax] = bounds
  // How far to advance the origin between adjacent tiles
  const stepW = Math.max(1, maxW * (1 - tileOverlap))
  const stepH = Math.max(1, maxH * (1 - tileOverlap))
  const sampleW = xMax - xMin
  const sampleH = yMax - yMin
  const cols = Math.max(1, Math.ceil(sampleW / stepW))
  const rows = Math.max(1, Math.ceil(sampleH / stepH))
  const tiles: [number, number, number, number][] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const txMin = xMin + col * stepW
      const tyMin = yMin + row * stepH
      const txMax = Math.min(txMin + maxW, xMax)
      const tyMax = Math.min(tyMin + maxH, yMax)
      tiles.push([txMin, tyMin, txMax, tyMax])
    }
  }
  return tiles
}

// ── Single pass ────────────────────────────────────────────────────────────────

function generatePass(
  passNumber: number,
  region: [number, number, number, number],
  effStepX: number,
  effStepY: number,
  shape: SampleShape,
  exclusionZones?: Point[][],
  gridOrigin?: { x: number; y: number },
): ScanPass {
  const [xMin, yMin, xMax, yMax] = region

  // When a global grid origin is provided (e.g. for centred circles), snap the
  // starting position to the first grid line that falls within this region.
  const ox = gridOrigin ? gridOrigin.x + Math.ceil((xMin - gridOrigin.x) / effStepX) * effStepX : xMin
  const oy = gridOrigin ? gridOrigin.y + Math.ceil((yMin - gridOrigin.y) / effStepY) * effStepY : yMin

  let nx = Math.max(1, Math.floor((xMax - ox) / effStepX) + 1)
  let ny = Math.max(1, Math.floor((yMax - oy) / effStepY) + 1)

  if (nx > 1 && ox + (nx - 1) * effStepX > xMax + 1e-9) nx--
  if (ny > 1 && oy + (ny - 1) * effStepY > yMax + 1e-9) ny--

  const gridPoints: { x: number; y: number }[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const px = ox + i * effStepX
      const py = oy + j * effStepY
      if (pointInShape(px, py, shape, exclusionZones)) {
        gridPoints.push({ x: Math.round(px * 1e4) / 1e4, y: Math.round(py * 1e4) / 1e4 })
      }
    }
  }

  const spanX = nx > 1 ? (nx - 1) * effStepX : 0
  const spanY = ny > 1 ? (ny - 1) * effStepY : 0
  const areaMm2 = (spanX / 1000) * (spanY / 1000)

  return {
    pass_number: passNumber,
    region: {
      x_min: Math.round(xMin * 1e4) / 1e4,
      y_min: Math.round(yMin * 1e4) / 1e4,
      x_max: Math.round(xMax * 1e4) / 1e4,
      y_max: Math.round(yMax * 1e4) / 1e4,
    },
    start_point: { x: Math.round(ox * 1e4) / 1e4, y: Math.round(oy * 1e4) / 1e4 },
    delta_x: Math.round(effStepX * 1e4) / 1e4,
    delta_y: Math.round(effStepY * 1e4) / 1e4,
    nx,
    ny,
    total_points: gridPoints.length,
    area_mm2: Math.round(areaMm2 * 1e6) / 1e6,
    grid_points: gridPoints,
  }
}

// ── Shape inset ────────────────────────────────────────────────────────────────

function signedArea(pts: Point[]): number {
  let area = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return area / 2
}

export function insetPolygon(pts: Point[], offset: number): Point[] {
  const n = pts.length
  if (n < 3) return pts
  // Ensure CCW winding so left-normals point inward
  const sa = signedArea(pts)
  const ordered = sa < 0 ? [...pts].reverse() : pts
  const result: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = ordered[(i - 1 + n) % n]
    const curr = ordered[i]
    const next = ordered[(i + 1) % n]
    const e1 = { x: curr.x - prev.x, y: curr.y - prev.y }
    const e2 = { x: next.x - curr.x, y: next.y - curr.y }
    const len1 = Math.sqrt(e1.x ** 2 + e1.y ** 2) || 1
    const len2 = Math.sqrt(e2.x ** 2 + e2.y ** 2) || 1
    // Left normal = inward for CCW polygon
    const ni1 = { x: -e1.y / len1, y: e1.x / len1 }
    const ni2 = { x: -e2.y / len2, y: e2.x / len2 }
    const bis = { x: ni1.x + ni2.x, y: ni1.y + ni2.y }
    const bisLen = Math.sqrt(bis.x ** 2 + bis.y ** 2)
    if (bisLen < 1e-9) {
      result.push({ x: curr.x + ni1.x * offset, y: curr.y + ni1.y * offset })
    } else {
      const scale = offset / bisLen
      result.push({ x: curr.x + bis.x * scale, y: curr.y + bis.y * scale })
    }
  }
  return sa < 0 ? result.reverse() : result
}

function insetShape(shape: SampleShape, offsetUm: number): SampleShape {
  if (offsetUm <= 0) return shape
  if (shape.type === 'rectangle' && shape.rect) {
    const r = shape.rect
    return {
      type: 'rectangle',
      rect: {
        x: r.x + offsetUm,
        y: r.y + offsetUm,
        width: Math.max(0, r.width - 2 * offsetUm),
        height: Math.max(0, r.height - 2 * offsetUm),
      },
    }
  }
  if (shape.type === 'circle' && shape.circle) {
    const c = shape.circle
    return { type: 'circle', circle: { ...c, radius: Math.max(0, c.radius - offsetUm) } }
  }
  if (shape.type === 'freeform' && shape.freeform) {
    return { type: 'freeform', freeform: { points: insetPolygon(shape.freeform.points, offsetUm) } }
  }
  return shape
}

// ── Shape area helpers ─────────────────────────────────────────────────────────

function polygonArea(pts: Point[]): number {
  return Math.abs(signedArea(pts))
}

function shapeArea(shape: SampleShape): number {
  if (shape.type === 'rectangle' && shape.rect) {
    return shape.rect.width * shape.rect.height
  }
  if (shape.type === 'circle' && shape.circle) {
    return Math.PI * shape.circle.radius ** 2
  }
  if (shape.type === 'freeform' && shape.freeform) {
    return polygonArea(shape.freeform.points)
  }
  return 0
}

// ── Total-mode parameter calculation ──────────────────────────────────────────

export interface TotalModeCalc {
  nx: number
  ny: number
  stepX: number  // µm
  stepY: number  // µm
}

/**
 * Given a target total dot count, compute Nx/Ny and step sizes that will
 * yield approximately that many points after accounting for inner offset,
 * shape geometry (not just bounding box), and exclusion zones.
 */
export function calcTotalModeParams(
  shape: SampleShape,
  targetTotal: number,
  innerOffsetUm: number,
  exclusionZones: ExclusionZone[],
): TotalModeCalc {
  const effectiveShape = insetShape(shape, innerOffsetUm)
  const [xMin, yMin, xMax, yMax] = getBoundingBox(effectiveShape)
  const W = Math.max(1, xMax - xMin)
  const H = Math.max(1, yMax - yMin)

  // Shape area vs bbox area — correct for circles and freeforms where bbox has empty corners
  const bboxArea = W * H
  const sArea = shapeArea(effectiveShape)
  const exclArea = exclusionZones.reduce((s, z) => s + polygonArea(z.points), 0)
  const effectiveArea = Math.max(1, sArea - Math.min(exclArea, sArea * 0.99))
  const bboxFraction = Math.min(1, effectiveArea / bboxArea)

  // Scale up target so that after filtering by shape+exclusions we get ~targetTotal dots
  const adjustedTarget = Math.max(4, Math.round(targetTotal / Math.max(0.01, bboxFraction)))

  const nx = Math.max(2, Math.round(Math.sqrt(adjustedTarget * W / H)))
  const ny = Math.max(2, Math.round(Math.sqrt(adjustedTarget * H / W)))

  return {
    nx,
    ny,
    stepX: W / (nx - 1),
    stepY: H / (ny - 1),
  }
}

// ── Public entry point ─────────────────────────────────────────────────────────

export function generateScanGrid(
  shape: SampleShape,
  scanParams: ScanParameters,
  stage: StageConstraints,
  exclusionZones?: ExclusionZone[],
  innerOffsetUm = 0,
): ScanResult {
  const warnings: string[] = []

  const effStepX = scanParams.step_x * (1 - scanParams.overlap)
  const effStepY = scanParams.step_y * (1 - scanParams.overlap)

  if (effStepX <= 0 || effStepY <= 0) {
    throw new Error('Effective step size must be positive (reduce overlap)')
  }
  if (scanParams.step_x < 1 || scanParams.step_y < 1) {
    warnings.push('Step size < 1 µm — may exceed hardware positioning precision.')
  }

  const bounds = getBoundingBox(shape)
  const [xMin, yMin, xMax, yMax] = bounds
  const totalW = xMax - xMin
  const totalH = yMax - yMin

  const tileOverlap = stage.tile_overlap ?? 0
  const needsSplit = totalW > stage.max_scan_width || totalH > stage.max_scan_height

  let regions: [number, number, number, number][]
  const splitWarningArea = needsSplit
    ? `Sample area (${(totalW / 1000).toFixed(2)} mm × ${(totalH / 1000).toFixed(2)} mm) exceeds ` +
      `stage scan limit (${(stage.max_scan_width / 1000).toFixed(0)} mm × ` +
      `${(stage.max_scan_height / 1000).toFixed(0)} mm). `
    : null
  if (needsSplit) {
    regions = splitRegion(bounds, stage.max_scan_width, stage.max_scan_height, tileOverlap)
  } else {
    regions = [bounds]
  }

  const exZonePts = exclusionZones?.map((z) => z.points)
  const effectiveShape = insetShape(shape, innerOffsetUm)
  // Clip each tile region to the inset shape's bbox so the grid starts exactly at the offset boundary
  const effectiveBounds = innerOffsetUm > 0 ? getBoundingBox(effectiveShape) : null

  // For circles, centre the grid on the circle origin so that slack space is
  // distributed equally on all sides (odd count: a point sits on the centre;
  // even count: the four centre cells share their common corner at the origin).
  let gridOrigin: { x: number; y: number } | undefined
  if (effectiveShape.type === 'circle' && effectiveShape.circle) {
    const c = effectiveShape.circle
    const bb = getBoundingBox(effectiveShape)
    let nx = Math.max(1, Math.floor((bb[2] - bb[0]) / effStepX) + 1)
    let ny = Math.max(1, Math.floor((bb[3] - bb[1]) / effStepY) + 1)
    if (nx > 1 && bb[0] + (nx - 1) * effStepX > bb[2] + 1e-9) nx--
    if (ny > 1 && bb[1] + (ny - 1) * effStepY > bb[3] + 1e-9) ny--
    gridOrigin = {
      x: c.cx - (nx - 1) * effStepX / 2,
      y: c.cy - (ny - 1) * effStepY / 2,
    }
  }

  const rawPasses: ScanPass[] = regions.map((region, i) => {
    const r: [number, number, number, number] = effectiveBounds
      ? [
          Math.max(region[0], effectiveBounds[0]),
          Math.max(region[1], effectiveBounds[1]),
          Math.min(region[2], effectiveBounds[2]),
          Math.min(region[3], effectiveBounds[3]),
        ]
      : region
    return generatePass(i + 1, r, effStepX, effStepY, effectiveShape, exZonePts, gridOrigin)
  })

  // Deduplicate: remove points already claimed by an earlier tile
  const seenPts = new Set<string>()
  const dedupedPasses = rawPasses.map((pass) => {
    const unique = pass.grid_points.filter((pt) => {
      const key = `${pt.x},${pt.y}`
      if (seenPts.has(key)) return false
      seenPts.add(key)
      return true
    })
    return { ...pass, grid_points: unique, total_points: unique.length }
  })

  // Remove tiles where no scan point falls inside the shape, then renumber
  const passes: ScanPass[] = dedupedPasses
    .filter((p) => p.total_points > 0)
    .map((p, i) => ({ ...p, pass_number: i + 1 }))

  if (splitWarningArea) {
    warnings.push(
      splitWarningArea +
      `Scan split into ${passes.length} tile${passes.length !== 1 ? 's' : ''}. ` +
      'Reposition the stage between tiles.',
    )
  }

  const totalPoints = passes.reduce((s, p) => s + p.total_points, 0)
  const totalAreaMm2 = passes.reduce((s, p) => s + p.area_mm2, 0)

  if (totalPoints === 0) {
    warnings.push(
      'No scan points generated — check that the shape is valid and step size is smaller than the sample dimensions.',
    )
  } else if (totalPoints > 50_000) {
    warnings.push(`Very large scan: ${totalPoints.toLocaleString()} points. This will take a very long time.`)
  } else if (totalPoints > 10_000) {
    warnings.push(`Large scan: ${totalPoints.toLocaleString()} points. Estimated long scan time.`)
  }

  const estimatedTimeMinutes = (totalPoints * stage.time_per_point_seconds) / 60

  return {
    passes,
    total_points: totalPoints,
    total_area_mm2: Math.round(totalAreaMm2 * 1e6) / 1e6,
    warnings,
    estimated_time_minutes: Math.round(estimatedTimeMinutes * 10) / 10,
    requires_multiple_passes: passes.length > 1,
  }
}
