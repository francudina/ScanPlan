import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Arc,
  Circle,
  Group,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  DrawMode,
  DrawState,
  ExclusionZone,
  FrameSegment,
  Point,
  RotationOptimum,
  SampleShape,
  ScanResult,
  SnapshotInfo,
  Viewport,
} from '../../types/scan'
import {
  fitViewport,
  pointInPolygon,
  pointerToUm,
  shapeBoundingBox,
  umToPixel,
  zoomViewport,
} from '../../utils/geometry'
import { type DisplayUnit, fmtAreaDisplay, fmtDisplay, umToDisplay } from '../../utils/units'

// Pass colours for multi-pass scans
const PASS_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#06b6d4']


// ── Polygon area (shoelace, µm²) ──────────────────────────────────────────────

function polygonAreaUm2(pts: Point[]): number {
  let area = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

// ── Point-to-segment distance (pixels) ────────────────────────────────────────

function pointToSegDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.sqrt((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2)
}

interface Props {
  shape: SampleShape | null
  scanResult: ScanResult | null
  drawMode: DrawMode
  darkMode: boolean
  displayUnit: DisplayUnit
  focusMode: boolean
  hoveredPass: number | null
  onPassHover: (pass: number | null) => void
  onShapeChange: (shape: SampleShape) => void
  rotationOptimum: RotationOptimum | null
  rotationTab?: 'current' | 'rotated'
  rotatedScanResult?: ScanResult | null
  exclusionZones: ExclusionZone[]
  onExclusionZoneAdd: (points: Point[]) => void
  onRegisterSnapshot: (fn: () => SnapshotInfo | null) => void
  frameEnabled?: boolean
  frameSegments?: FrameSegment[]
}

// ── Grid lines helper ──────────────────────────────────────────────────────────

/** Choose the most readable unit for the current grid spacing (µm). */
function autoGridUnit(spacingUm: number): DisplayUnit {
  if (spacingUm >= 10_000) return 'cm'
  if (spacingUm >= 1_000) return 'mm'
  if (spacingUm >= 1)     return 'µm'
  return 'nm'
}

/** Returns the current grid line spacing in µm (same logic as CoordGrid). */
function calcGridSpacing(vp: Viewport): number {
  const rawSpacing = 100 / vp.scale
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawSpacing)))
  const candidates = [1, 2, 5, 10].map((m) => m * magnitude)
  return candidates.find((c) => c * vp.scale >= 60) ?? candidates[candidates.length - 1]
}

/** Snaps a µm coordinate to the nearest grid intersection. */
function snapToGrid(um: Point, spacing: number): Point {
  return {
    x: Math.round(um.x / spacing) * spacing,
    y: Math.round(um.y / spacing) * spacing,
  }
}

/** Pixel distance within which the cursor snaps to a grid crossing. */
const SNAP_THRESHOLD_PX = 16

/**
 * Returns the snapped µm point if the cursor is within SNAP_THRESHOLD_PX of a
 * grid crossing, otherwise returns the raw µm position.
 * Also returns whether snapping is active so the caller can show the indicator.
 */
function resolveSnap(
  pos: { x: number; y: number },
  vp: Viewport,
): { um: Point; snapping: boolean } {
  const raw = pointerToUm(pos.x, pos.y, vp)
  const spacing = calcGridSpacing(vp)
  const snapped = snapToGrid(raw, spacing)
  const distPx = Math.hypot(
    umToPixel(snapped.x, vp.left, vp.scale) - pos.x,
    umToPixel(snapped.y, vp.top, vp.scale) - pos.y,
  )
  return distPx < SNAP_THRESHOLD_PX
    ? { um: snapped, snapping: true }
    : { um: raw, snapping: false }
}

function CoordGrid({ vp, width, height, darkMode }: { vp: Viewport; width: number; height: number; darkMode: boolean }) {
  const gridColor = darkMode ? '#2e2e2e' : '#e5e7eb'
  const labelColor = darkMode ? '#555' : '#9ca3af'

  // Pick a sensible grid spacing in microns
  const rawSpacing = 100 / vp.scale // ~100 px apart
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawSpacing)))
  const candidates = [1, 2, 5, 10].map((m) => m * magnitude)
  const spacing = candidates.find((c) => c * vp.scale >= 60) ?? candidates[candidates.length - 1]

  // Automatically pick mm / µm / nm based on zoom level — sidebar unit is unaffected
  const gridUnit = autoGridUnit(spacing)

  // Decimal places: 0 when spacing is a whole number in the chosen unit, more when sub-unit
  const spacingInUnit = umToDisplay(spacing, gridUnit)
  const labelDecimals = spacingInUnit >= 1 ? 0 : Math.ceil(-Math.log10(spacingInUnit) + 1e-10)

  const lines: React.ReactElement[] = []
  const xStart = Math.floor(vp.left / spacing) * spacing
  const yStart = Math.floor(vp.top / spacing) * spacing

  for (let x = xStart; x < vp.left + width / vp.scale; x += spacing) {
    const px = umToPixel(x, vp.left, vp.scale)
    lines.push(
      <Line key={`vx${x}`} points={[px, 0, px, height]} stroke={gridColor} strokeWidth={1} />,
    )
    lines.push(
      <Text
        key={`tx${x}`}
        x={px + 2}
        y={4}
        text={fmtDisplay(x, gridUnit, labelDecimals)}
        fontSize={11}
        fill={labelColor}
        listening={false}
      />,
    )
  }
  for (let y = yStart; y < vp.top + height / vp.scale; y += spacing) {
    const py = umToPixel(y, vp.top, vp.scale)
    lines.push(
      <Line key={`hy${y}`} points={[0, py, width, py]} stroke={gridColor} strokeWidth={1} />,
    )
    lines.push(
      <Text
        key={`ty${y}`}
        x={4}
        y={py + 2}
        text={fmtDisplay(y, gridUnit, labelDecimals)}
        fontSize={11}
        fill={labelColor}
        listening={false}
      />,
    )
  }
  return <>{lines}</>
}

// ── Shape renderer ─────────────────────────────────────────────────────────────

function ShapeRenderer({
  shape,
  vp,
}: {
  shape: SampleShape
  vp: Viewport
}) {
  const toX = (um: number) => umToPixel(um, vp.left, vp.scale)
  const toY = (um: number) => umToPixel(um, vp.top, vp.scale)

  if (shape.type === 'rectangle' && shape.rect) {
    const r = shape.rect
    const pts: Point[] = [
      { x: r.x,           y: r.y            },
      { x: r.x + r.width, y: r.y            },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x,           y: r.y + r.height },
    ]
    return (
      <>
        <Rect
          x={toX(r.x)}
          y={toY(r.y)}
          width={r.width * vp.scale}
          height={r.height * vp.scale}
          fill="rgba(59,130,246,0.10)"
          stroke="#2563eb"
          strokeWidth={1.5}
          listening={false}
        />
        {/* Segment labels — pushed to outside of shape */}
        {(() => {
          const centX = pts.reduce((s, p) => s + toX(p.x), 0) / pts.length
          const centY = pts.reduce((s, p) => s + toY(p.y), 0) / pts.length
          return pts.map((p, i) => {
            const next = pts[(i + 1) % pts.length]
            const x1 = toX(p.x), y1 = toY(p.y)
            const x2 = toX(next.x), y2 = toY(next.y)
            const mx = (x1 + x2) / 2
            const my = (y1 + y2) / 2
            const edgeDx = x2 - x1, edgeDy = y2 - y1
            const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy)
            const nx = edgeLen > 0 ? edgeDx / edgeLen : 1
            const ny = edgeLen > 0 ? edgeDy / edgeLen : 0
            let perpX = -ny, perpY = nx
            // Flip if pointing toward centroid (we want outward)
            if (perpX * (mx - centX) + perpY * (my - centY) < 0) { perpX = -perpX; perpY = -perpY }
            let angle = Math.atan2(edgeDy, edgeDx) * 180 / Math.PI
            if (angle > 90) angle -= 180
            else if (angle <= -90) angle += 180
            const nextIdx = (i + 1) % pts.length
            const label = `P${i + 1} – P${nextIdx + 1}`
            const OFFSET = 14
            const estW = label.length * 5.2
            return (
              <Text
                key={`seg-lbl-${i}`}
                x={mx + perpX * OFFSET}
                y={my + perpY * OFFSET}
                text={label}
                fontSize={9}
                fill="#2563eb"
                opacity={0.7}
                rotation={angle}
                offsetX={estW / 2}
                offsetY={4.5}
                listening={false}
              />
            )
          })
        })()}
        {/* Vertex dots + labels */}
        {pts.map((p, i) => (
          <React.Fragment key={`vtx-${i}`}>
            <Circle
              x={toX(p.x)}
              y={toY(p.y)}
              radius={5}
              fill="white"
              stroke="#2563eb"
              strokeWidth={2}
              listening={false}
            />
            <Text
              x={toX(p.x) + 8}
              y={toY(p.y) - 10}
              text={`P${i + 1}`}
              fontSize={11}
              fontStyle="bold"
              fill="#1d4ed8"
              listening={false}
            />
          </React.Fragment>
        ))}
      </>
    )
  }

  if (shape.type === 'circle' && shape.circle) {
    const c = shape.circle
    return (
      <Circle
        x={toX(c.cx)}
        y={toY(c.cy)}
        radius={c.radius * vp.scale}
        fill="rgba(59,130,246,0.10)"
        stroke="#2563eb"
        strokeWidth={1.5}
        listening={false}
      />
    )
  }

  if (shape.type === 'freeform' && shape.freeform) {
    const pts = shape.freeform.points
    const flatPts = pts.flatMap((p) => [toX(p.x), toY(p.y)])
    return (
      <>
        {/* Filled polygon */}
        <Line
          points={flatPts}
          closed
          fill="rgba(59,130,246,0.10)"
          stroke="#2563eb"
          strokeWidth={1.5}
          listening={false}
        />
        {/* Segment labels — pushed to outside of polygon */}
        {(() => {
          const centX = pts.reduce((s, p) => s + toX(p.x), 0) / pts.length
          const centY = pts.reduce((s, p) => s + toY(p.y), 0) / pts.length
          return pts.map((p, i) => {
            const next = pts[(i + 1) % pts.length]
            const x1 = toX(p.x), y1 = toY(p.y)
            const x2 = toX(next.x), y2 = toY(next.y)
            const mx = (x1 + x2) / 2
            const my = (y1 + y2) / 2
            const edgeDx = x2 - x1
            const edgeDy = y2 - y1
            const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy)
            const nx = edgeLen > 0 ? edgeDx / edgeLen : 1
            const ny = edgeLen > 0 ? edgeDy / edgeLen : 0
            let perpX = -ny
            let perpY = nx
            // Flip if pointing toward centroid (we want outward)
            if (perpX * (mx - centX) + perpY * (my - centY) < 0) { perpX = -perpX; perpY = -perpY }
            let angle = Math.atan2(edgeDy, edgeDx) * 180 / Math.PI
            if (angle > 90) angle -= 180
            else if (angle <= -90) angle += 180
            const nextIdx = (i + 1) % pts.length
            const label = `P${i + 1} – P${nextIdx + 1}`
            const OFFSET = 14
            const estW = label.length * 5.2
            return (
              <Text
                key={`seg-lbl-${i}`}
                x={mx + perpX * OFFSET}
                y={my + perpY * OFFSET}
                text={label}
                fontSize={9}
                fill="#2563eb"
                opacity={0.7}
                rotation={angle}
                offsetX={estW / 2}
                offsetY={4.5}
                listening={false}
              />
            )
          })
        })()}
        {/* Vertex dots + labels */}
        {pts.map((p, i) => (
          <React.Fragment key={`vtx-${i}`}>
            <Circle
              x={toX(p.x)}
              y={toY(p.y)}
              radius={5}
              fill="white"
              stroke="#2563eb"
              strokeWidth={2}
              listening={false}
            />
            <Text
              x={toX(p.x) + 8}
              y={toY(p.y) - 10}
              text={`P${i + 1}`}
              fontSize={11}
              fontStyle="bold"
              fill="#1d4ed8"
              listening={false}
            />
          </React.Fragment>
        ))}
      </>
    )
  }

  return null
}

// ── Shape centroid helper ──────────────────────────────────────────────────────

function getShapeCentroidUm(shape: SampleShape): { x: number; y: number } {
  if (shape.type === 'circle' && shape.circle) {
    return { x: shape.circle.cx, y: shape.circle.cy }
  }
  if (shape.type === 'rectangle' && shape.rect) {
    const r = shape.rect
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }
  if (shape.type === 'freeform' && shape.freeform) {
    const pts = shape.freeform.points
    if (pts.length > 0) {
      return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      }
    }
  }
  return { x: 0, y: 0 }
}

// ── Scan grid renderer ─────────────────────────────────────────────────────────

// Minimum screen-space dot spacing (px) before switching to grid-line mode
const DOT_SPACING_THRESHOLD = 4
// Maximum dots to render as individual circles after viewport culling
const DOT_RENDER_CAP = 5_000

function ScanGridRenderer({
  scanResult,
  vp,
  width,
  height,
  focusMode,
  hoveredPass,
  onPassHover,
  skipHoverEvents = false,
  cullBounds,
}: {
  scanResult: ScanResult
  vp: Viewport
  width: number
  height: number
  focusMode: boolean
  hoveredPass: number | null
  onPassHover: (pass: number | null) => void
  skipHoverEvents?: boolean
  /** Override axis-aligned culling bounds (µm). Use when tiles are in a rotated frame. */
  cullBounds?: { xMin: number; xMax: number; yMin: number; yMax: number }
}) {
  const toX = (um: number) => umToPixel(um, vp.left, vp.scale)
  const toY = (um: number) => umToPixel(um, vp.top, vp.scale)

  // Viewport bounds in µm with a small buffer so dots don't pop in/out at edges.
  // When rendering inside a rotated Group, the caller must pass rotated-frame cullBounds.
  const buf = 16 / vp.scale
  const visXMin = cullBounds ? cullBounds.xMin - buf : vp.left - buf
  const visXMax = cullBounds ? cullBounds.xMax + buf : vp.left + width  / vp.scale + buf
  const visYMin = cullBounds ? cullBounds.yMin - buf : vp.top  - buf
  const visYMax = cullBounds ? cullBounds.yMax + buf : vp.top  + height / vp.scale + buf

  const elements: React.ReactElement[] = []

  const visiblePasses = scanResult.passes.filter((p) => p.grid_points.length > 0)

  visiblePasses.forEach((pass, passIdx) => {
    const color = PASS_COLORS[passIdx % PASS_COLORS.length]
    const isHovered = focusMode && hoveredPass === pass.pass_number
    const isDimmed = focusMode && hoveredPass !== null && hoveredPass !== pass.pass_number
    const opacity = isDimmed ? 0.15 : isHovered ? 1 : 0.85
    const strokeWidth = isHovered ? 2.5 : 1.5

    // Invisible hit rect for hover detection
    elements.push(
      <Rect
        key={`hit-${passIdx}`}
        x={toX(pass.region.x_min)}
        y={toY(pass.region.y_min)}
        width={(pass.region.x_max - pass.region.x_min) * vp.scale}
        height={(pass.region.y_max - pass.region.y_min) * vp.scale}
        fill="transparent"
        onMouseEnter={skipHoverEvents ? undefined : () => onPassHover(pass.pass_number)}
        onMouseLeave={skipHoverEvents ? undefined : () => onPassHover(null)}
      />,
    )

    // Pass region outline
    elements.push(
      <Rect
        key={`region-${passIdx}`}
        x={toX(pass.region.x_min)}
        y={toY(pass.region.y_min)}
        width={(pass.region.x_max - pass.region.x_min) * vp.scale}
        height={(pass.region.y_max - pass.region.y_min) * vp.scale}
        stroke={color}
        strokeWidth={strokeWidth}
        dash={[8, 4]}
        fill={isHovered ? color + '15' : 'transparent'}
        opacity={opacity}
        listening={false}
      />,
    )

    // Pass label
    elements.push(
      <Text
        key={`label-${passIdx}`}
        x={toX(pass.region.x_min) + 4}
        y={toY(pass.region.y_min) + 4}
        text={`Tile ${passIdx + 1}`}
        fontSize={isHovered ? 13 : 11}
        fill={color}
        fontStyle="bold"
        opacity={opacity}
        listening={false}
      />,
    )

    // ── Dots vs grid lines ─────────────────────────────────────────────────────
    // Show individual dots only when they are visually separated (zoom-dependent)
    // and after viewport culling the count stays manageable.
    const dotSpacePx = Math.min(pass.delta_x, pass.delta_y) * vp.scale

    let useDots = false
    let visiblePts: Array<{ pt: Point; idx: number }> = []

    if (dotSpacePx >= DOT_SPACING_THRESHOLD && hoveredPass === pass.pass_number) {
      // Collect viewport-visible dots only for the focused pass
      for (let idx = 0; idx < pass.grid_points.length; idx++) {
        const pt = pass.grid_points[idx]
        if (pt.x >= visXMin && pt.x <= visXMax && pt.y >= visYMin && pt.y <= visYMax) {
          visiblePts.push({ pt, idx })
          if (visiblePts.length > DOT_RENDER_CAP) break
        }
      }
      useDots = visiblePts.length <= DOT_RENDER_CAP
    }

    if (useDots) {
      const r = Math.max(3.5, Math.min(7, vp.scale * 6))
      for (const { pt, idx } of visiblePts) {
        elements.push(
          <Circle
            key={`pt-${passIdx}-${idx}`}
            x={toX(pt.x)}
            y={toY(pt.y)}
            radius={r}
            fill="#facc15"
            stroke="#92400e"
            strokeWidth={1.5}
            opacity={opacity * 0.95}
            listening={false}
          />,
        )
      }
    } else {
      // Grid-line fallback — cull to visible column/row index range
      const r = pass.region
      const stepXpx = pass.delta_x * vp.scale
      const stepYpx = pass.delta_y * vp.scale

      if (stepXpx >= 1) {
        const iMin = Math.max(0, Math.floor((visXMin - r.x_min) / pass.delta_x))
        const iMax = Math.min(pass.nx - 1, Math.ceil((visXMax - r.x_min) / pass.delta_x))
        for (let i = iMin; i <= iMax; i++) {
          elements.push(
            <Line
              key={`vline-${passIdx}-${i}`}
              points={[toX(r.x_min + i * pass.delta_x), toY(r.y_min), toX(r.x_min + i * pass.delta_x), toY(r.y_max)]}
              stroke={color}
              strokeWidth={0.5}
              opacity={opacity * 0.5}
              listening={false}
            />,
          )
        }
      }
      if (stepYpx >= 1) {
        const jMin = Math.max(0, Math.floor((visYMin - r.y_min) / pass.delta_y))
        const jMax = Math.min(pass.ny - 1, Math.ceil((visYMax - r.y_min) / pass.delta_y))
        for (let j = jMin; j <= jMax; j++) {
          elements.push(
            <Line
              key={`hline-${passIdx}-${j}`}
              points={[toX(r.x_min), toY(r.y_min + j * pass.delta_y), toX(r.x_max), toY(r.y_min + j * pass.delta_y)]}
              stroke={color}
              strokeWidth={0.5}
              opacity={opacity * 0.5}
              listening={false}
            />,
          )
        }
      }

      // Corner markers so the region is always identifiable when zoomed out
      const corners = [
        { x: r.x_min, y: r.y_min },
        { x: r.x_max, y: r.y_min },
        { x: r.x_max, y: r.y_max },
        { x: r.x_min, y: r.y_max },
      ]
      corners.forEach((c, ci) => {
        elements.push(
          <Circle
            key={`corner-${passIdx}-${ci}`}
            x={toX(c.x)}
            y={toY(c.y)}
            radius={4}
            fill={color}
            opacity={opacity}
            listening={false}
          />,
        )
      })
    }
  })

  return <>{elements}</>
}

// ── Exclusion zone renderer ────────────────────────────────────────────────────

function ExclusionZoneRenderer({ zones, vp }: { zones: ExclusionZone[]; vp: Viewport }) {
  const toX = (um: number) => umToPixel(um, vp.left, vp.scale)
  const toY = (um: number) => umToPixel(um, vp.top, vp.scale)
  return (
    <>
      {zones.map((zone, zi) => {
        if (zone.points.length < 3) return null
        const flat = zone.points.flatMap((p) => [toX(p.x), toY(p.y)])
        const cx = zone.points.reduce((s, p) => s + toX(p.x), 0) / zone.points.length
        const cy = zone.points.reduce((s, p) => s + toY(p.y), 0) / zone.points.length
        return (
          <React.Fragment key={zone.id}>
            <Line
              points={flat}
              closed
              fill="rgba(239,68,68,0.18)"
              stroke="#ef4444"
              strokeWidth={1.5}
              dash={[5, 3]}
              listening={false}
            />
            <Text
              x={cx}
              y={cy}
              text={`E${zi + 1}`}
              fontSize={10}
              fontStyle="bold"
              fill="#ef4444"
              opacity={0.8}
              offsetX={8}
              offsetY={5}
              listening={false}
            />
          </React.Fragment>
        )
      })}
    </>
  )
}

// ── Frame renderer ─────────────────────────────────────────────────────────────

const FRAME_COLORS = ['#f97316','#ec4899','#8b5cf6','#06b6d4','#22c55e','#eab308','#ef4444','#3b82f6']

function FrameRenderer({
  shape, segments, vp, enabled,
}: {
  shape: SampleShape; segments: FrameSegment[]; vp: Viewport; enabled: boolean
}) {
  if (!enabled || segments.length === 0) return null

  const toX = (um: number) => (um - vp.left) * vp.scale
  const toY = (um: number) => (um - vp.top) * vp.scale
  const px = (um: number) => um * vp.scale

  if (shape.type === 'rectangle' && shape.rect) {
    const r = shape.rect
    const x0 = toX(r.x), y0 = toY(r.y)
    const W = px(r.width), H = px(r.height)
    return (
      <Group listening={false}>
        {segments.map((seg, i) => {
          const color = FRAME_COLORS[i % FRAME_COLORS.length]
          const w = px(seg.widthUm)
          if (w < 0.5) return null
          let rx = x0, ry = y0, rw = W, rh = H
          if (seg.side === 'top')         { ry = y0 - w; rh = w }
          else if (seg.side === 'right')  { rx = x0 + W; rw = w }
          else if (seg.side === 'bottom') { ry = y0 + H; rh = w }
          else if (seg.side === 'left')   { rx = x0 - w; rw = w }
          const midX = rx + rw / 2, midY = ry + rh / 2
          return (
            <React.Fragment key={seg.id}>
              <Rect x={rx} y={ry} width={rw} height={rh} fill={color} opacity={0.25} listening={false} />
              <Rect x={rx} y={ry} width={rw} height={rh} stroke={color} strokeWidth={1} opacity={0.7} listening={false} />
              <Text x={midX - 8} y={midY - 6} text={seg.label} fontSize={10} fontStyle="bold" fill={color} listening={false} />
            </React.Fragment>
          )
        })}
      </Group>
    )
  }

  if (shape.type === 'circle' && shape.circle) {
    const c = shape.circle
    const cx = toX(c.cx), cy = toY(c.cy)
    const rInner = px(c.radius)
    return (
      <Group listening={false}>
        {segments.map((seg, i) => {
          const color = FRAME_COLORS[i % FRAME_COLORS.length]
          const w = px(seg.widthUm)
          if (w < 0.5) return null
          return (
            <React.Fragment key={seg.id}>
              <Arc x={cx} y={cy} innerRadius={rInner} outerRadius={rInner + w} angle={360} fill={color} opacity={0.25} listening={false} />
              <Arc x={cx} y={cy} innerRadius={rInner} outerRadius={rInner + w} angle={360} stroke={color} strokeWidth={1} opacity={0.7} listening={false} />
              <Text x={cx - 8} y={cy - rInner - w - 14} text={seg.label} fontSize={10} fontStyle="bold" fill={color} listening={false} />
            </React.Fragment>
          )
        })}
      </Group>
    )
  }

  if (shape.type === 'freeform' && shape.freeform) {
    const pts = shape.freeform.points
    const n = pts.length
    return (
      <Group listening={false}>
        {segments.map((seg, i) => {
          const color = FRAME_COLORS[i % FRAME_COLORS.length]
          const w = px(seg.widthUm)
          if (w < 0.5) return null
          const p0 = pts[i], p1 = pts[(i + 1) % n]
          const x0 = toX(p0.x), y0 = toY(p0.y)
          const x1 = toX(p1.x), y1 = toY(p1.y)
          const dx = x1 - x0, dy = y1 - y0
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len < 1) return null
          const nx = -dy / len, ny = dx / len
          const ox = nx * w, oy = ny * w
          const midX = (x0 + x1) / 2 + ox * 0.5 + nx * 8
          const midY = (y0 + y1) / 2 + oy * 0.5 + ny * 8
          return (
            <React.Fragment key={seg.id}>
              <Line
                points={[x0 + ox, y0 + oy, x1 + ox, y1 + oy]}
                stroke={color} strokeWidth={w} opacity={0.25}
                lineCap="butt" listening={false}
              />
              <Line
                points={[x0 + ox, y0 + oy, x1 + ox, y1 + oy]}
                stroke={color} strokeWidth={1} opacity={0.8}
                lineCap="butt" listening={false}
              />
              <Text x={midX - 8} y={midY - 6} text={seg.label} fontSize={10} fontStyle="bold" fill={color} listening={false} />
            </React.Fragment>
          )
        })}
      </Group>
    )
  }

  return null
}

// ── Drawing preview ────────────────────────────────────────────────────────────

function DrawingPreview({
  drawState,
  vp,
}: {
  drawState: DrawState
  vp: Viewport
}) {
  const toX = (um: number) => umToPixel(um, vp.left, vp.scale)
  const toY = (um: number) => umToPixel(um, vp.top, vp.scale)

  if (drawState.mode === 'drawing_rect') {
    const { startX, startY } = drawState
    return (
      <Rect
        x={toX(startX)}
        y={toY(startY)}
        width={0}
        height={0}
        stroke="#2563eb"
        strokeWidth={2}
        dash={[4, 4]}
        fill="rgba(59,130,246,0.1)"
        listening={false}
      />
    )
  }

  if (drawState.mode === 'drawing_freeform') {
    const pts = drawState.points
    if (pts.length === 0) return null

    const flatPts = pts.flatMap((p) => [toX(p.x), toY(p.y)])
    const anchorIdx = (drawState.anchorIndex !== undefined && drawState.anchorIndex < pts.length)
      ? drawState.anchorIndex
      : undefined

    // Cursor preview line: from anchor point when set, else from last point
    const previewOrigin = anchorIdx !== undefined ? pts[anchorIdx] : pts[pts.length - 1]
    const previewLine = drawState.preview && previewOrigin
      ? [toX(previewOrigin.x), toY(previewOrigin.y), toX(drawState.preview.x), toY(drawState.preview.y)]
      : []

    return (
      <>
        {/* Solid closed line through all drawn points (always visible for 2+) */}
        {pts.length >= 2 && (
          <Line
            points={flatPts}
            closed
            fill={pts.length >= 3 ? 'rgba(59,130,246,0.10)' : 'transparent'}
            stroke="#2563eb"
            strokeWidth={1.5}
            listening={false}
          />
        )}

        {/* Cursor preview line */}
        {previewLine.length > 0 && (
          <Line
            points={previewLine}
            stroke="#2563eb"
            strokeWidth={2}
            dash={[4, 4]}
            listening={false}
          />
        )}

        {/* Segment labels — pushed to outside of polygon */}
        {(() => {
          const centX = pts.reduce((s, p) => s + toX(p.x), 0) / pts.length
          const centY = pts.reduce((s, p) => s + toY(p.y), 0) / pts.length
          return pts.map((p, i) => {
            const next = pts[(i + 1) % pts.length]
            if (i === pts.length - 1 && pts.length < 3) return null
            const x1 = toX(p.x), y1 = toY(p.y)
            const x2 = toX(next.x), y2 = toY(next.y)
            const mx = (x1 + x2) / 2
            const my = (y1 + y2) / 2
            const edgeDx = x2 - x1, edgeDy = y2 - y1
            const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy)
            const nx = edgeLen > 0 ? edgeDx / edgeLen : 1
            const ny = edgeLen > 0 ? edgeDy / edgeLen : 0
            let perpX = -ny, perpY = nx
            // Flip if pointing toward centroid (we want outward)
            if (perpX * (mx - centX) + perpY * (my - centY) < 0) { perpX = -perpX; perpY = -perpY }
            let angle = Math.atan2(edgeDy, edgeDx) * 180 / Math.PI
            if (angle > 90) angle -= 180
            else if (angle <= -90) angle += 180
            const nextIdx = (i + 1) % pts.length
            const label = `P${i + 1} – P${nextIdx + 1}`
            const OFFSET = 14
            const estW = label.length * 5.2
            return (
              <Text
                key={`seg-lbl-${i}`}
                x={mx + perpX * OFFSET}
                y={my + perpY * OFFSET}
                text={label}
                fontSize={9}
                fill="#2563eb"
                opacity={0.7}
                rotation={angle}
                offsetX={estW / 2}
                offsetY={4.5}
                listening={false}
              />
            )
          })
        })()}

        {/* Vertex dots + P labels — same as ShapeRenderer */}
        {pts.map((p, i) => {
          const isAnchor = anchorIdx === i
          return (
            <React.Fragment key={`vtx-${i}`}>
              {/* Anchor pulse ring */}
              {isAnchor && (
                <Circle
                  x={toX(p.x)}
                  y={toY(p.y)}
                  radius={10}
                  fill="rgba(251,191,36,0.25)"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dash={[3, 3]}
                  listening={false}
                />
              )}
              <Circle
                x={toX(p.x)}
                y={toY(p.y)}
                radius={isAnchor ? 6 : 5}
                fill={isAnchor ? '#f59e0b' : 'white'}
                stroke={isAnchor ? '#f59e0b' : '#2563eb'}
                strokeWidth={2}
                listening={false}
              />
              <Text
                x={toX(p.x) + 8}
                y={toY(p.y) - 10}
                text={`P${i + 1}`}
                fontSize={11}
                fontStyle="bold"
                fill={isAnchor ? '#d97706' : '#1d4ed8'}
                listening={false}
              />
            </React.Fragment>
          )
        })}
      </>
    )
  }

  if (drawState.mode === 'drawing_exclusion') {
    const pts = drawState.points
    if (pts.length === 0) return null
    const flat = pts.flatMap((p) => [toX(p.x), toY(p.y)])
    const previewLine = drawState.preview && pts.length > 0
      ? [toX(pts[pts.length - 1].x), toY(pts[pts.length - 1].y), toX(drawState.preview.x), toY(drawState.preview.y)]
      : []
    return (
      <>
        {pts.length >= 2 && (
          <Line
            points={flat}
            closed
            fill={pts.length >= 3 ? 'rgba(239,68,68,0.15)' : 'transparent'}
            stroke="#ef4444"
            strokeWidth={1.5}
            dash={[5, 3]}
            listening={false}
          />
        )}
        {previewLine.length > 0 && (
          <Line points={previewLine} stroke="#ef4444" strokeWidth={1.5} dash={[4, 4]} listening={false} />
        )}
        {pts.map((p, i) => (
          <React.Fragment key={i}>
            <Circle x={toX(p.x)} y={toY(p.y)} radius={4}
              fill="#fca5a5" stroke="#ef4444" strokeWidth={1.5} listening={false} />
          </React.Fragment>
        ))}
      </>
    )
  }

  return null
}

// ── Hover info type ────────────────────────────────────────────────────────────

type HoverInfo =
  | { kind: 'vertex'; index: number; px: number; py: number; umX: number; umY: number }
  | { kind: 'edge'; fromIdx: number; toIdx: number; px: number; py: number; length: number }
  | { kind: 'surface'; surfaceIndex: number; px: number; py: number; areaUm2: number }
  | { kind: 'dot'; px: number; py: number; umX: number; umY: number; pass: number; index: number }

// ── Main component ─────────────────────────────────────────────────────────────

export default function SampleCanvas({
  shape,
  scanResult,
  drawMode,
  darkMode,
  displayUnit,
  focusMode,
  hoveredPass,
  onPassHover,
  onShapeChange,
  rotationOptimum,
  rotationTab,
  rotatedScanResult,
  exclusionZones,
  onExclusionZoneAdd,
  onRegisterSnapshot,
  frameEnabled,
  frameSegments,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [vp, setVp] = useState<Viewport>({ left: -100_000, top: -75_000, scale: 0.004 })
  const vpInitialized = useRef(false)
  const [drawState, setDrawState] = useState<DrawState>({ mode: 'idle' })
  const [panState, setPanState] = useState<{ startX: number; startY: number; vpLeft: number; vpTop: number } | null>(null)
  const [previewRect, setPreviewRect] = useState<{
    x: number; y: number; w: number; h: number
  } | null>(null)
  const [previewCircle, setPreviewCircle] = useState<{
    cx: number; cy: number; r: number
  } | null>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [snapPoint, setSnapPoint] = useState<Point | null>(null)

  // Refs for touch gesture tracking (refs = no stale-closure issues in touch handlers)
  const stageRef = useRef<Konva.Stage>(null)
  const pinchRef = useRef<{
    dist: number; midX: number; midY: number
    startDist: number; startMidX: number; startMidY: number
    gestureMode: 'undecided' | 'zoom' | 'pan'
  } | null>(null)
  const lastTapRef = useRef<number>(0)
  // Flag: we just finished a two-finger gesture — ignore the next single-finger pointerdown
  const afterTwoFingerRef = useRef(false)
  const prevDrawModeRef = useRef<DrawMode>(drawMode)
  const drawStateRef = useRef(drawState)
  drawStateRef.current = drawState
  const vpRef = useRef(vp)
  vpRef.current = vp
  const sizeRef = useRef(size)
  sizeRef.current = size

  // Register snapshot function for PDF export
  useEffect(() => {
    onRegisterSnapshot(() => {
      const dataURL = stageRef.current?.toDataURL({ pixelRatio: 2 }) ?? null
      if (!dataURL) return null
      return { dataURL, vp: vpRef.current, canvasW: sizeRef.current.w, canvasH: sizeRef.current.h }
    })
  }, [onRegisterSnapshot])

  // Responsive canvas sizing
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        const w = Math.floor(width)
        const h = Math.floor(height)
        setSize({ w, h })
        // Centre origin on first real measurement (no shape yet)
        if (!vpInitialized.current && w > 0 && h > 0) {
          vpInitialized.current = true
          const SCALE = 0.004
          setVp({ scale: SCALE, left: -(w / 2) / SCALE, top: -(h / 2) / SCALE })
        }
      }
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Capture stage as a flat image before print so the browser sees one <img>
  // instead of multi-layer <canvas> elements inside clipped flex containers.
  useEffect(() => {
    const beforePrint = () => {
      const stage = stageRef.current
      if (!stage) return
      const dataURL = stage.toDataURL({ pixelRatio: Math.max(window.devicePixelRatio || 1, 2) })
      const img = document.createElement('img')
      img.id = '__print_canvas_img__'
      img.src = dataURL
      img.style.cssText = 'display:block;width:100%;height:auto;'
      const container = stage.container()
      container.appendChild(img)
      container.querySelectorAll('canvas').forEach((c) => (c as HTMLElement).style.display = 'none')
    }
    const afterPrint = () => {
      const stage = stageRef.current
      if (!stage) return
      const container = stage.container()
      container.querySelector('#__print_canvas_img__')?.remove()
      container.querySelectorAll('canvas').forEach((c) => (c as HTMLElement).style.display = '')
    }
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
    }
  }, [])

  // Reset draw state when shape is cleared
  useEffect(() => {
    if (shape === null) setDrawState({ mode: 'idle' })
  }, [shape])


  // Handle draw mode switches — no auto shape conversion; just manage draw state
  useEffect(() => {
    const prev = prevDrawModeRef.current
    prevDrawModeRef.current = drawMode
    if (prev === drawMode) return

    if (drawMode === 'freeform' && shape?.type === 'freeform' && shape.freeform) {
      // Resume drawing an existing freeform shape from its last vertex
      setDrawState({
        mode: 'drawing_freeform',
        points: shape.freeform.points,
        preview: null,
      })
    } else {
      // Any other mode switch: cancel active drawing, keep shape as-is
      setDrawState({ mode: 'idle' })
    }
  }, [drawMode, shape, onShapeChange])

  // Sync sidebar point edits → drawState while in drawing_freeform mode
  useEffect(() => {
    if (shape?.type !== 'freeform' || !shape.freeform) return
    setDrawState((prev) => {
      if (prev.mode !== 'drawing_freeform') return prev
      const newPts = shape.freeform!.points
      if (prev.points.length === newPts.length && prev.points.every((p, i) => p.x === newPts[i].x && p.y === newPts[i].y)) return prev
      return { ...prev, points: newPts }
    })
  }, [shape])

  // ESC cancels active drawing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If anchor is active, just clear the anchor (keep drawing state)
        setDrawState((prev) => {
          if (prev.mode === 'drawing_freeform' && prev.anchorIndex !== undefined) {
            return { ...prev, anchorIndex: undefined }
          }
          return { mode: 'idle' }
        })
        setPreviewRect(null)
        setPreviewCircle(null)
        setPanState(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = e.target.getStage()!
      const pos = stage.getPointerPosition()!

      // Pinch gesture on trackpad — browser sets ctrlKey=true for pinch on all platforms
      if (e.evt.ctrlKey) {
        const cursorUm = pointerToUm(pos.x, pos.y, vp)
        const factor = e.evt.deltaY < 0 ? 1.06 : 1 / 1.06
        setVp((v) => zoomViewport(v, cursorUm.x, cursorUm.y, factor))
        return
      }

      // deltaMode=1 (lines) or =2 (pages) → mouse wheel on Windows/Linux → zoom
      // deltaMode=0 with large stepped deltaY and negligible deltaX → mouse wheel on Mac → zoom
      // Otherwise → trackpad two-finger scroll → pan
      const isMouse =
        e.evt.deltaMode !== 0 ||
        (Math.abs(e.evt.deltaY) >= 40 && Math.abs(e.evt.deltaX) < 2)

      if (isMouse) {
        const cursorUm = pointerToUm(pos.x, pos.y, vp)
        const factor = e.evt.deltaY < 0 ? 1.06 : 1 / 1.06
        setVp((v) => zoomViewport(v, cursorUm.x, cursorUm.y, factor))
      } else {
        setVp((v) => ({
          ...v,
          left: v.left + e.evt.deltaX / v.scale,
          top: v.top + e.evt.deltaY / v.scale,
        }))
      }
    },
    [vp],
  )

  // ── Core pointer-position handlers (shared by mouse and touch) ──────────────

  const handlePointerDown = useCallback(
    (pos: { x: number; y: number }, altKey = false) => {
      if (drawMode === 'select' || altKey) {
        setPanState({ startX: pos.x, startY: pos.y, vpLeft: vp.left, vpTop: vp.top })
        return
      }
      const { um } = resolveSnap(pos, vp)
      if (drawMode === 'rectangle') {
        setDrawState({ mode: 'drawing_rect', startX: um.x, startY: um.y })
        setPreviewRect({ x: um.x, y: um.y, w: 0, h: 0 })
      } else if (drawMode === 'circle') {
        setDrawState({ mode: 'drawing_circle', cx: um.x, cy: um.y })
        setPreviewCircle({ cx: um.x, cy: um.y, r: 0 })
      } else if (drawMode === 'freeform') {
        // Resolve existing points: from active draw state or committed shape
        const existing: Point[] | null =
          drawState.mode === 'drawing_freeform'
            ? drawState.points
            : shape?.type === 'freeform' && shape.freeform && shape.freeform.points.length > 0
              ? shape.freeform.points
              : null

        if (!existing) {
          // No existing shape — start fresh
          const startPts = [um]
          onShapeChange({ type: 'freeform', freeform: { points: startPts } })
          setDrawState({ mode: 'drawing_freeform', points: startPts, preview: null })
        } else {
          const anchorIdx = drawState.mode === 'drawing_freeform' ? drawState.anchorIndex : undefined

          // Check if clicking near any existing vertex
          const HIT_PX = 12
          let hitIndex = -1
          for (let i = 0; i < existing.length; i++) {
            const dx = (um.x - existing[i].x) * vp.scale
            const dy = (um.y - existing[i].y) * vp.scale
            if (Math.sqrt(dx * dx + dy * dy) < HIT_PX) { hitIndex = i; break }
          }

          if (hitIndex >= 0) {
            // Click near first point with no anchor → close polygon
            if (hitIndex === 0 && existing.length >= 3 && anchorIdx === undefined) {
              onShapeChange({ type: 'freeform', freeform: { points: existing } })
              setDrawState({ mode: 'idle' })
            } else {
              // Select this vertex as the anchor for directed insertion
              setDrawState({ mode: 'drawing_freeform', points: existing, preview: null, anchorIndex: hitIndex })
            }
          } else if (anchorIdx !== undefined) {
            // Anchor is active — insert new point directionally relative to anchor
            const Pi = existing[anchorIdx]
            const Pnext = existing[(anchorIdx + 1) % existing.length]
            const forward = { x: Pnext.x - Pi.x, y: Pnext.y - Pi.y }
            const newVec  = { x: um.x   - Pi.x, y: um.y   - Pi.y }
            const dot = forward.x * newVec.x + forward.y * newVec.y
            // dot >= 0: new point is in the forward direction → insert after anchor
            // dot <  0: new point is in the backward direction → insert before anchor
            const insertPos = dot >= 0 ? anchorIdx + 1 : anchorIdx
            const newPts = [...existing.slice(0, insertPos), um, ...existing.slice(insertPos)]
            onShapeChange({ type: 'freeform', freeform: { points: newPts } })
            // New point becomes the next anchor for continued drawing
            setDrawState({ mode: 'drawing_freeform', points: newPts, preview: null, anchorIndex: insertPos })
          } else {
            // No anchor, no vertex hit → append to end
            const newPts = [...existing, um]
            onShapeChange({ type: 'freeform', freeform: { points: newPts } })
            setDrawState({ mode: 'drawing_freeform', points: newPts, preview: null })
          }
        }
      } else if (drawMode === 'exclusion') {
        const pts = drawState.mode === 'drawing_exclusion' ? drawState.points : []
        if (pts.length === 0) {
          setDrawState({ mode: 'drawing_exclusion', points: [um], preview: null })
        } else {
          const first = pts[0]
          const dx = (um.x - first.x) * vp.scale
          const dy = (um.y - first.y) * vp.scale
          if (pts.length >= 3 && Math.sqrt(dx * dx + dy * dy) < 12) {
            onExclusionZoneAdd(pts)
            setDrawState({ mode: 'idle' })
          } else {
            setDrawState({ mode: 'drawing_exclusion', points: [...pts, um], preview: null })
          }
        }
      }
    },
    [drawMode, drawState, onExclusionZoneAdd, onShapeChange, vp],
  )

  const handlePointerMove = useCallback(
    (pos: { x: number; y: number }) => {
      if (panState) {
        const dx = (pos.x - panState.startX) / vp.scale
        const dy = (pos.y - panState.startY) / vp.scale
        setVp((v) => ({ ...v, left: panState.vpLeft - dx, top: panState.vpTop - dy }))
        setHoverInfo(null)
        return
      }
      const isDrawMode = drawMode !== 'select'
      const { um, snapping } = isDrawMode ? resolveSnap(pos, vp) : { um: pointerToUm(pos.x, pos.y, vp), snapping: false }
      const snapped = um
      setSnapPoint(snapping ? snapped : null)

      // ── Rotated tile hover detection ───────────────────────────────────────
      // For rotated tiles we bypass Konva hit rects (skipHoverEvents=true) and
      // detect hover manually by un-rotating the mouse position into the tile frame.
      const isRotatedView = rotationTab === 'rotated' && rotatedScanResult != null && rotationOptimum != null && shape != null
      let rotatedMousePx: { x: number; y: number } | null = null
      if (isRotatedView) {
        const { x: cx_um, y: cy_um } = getShapeCentroidUm(shape!)
        const cx_px = umToPixel(cx_um, vp.left, vp.scale)
        const cy_px = umToPixel(cy_um, vp.top, vp.scale)
        const angleRad = (rotationOptimum!.angle_deg * Math.PI) / 180
        const cosA = Math.cos(angleRad)
        const sinA = Math.sin(angleRad)
        const dx = pos.x - cx_px
        const dy = pos.y - cy_px
        // Rotate by +angle (inverse of the -angle group transform)
        rotatedMousePx = { x: cx_px + dx * cosA - dy * sinA, y: cy_px + dx * sinA + dy * cosA }
        const mouseUmX = vp.left + rotatedMousePx.x / vp.scale
        const mouseUmY = vp.top  + rotatedMousePx.y / vp.scale
        const hitTile = rotatedScanResult!.passes.find(
          (p) => mouseUmX >= p.region.x_min && mouseUmX <= p.region.x_max &&
                 mouseUmY >= p.region.y_min && mouseUmY <= p.region.y_max,
        )
        onPassHover(hitTile ? hitTile.pass_number : null)
      }

      // ── Scan dot proximity tooltip ─────────────────────────────────────────
      // Only active when dots are rendered (same conditions as ScanGridRenderer):
      // focused pass is hovered, spacing is large enough, and we're not mid-draw.
      const activeResult = rotationTab === 'rotated' && rotatedScanResult != null
        ? rotatedScanResult
        : scanResult
      if (
        activeResult &&
        hoveredPass !== null &&
        drawState.mode === 'idle'
      ) {
        const pass = activeResult.passes.find((p) => p.pass_number === hoveredPass)
        if (pass) {
          const dotSpacePx = Math.min(pass.delta_x, pass.delta_y) * vp.scale
          if (dotSpacePx >= DOT_SPACING_THRESHOLD) {
            const DOT_HIT_PX = 8
            const buf = DOT_HIT_PX / vp.scale
            // For the rotated case, cull against the rotated viewport AABB
            // (same transform we use for ScanGridRenderer's cullBounds).
            let visXMin: number, visXMax: number, visYMin: number, visYMax: number
            if (isRotatedView && rotatedMousePx && rotationOptimum && shape) {
              const { x: cx_um, y: cy_um } = getShapeCentroidUm(shape)
              const cx_px = umToPixel(cx_um, vp.left, vp.scale)
              const cy_px = umToPixel(cy_um, vp.top, vp.scale)
              const angleRad = (rotationOptimum.angle_deg * Math.PI) / 180
              const cosA = Math.cos(angleRad)
              const sinA = Math.sin(angleRad)
              const corners: [number, number][] = [[0, 0], [size.w, 0], [0, size.h], [size.w, size.h]]
              const rxs = corners.map(([sx, sy]) => {
                const dx = sx - cx_px; const dy = sy - cy_px
                return vp.left + (cx_px + dx * cosA - dy * sinA) / vp.scale
              })
              const rys = corners.map(([sx, sy]) => {
                const dx = sx - cx_px; const dy = sy - cy_px
                return vp.top + (cy_px + dx * sinA + dy * cosA) / vp.scale
              })
              visXMin = Math.min(...rxs) - buf; visXMax = Math.max(...rxs) + buf
              visYMin = Math.min(...rys) - buf; visYMax = Math.max(...rys) + buf
            } else {
              visXMin = vp.left - buf; visXMax = vp.left + size.w / vp.scale + buf
              visYMin = vp.top  - buf; visYMax = vp.top  + size.h / vp.scale + buf
            }
            let bestDist = DOT_HIT_PX
            let bestInfo: HoverInfo | null = null
            // For rotated tiles, dots are in the rotated frame — compare against the
            // un-rotated mouse position so distances are measured correctly.
            const effectivePos = (isRotatedView && rotatedMousePx) ? rotatedMousePx : pos
            for (let idx = 0; idx < pass.grid_points.length; idx++) {
              const pt = pass.grid_points[idx]
              if (pt.x < visXMin || pt.x > visXMax || pt.y < visYMin || pt.y > visYMax) continue
              const dpx = umToPixel(pt.x, vp.left, vp.scale) - effectivePos.x
              const dpy = umToPixel(pt.y, vp.top, vp.scale) - effectivePos.y
              const dist = Math.sqrt(dpx * dpx + dpy * dpy)
              if (dist < bestDist) {
                bestDist = dist
                bestInfo = { kind: 'dot', px: pos.x, py: pos.y, umX: pt.x, umY: pt.y, pass: pass.pass_number, index: idx }
              }
            }
            if (bestInfo) { setHoverInfo(bestInfo); return }
          }
        }
      }
      // ──────────────────────────────────────────────────────────────────────
      if (drawState.mode === 'drawing_rect') {
        const w = snapped.x - drawState.startX
        const h = snapped.y - drawState.startY
        setPreviewRect({
          x: w >= 0 ? drawState.startX : snapped.x,
          y: h >= 0 ? drawState.startY : snapped.y,
          w: Math.abs(w),
          h: Math.abs(h),
        })
        setHoverInfo(null)
      } else if (drawState.mode === 'drawing_circle') {
        const dx = snapped.x - drawState.cx
        const dy = snapped.y - drawState.cy
        setPreviewCircle({ cx: drawState.cx, cy: drawState.cy, r: Math.sqrt(dx * dx + dy * dy) })
        setHoverInfo(null)
      } else if (drawState.mode === 'drawing_freeform') {
        setDrawState({ ...drawState, preview: snapped })
        setHoverInfo(null)
      } else if (drawState.mode === 'drawing_exclusion') {
        setDrawState({ ...drawState, preview: snapped })
        setHoverInfo(null)
      } else if (shape?.type === 'freeform' && shape.freeform) {
        const pts = shape.freeform.points
        const VERTEX_THRESHOLD = 10
        const EDGE_THRESHOLD = 6
        let found = false
        for (let i = 0; i < pts.length; i++) {
          const vx = umToPixel(pts[i].x, vp.left, vp.scale)
          const vy = umToPixel(pts[i].y, vp.top, vp.scale)
          if (Math.sqrt((pos.x - vx) ** 2 + (pos.y - vy) ** 2) < VERTEX_THRESHOLD) {
            setHoverInfo({ kind: 'vertex', index: i, px: pos.x, py: pos.y, umX: pts[i].x, umY: pts[i].y })
            found = true
            break
          }
        }
        if (!found) {
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length
            const ax = umToPixel(pts[i].x, vp.left, vp.scale)
            const ay = umToPixel(pts[i].y, vp.top, vp.scale)
            const bx = umToPixel(pts[j].x, vp.left, vp.scale)
            const by = umToPixel(pts[j].y, vp.top, vp.scale)
            if (pointToSegDist(pos.x, pos.y, ax, ay, bx, by) < EDGE_THRESHOLD) {
              const ddx = pts[j].x - pts[i].x
              const ddy = pts[j].y - pts[i].y
              setHoverInfo({ kind: 'edge', fromIdx: i, toIdx: j, px: pos.x, py: pos.y, length: Math.sqrt(ddx * ddx + ddy * ddy) })
              found = true
              break
            }
          }
        }
        if (!found && pointInPolygon(um.x, um.y, pts)) {
          setHoverInfo({ kind: 'surface', surfaceIndex: 0, px: pos.x, py: pos.y, areaUm2: polygonAreaUm2(pts) })
          found = true
        }
        if (!found) setHoverInfo(null)
      } else if (shape?.type === 'rectangle' && shape.rect) {
        const r = shape.rect
        const pts: Point[] = [
          { x: r.x,           y: r.y            },
          { x: r.x + r.width, y: r.y            },
          { x: r.x + r.width, y: r.y + r.height },
          { x: r.x,           y: r.y + r.height },
        ]
        const VERTEX_THRESHOLD = 10
        const EDGE_THRESHOLD = 6
        let found = false
        for (let i = 0; i < pts.length; i++) {
          const vx = umToPixel(pts[i].x, vp.left, vp.scale)
          const vy = umToPixel(pts[i].y, vp.top, vp.scale)
          if (Math.sqrt((pos.x - vx) ** 2 + (pos.y - vy) ** 2) < VERTEX_THRESHOLD) {
            setHoverInfo({ kind: 'vertex', index: i, px: pos.x, py: pos.y, umX: pts[i].x, umY: pts[i].y })
            found = true
            break
          }
        }
        if (!found) {
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length
            const ax = umToPixel(pts[i].x, vp.left, vp.scale)
            const ay = umToPixel(pts[i].y, vp.top, vp.scale)
            const bx = umToPixel(pts[j].x, vp.left, vp.scale)
            const by = umToPixel(pts[j].y, vp.top, vp.scale)
            if (pointToSegDist(pos.x, pos.y, ax, ay, bx, by) < EDGE_THRESHOLD) {
              const ddx = pts[j].x - pts[i].x
              const ddy = pts[j].y - pts[i].y
              setHoverInfo({ kind: 'edge', fromIdx: i, toIdx: j, px: pos.x, py: pos.y, length: Math.sqrt(ddx * ddx + ddy * ddy) })
              found = true
              break
            }
          }
        }
        if (!found && um.x >= r.x && um.x <= r.x + r.width && um.y >= r.y && um.y <= r.y + r.height) {
          setHoverInfo({ kind: 'surface', surfaceIndex: 0, px: pos.x, py: pos.y, areaUm2: r.width * r.height })
          found = true
        }
        if (!found) setHoverInfo(null)
      } else {
        setHoverInfo(null)
      }
    },
    [drawState, hoveredPass, onPassHover, panState, rotatedScanResult, rotationOptimum, rotationTab, scanResult, shape, size.w, size.h, vp],
  )

  const handlePointerUp = useCallback(
    (pos: { x: number; y: number }) => {
      if (panState) {
        setPanState(null)
        return
      }
      const { um } = resolveSnap(pos, vp)
      if (drawState.mode === 'drawing_rect') {
        const w = Math.abs(um.x - drawState.startX)
        const h = Math.abs(um.y - drawState.startY)
        if (w > 1 && h > 1) {
          onShapeChange({
            type: 'rectangle',
            rect: { x: Math.min(drawState.startX, um.x), y: Math.min(drawState.startY, um.y), width: w, height: h },
          })
        }
        setDrawState({ mode: 'idle' })
        setPreviewRect(null)
      } else if (drawState.mode === 'drawing_circle') {
        const dx = um.x - drawState.cx
        const dy = um.y - drawState.cy
        const r = Math.sqrt(dx * dx + dy * dy)
        if (r > 1) {
          onShapeChange({ type: 'circle', circle: { cx: drawState.cx, cy: drawState.cy, radius: r } })
        }
        setDrawState({ mode: 'idle' })
        setPreviewCircle(null)
      }
    },
    [drawState, onShapeChange, panState, vp],
  )

  // ── Mouse wrappers ───────────────────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return
      const pos = e.target.getStage()!.getPointerPosition()!
      handlePointerDown(pos, e.evt.altKey)
    },
    [handlePointerDown],
  )

  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const pos = e.target.getStage()!.getPointerPosition()!
      handlePointerMove(pos)
    },
    [handlePointerMove],
  )

  const handleMouseUp = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const pos = e.target.getStage()!.getPointerPosition()!
      handlePointerUp(pos)
    },
    [handlePointerUp],
  )

  const handleDblClick = useCallback(
    (_e: KonvaEventObject<MouseEvent>) => {
      if (drawState.mode === 'drawing_freeform' && drawState.points.length >= 3) {
        onShapeChange({ type: 'freeform', freeform: { points: drawState.points } })
        setDrawState({ mode: 'idle' })
      } else if (drawState.mode === 'drawing_exclusion' && drawState.points.length >= 3) {
        onExclusionZoneAdd(drawState.points)
        setDrawState({ mode: 'idle' })
      }
    },
    [drawState, onExclusionZoneAdd, onShapeChange],
  )

  // ── Touch handlers ───────────────────────────────────────────────────────────

  const handleTouchStart = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      const touches = e.evt.touches
      if (touches.length === 2) {
        // Two fingers: begin pinch/pan — cancel any active draw or pan
        setPanState(null)
        setDrawState({ mode: 'idle' })
        afterTwoFingerRef.current = false
        const t1 = touches[0], t2 = touches[1]
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        const initDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
        const initMidX = (t1.clientX + t2.clientX) / 2 - rect.left
        const initMidY = (t1.clientY + t2.clientY) / 2 - rect.top
        pinchRef.current = {
          dist: initDist, midX: initMidX, midY: initMidY,
          startDist: initDist, startMidX: initMidX, startMidY: initMidY,
          gestureMode: 'undecided',
        }
        return
      }
      if (touches.length === 1) {
        // Ignore first single-finger event right after releasing a two-finger gesture
        if (afterTwoFingerRef.current) {
          afterTwoFingerRef.current = false
          return
        }
        const pos = e.target.getStage()!.getPointerPosition()!
        // Double-tap to close freeform polygon
        const now = Date.now()
        if (
          now - lastTapRef.current < 300 &&
          drawState.mode === 'drawing_freeform' &&
          drawState.points.length >= 3
        ) {
          onShapeChange({ type: 'freeform', freeform: { points: drawState.points } })
          setDrawState({ mode: 'idle' })
          lastTapRef.current = 0
          return
        }
        lastTapRef.current = now
        handlePointerDown(pos)
      }
    },
    [drawState, handlePointerDown, onShapeChange],
  )

  const handleTouchMove = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      const touches = e.evt.touches
      if (touches.length === 2 && pinchRef.current) {
        e.evt.preventDefault()
        const t1 = touches[0], t2 = touches[1]
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        const newDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
        const newMidX = (t1.clientX + t2.clientX) / 2 - rect.left
        const newMidY = (t1.clientY + t2.clientY) / 2 - rect.top
        const { dist: prevDist, midX: prevMidX, midY: prevMidY, startDist, startMidX, startMidY, gestureMode } = pinchRef.current

        // Decide gesture mode once, based on cumulative movement from gesture start.
        // This avoids per-frame noise flipping between zoom and pan.
        let mode = gestureMode
        if (mode === 'undecided') {
          const cumulativeScale = newDist / startDist
          const cumMidDist = Math.hypot(newMidX - startMidX, newMidY - startMidY)
          if (Math.abs(cumulativeScale - 1) > 0.08) {
            mode = 'zoom'
          } else if (cumMidDist > 12) {
            mode = 'pan'
          }
        }

        const scaleFactor = newDist / prevDist
        setVp((v) => {
          if (mode === 'zoom') {
            // Pinch: zoom only, anchored at midpoint between fingers
            const midUm = pointerToUm(newMidX, newMidY, v)
            return zoomViewport(v, midUm.x, midUm.y, scaleFactor)
          }
          // Pan (or still undecided — default to pan until we know otherwise)
          const dx = (newMidX - prevMidX) / v.scale
          const dy = (newMidY - prevMidY) / v.scale
          return { ...v, left: v.left - dx, top: v.top - dy }
        })
        pinchRef.current = { dist: newDist, midX: newMidX, midY: newMidY, startDist, startMidX, startMidY, gestureMode: mode }
        return
      }
      if (touches.length === 1 && !pinchRef.current) {
        const pos = e.target.getStage()!.getPointerPosition()!
        handlePointerMove(pos)
      }
    },
    [handlePointerMove],
  )

  const handleTouchEnd = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      if (pinchRef.current) {
        pinchRef.current = null
        afterTwoFingerRef.current = true  // suppress next single-finger touchstart
        return
      }
      afterTwoFingerRef.current = false
      const stage = e.target.getStage()
      const pos = stage?.getPointerPosition()
      if (pos) handlePointerUp(pos)
    },
    [handlePointerUp],
  )

  const toX = (um: number) => umToPixel(um, vp.left, vp.scale)
  const toY = (um: number) => umToPixel(um, vp.top, vp.scale)

  const cursor =
    panState ? 'grabbing'
    : drawMode === 'select' ? 'grab'
    : 'crosshair'

  return (
    <div ref={containerRef} className="relative w-full h-full bg-white dark:bg-[#1a1a1a] print:h-auto print:overflow-visible" style={{ cursor, touchAction: 'none' }}>
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDblClick}
        onMouseLeave={() => { setHoverInfo(null); setSnapPoint(null) }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Background + coordinate grid (not transformed — drawn in pixel space) */}
        <Layer listening={false}>
          <CoordGrid vp={vp} width={size.w} height={size.h} darkMode={darkMode} />
          {/* Axes */}
          <Line
            points={[toX(0), 0, toX(0), size.h]}
            stroke={darkMode ? '#444' : '#d1d5db'}
            strokeWidth={1.5}
          />
          <Line
            points={[0, toY(0), size.w, toY(0)]}
            stroke={darkMode ? '#444' : '#d1d5db'}
            strokeWidth={1.5}
          />
          {/* Axis labels + direction arrows */}
          {/* Y label next to arrow at bottom (Y increases downward) */}
          <Line
            points={[toX(0) - 5, size.h - 10, toX(0), size.h - 2, toX(0) + 5, size.h - 10]}
            stroke={darkMode ? '#555' : '#9ca3af'}
            strokeWidth={1.5}
            listening={false}
          />
          <Text
            x={toX(0) - 22}
            y={size.h - 18}
            text="Y"
            fontSize={14}
            fontStyle="bold"
            fill={darkMode ? '#555' : '#9ca3af'}
            listening={false}
          />
          {/* X label at right, arrow pointing rightward (X increases rightward) */}
          <Text
            x={size.w - 20}
            y={toY(0) - 18}
            text="X"
            fontSize={14}
            fontStyle="bold"
            fill={darkMode ? '#555' : '#9ca3af'}
            listening={false}
          />
          <Line
            points={[size.w - 10, toY(0) - 5, size.w - 2, toY(0), size.w - 10, toY(0) + 5]}
            stroke={darkMode ? '#555' : '#9ca3af'}
            strokeWidth={1.5}
            listening={false}
          />
          {/* Origin dot */}
          <Circle x={toX(0)} y={toY(0)} radius={3} fill={darkMode ? '#555' : '#6b7280'} />
        </Layer>

        {/* Content layer — shapes, grid, drawing */}
        <Layer listening={focusMode}>
          {/* Sample shape — hidden while the user is actively editing it as freeform */}
          {shape && drawState.mode !== 'drawing_freeform' && <ShapeRenderer shape={shape} vp={vp} />}

          {/* Exclusion zones */}
          <ExclusionZoneRenderer zones={exclusionZones} vp={vp} />

          {/* Frame overlay */}
          {shape && frameEnabled && frameSegments && (
            <FrameRenderer
              shape={shape}
              segments={frameSegments}
              vp={vp}
              enabled={frameEnabled}
            />
          )}

          {/* Scan grid — hidden while drawing exclusion zones */}
          {drawMode !== 'exclusion' && (() => {
            const showRotated = rotationTab === 'rotated' &&
              rotatedScanResult != null &&
              rotationOptimum != null

            if (showRotated && shape) {
              const { x: cx_um, y: cy_um } = getShapeCentroidUm(shape)
              const cx_px = umToPixel(cx_um, vp.left, vp.scale)
              const cy_px = umToPixel(cy_um, vp.top, vp.scale)
              // Compute the viewport rectangle's AABB in the rotated µm frame.
              // The Group rotates by -angle, so to un-rotate screen corners we rotate by +angle.
              const angleRad = (rotationOptimum!.angle_deg * Math.PI) / 180
              const cosA = Math.cos(angleRad)
              const sinA = Math.sin(angleRad)
              const screenCorners: [number, number][] = [
                [0, 0], [size.w, 0], [0, size.h], [size.w, size.h],
              ]
              const rotatedUmCorners = screenCorners.map(([sx, sy]) => {
                const dx = sx - cx_px
                const dy = sy - cy_px
                const lx = cx_px + dx * cosA - dy * sinA
                const ly = cy_px + dx * sinA + dy * cosA
                return { x: vp.left + lx / vp.scale, y: vp.top + ly / vp.scale }
              })
              const rotatedCullBounds = {
                xMin: Math.min(...rotatedUmCorners.map((p) => p.x)),
                xMax: Math.max(...rotatedUmCorners.map((p) => p.x)),
                yMin: Math.min(...rotatedUmCorners.map((p) => p.y)),
                yMax: Math.max(...rotatedUmCorners.map((p) => p.y)),
              }
              return (
                <Group
                  x={cx_px}
                  y={cy_px}
                  offsetX={cx_px}
                  offsetY={cy_px}
                  rotation={-rotationOptimum!.angle_deg}
                >
                  <ScanGridRenderer
                    scanResult={rotatedScanResult!}
                    vp={vp}
                    width={size.w}
                    height={size.h}
                    focusMode={focusMode}
                    hoveredPass={hoveredPass}
                    onPassHover={onPassHover}
                    skipHoverEvents={true}
                    cullBounds={rotatedCullBounds}
                  />
                </Group>
              )
            }

            return scanResult && (
              <ScanGridRenderer
                scanResult={scanResult}
                vp={vp}
                width={size.w}
                height={size.h}
                focusMode={focusMode}
                hoveredPass={hoveredPass}
                onPassHover={onPassHover}
              />
            )
          })()}

          {/* Alignment angle arcs — always shown at P1 when shape has edges */}
          {shape?.type === 'freeform' && shape.freeform && shape.freeform.points.length >= 3 && (() => {
            const pts = shape.freeform.points
            const n = pts.length
            const vx = toX(pts[0].x)
            const vy = toY(pts[0].y)

            // The two edges from P1
            const edges = [
              { dx: toX(pts[n - 1].x) - vx, dy: toY(pts[n - 1].y) - vy },
              { dx: toX(pts[1].x)     - vx, dy: toY(pts[1].y)     - vy },
            ]

            const REF_LEN = 56
            const ARC_RADII = [28, 42]  // different radii so arcs don't overlap
            const arcColor = darkMode ? '#9ca3af' : '#6b7280'
            const textColor = darkMode ? '#e5e7eb' : '#111827'
            const fillColor = darkMode ? 'rgba(156,163,175,0.1)' : 'rgba(107,114,128,0.12)'

            // For each edge: find angle to nearest Y reference (Y-up=270° or Y-down=90°)
            // and compute the arc rotation/sweep so it sits OUTSIDE the shape vertex.
            //
            // Rule (Konva clockwise from positive-X):
            //   Edges with ang ≥ 180° are "upward" → reference is Y-up (270°)
            //     ang > 270°: arc from Y-up (rotation=270) CW sweep=(ang-270)
            //     ang < 270°: arc from edge (rotation=ang) CW sweep=(270-ang)
            //   Edges with ang < 180° are "downward" → reference is Y-down (90°)
            //     ang < 90°:  arc from edge (rotation=ang) CW sweep=(90-ang)
            //     ang > 90°:  arc from Y-down (rotation=90) CW sweep=(ang-90)
            // This always places the arc in the exterior half-plane at P1.

            const arcs: { rotation: number; sweep: number; r: number }[] = []

            edges.forEach((e, i) => {
              const ang = ((Math.atan2(e.dy, e.dx) * 180 / Math.PI) + 360) % 360
              let rotation: number, sweep: number

              if (ang >= 180) {
                // Upward edge → Y-up (270°)
                if (ang > 270) { rotation = 270; sweep = ang - 270 }
                else            { rotation = ang;  sweep = 270 - ang }
              } else {
                // Downward edge → Y-down (90°)
                if (ang < 90) { rotation = ang; sweep = 90 - ang }
                else          { rotation = 90;  sweep = ang - 90  }
              }

              if (sweep < 0.5 || sweep > 89.5) return
              arcs.push({ rotation, sweep, r: ARC_RADII[i] })
            })

            return (
              <Group listening={false}>
                {/* Dashed vertical Y reference — both up and down from P1 */}
                <Line points={[vx, vy, vx, vy - REF_LEN]} stroke={arcColor} strokeWidth={1} dash={[5, 4]} listening={false} />
                <Line points={[vx, vy, vx, vy + REF_LEN]} stroke={arcColor} strokeWidth={1} dash={[5, 4]} listening={false} />

                {arcs.map(({ rotation, sweep, r }, i) => {
                  const midRad = (rotation + sweep / 2) * Math.PI / 180
                  const labelR = r + 13
                  return (
                    <React.Fragment key={i}>
                      <Arc
                        x={vx} y={vy}
                        innerRadius={r - 1} outerRadius={r}
                        rotation={rotation} angle={sweep}
                        fill={fillColor} stroke={arcColor} strokeWidth={1.5}
                        listening={false}
                      />
                      <Text
                        x={vx + labelR * Math.cos(midRad) - 11}
                        y={vy + labelR * Math.sin(midRad) - 7}
                        text={`${sweep.toFixed(1)}°`}
                        fontSize={11} fontStyle="bold" fill={textColor}
                        listening={false}
                      />
                    </React.Fragment>
                  )
                })}
              </Group>
            )
          })()}

          {/* Drawing previews */}
          {previewRect && (
            <Rect
              x={toX(previewRect.x)}
              y={toY(previewRect.y)}
              width={previewRect.w * vp.scale}
              height={previewRect.h * vp.scale}
              stroke="#2563eb"
              strokeWidth={2}
              dash={[4, 4]}
              fill="rgba(59,130,246,0.1)"
              listening={false}
            />
          )}
          {previewCircle && previewCircle.r > 0 && (
            <Circle
              x={toX(previewCircle.cx)}
              y={toY(previewCircle.cy)}
              radius={previewCircle.r * vp.scale}
              stroke="#2563eb"
              strokeWidth={2}
              dash={[4, 4]}
              fill="rgba(59,130,246,0.1)"
              listening={false}
            />
          )}
          <DrawingPreview drawState={drawState} vp={vp} />

          {/* Snap-to-grid indicator */}
          {snapPoint && (
            <>
              <Line
                points={[toX(snapPoint.x) - 12, toY(snapPoint.y), toX(snapPoint.x) + 12, toY(snapPoint.y)]}
                stroke="#2563eb"
                strokeWidth={0.75}
                listening={false}
              />
              <Line
                points={[toX(snapPoint.x), toY(snapPoint.y) - 12, toX(snapPoint.x), toY(snapPoint.y) + 12]}
                stroke="#2563eb"
                strokeWidth={0.75}
                listening={false}
              />
              <Circle
                x={toX(snapPoint.x)}
                y={toY(snapPoint.y)}
                radius={3}
                fill="#2563eb"
                listening={false}
              />
            </>
          )}
        </Layer>
      </Stage>

      {/* Canvas controls — bottom-right */}
      <div className="absolute bottom-3 right-3 flex flex-col items-center gap-1.5 z-20 select-none print:hidden">
        {/* Zoom */}
        <div className="flex flex-col rounded overflow-hidden shadow border border-gray-200 dark:border-[#3a3a3a]">
          {([
            { label: '+', title: 'Zoom in',  factor: 1.3 },
            { label: '−', title: 'Zoom out', factor: 1 / 1.3 },
          ] as const).map(({ label, title, factor }) => (
            <button
              key={label}
              title={title}
              onClick={() =>
                setVp((v) =>
                  zoomViewport(
                    v,
                    v.left + size.w / v.scale / 2,
                    v.top  + size.h / v.scale / 2,
                    factor,
                  )
                )
              }
              className="w-7 h-7 flex items-center justify-center text-sm font-bold leading-none
                bg-white/90 dark:bg-[#2c2c2c]/90 text-gray-600 dark:text-[#aaa]
                hover:bg-gray-100 dark:hover:bg-[#3a3a3a] transition-colors backdrop-blur-sm
                border-b border-gray-200 dark:border-[#3a3a3a] last:border-b-0"
            >
              {label}
            </button>
          ))}
        </div>

        {/* D-pad */}
        <div className="grid grid-cols-3 gap-0.5">
          {([
            { label: '↑', col: 2, row: 1, dx:  0,    dy: -0.25 },
            { label: '←', col: 1, row: 2, dx: -0.25, dy:  0    },
            { label: '→', col: 3, row: 2, dx:  0.25, dy:  0    },
            { label: '↓', col: 2, row: 3, dx:  0,    dy:  0.25 },
          ] as const).map(({ label, col, row, dx, dy }) => (
            <button
              key={label}
              title={label === '↑' ? 'Pan up' : label === '↓' ? 'Pan down' : label === '←' ? 'Pan left' : 'Pan right'}
              onClick={() =>
                setVp((v) => ({
                  ...v,
                  left: v.left + dx * size.w / v.scale,
                  top:  v.top  + dy * size.h / v.scale,
                }))
              }
              style={{ gridColumn: col, gridRow: row }}
              className="w-7 h-7 flex items-center justify-center text-sm leading-none rounded shadow
                bg-white/90 dark:bg-[#2c2c2c]/90 border border-gray-200 dark:border-[#3a3a3a]
                text-gray-600 dark:text-[#aaa] hover:bg-gray-100 dark:hover:bg-[#3a3a3a]
                transition-colors backdrop-blur-sm"
            >
              {label}
            </button>
          ))}

          {/* Center button */}
          <button
            title={shape ? 'Fit shape in view' : 'Reset view to origin'}
            onClick={() => {
              if (shape) {
                const bbox = shapeBoundingBox(shape)
                if (bbox) setVp(fitViewport(bbox.xMin, bbox.yMin, bbox.xMax, bbox.yMax, size.w, size.h))
              } else {
                const SCALE = 0.004
                setVp({ scale: SCALE, left: -(size.w / 2) / SCALE, top: -(size.h / 2) / SCALE })
              }
            }}
            style={{ gridColumn: 2, gridRow: 2 }}
            className="w-7 h-7 flex items-center justify-center rounded shadow
              bg-white/90 dark:bg-[#2c2c2c]/90 border border-gray-200 dark:border-[#3a3a3a]
              text-gray-500 dark:text-[#aaa] hover:bg-gray-100 dark:hover:bg-[#3a3a3a]
              transition-colors backdrop-blur-sm"
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <circle cx="7" cy="7" r="2" />
              <line x1="7" y1="1" x2="7" y2="4" />
              <line x1="7" y1="10" x2="7" y2="13" />
              <line x1="1" y1="7" x2="4" y2="7" />
              <line x1="10" y1="7" x2="13" y2="7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Hover tooltip */}
      {hoverInfo && (
        <div
          className="absolute pointer-events-none z-10 rounded shadow-lg text-xs leading-snug px-2 py-1.5 bg-gray-900/90 text-white dark:bg-gray-100/90 dark:text-gray-900"
          style={{ left: hoverInfo.px + 14, top: hoverInfo.py - 10 }}
        >
          {hoverInfo.kind === 'vertex' && (
            <span>
              P{hoverInfo.index + 1}&nbsp;({fmtDisplay(hoverInfo.umX, displayUnit, 2)},&nbsp;{fmtDisplay(hoverInfo.umY, displayUnit, 2)})
            </span>
          )}
          {hoverInfo.kind === 'edge' && (
            <>
              <div className="font-semibold">P{hoverInfo.fromIdx + 1} – P{hoverInfo.toIdx + 1}</div>
              <div className="opacity-80">Length:&nbsp;{fmtDisplay(hoverInfo.length, displayUnit, 2)}</div>
            </>
          )}
          {hoverInfo.kind === 'surface' && (
            <>
              <div className="font-semibold">Surface</div>
              <div className="opacity-80">{fmtAreaDisplay(hoverInfo.areaUm2, displayUnit)}</div>
            </>
          )}
          {hoverInfo.kind === 'dot' && (
            <>
              <div className="font-semibold">#{hoverInfo.index + 1}</div>
              <div className="opacity-80">X:&nbsp;{fmtDisplay(hoverInfo.umX, displayUnit, 2)}</div>
              <div className="opacity-80">Y:&nbsp;{fmtDisplay(hoverInfo.umY, displayUnit, 2)}</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
