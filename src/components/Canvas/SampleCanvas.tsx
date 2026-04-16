import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Circle,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  DrawMode,
  DrawState,
  Point,
  SampleShape,
  ScanResult,
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
}

// ── Grid lines helper ──────────────────────────────────────────────────────────

/** Choose the most readable unit for the current grid spacing (µm). */
function autoGridUnit(spacingUm: number): DisplayUnit {
  if (spacingUm >= 1_000) return 'mm'
  if (spacingUm >= 1)     return 'µm'
  return 'nm'
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
    return (
      <Rect
        x={toX(r.x)}
        y={toY(r.y)}
        width={r.width * vp.scale}
        height={r.height * vp.scale}
        fill="rgba(59,130,246,0.15)"
        stroke="#2563eb"
        strokeWidth={2}
        dash={[6, 3]}
        listening={false}
      />
    )
  }

  if (shape.type === 'circle' && shape.circle) {
    const c = shape.circle
    return (
      <Circle
        x={toX(c.cx)}
        y={toY(c.cy)}
        radius={c.radius * vp.scale}
        fill="rgba(59,130,246,0.15)"
        stroke="#2563eb"
        strokeWidth={2}
        dash={[6, 3]}
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
        {/* Segment labels — parallel to each edge */}
        {pts.map((p, i) => {
          const next = pts[(i + 1) % pts.length]
          const x1 = toX(p.x), y1 = toY(p.y)
          const x2 = toX(next.x), y2 = toY(next.y)
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2
          const edgeDx = x2 - x1
          const edgeDy = y2 - y1
          const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy)
          // Normalised direction
          const nx = edgeLen > 0 ? edgeDx / edgeLen : 1
          const ny = edgeLen > 0 ? edgeDy / edgeLen : 0
          // Perpendicular: choose whichever half-space points screen-upward
          let perpX = -ny
          let perpY = nx
          if (perpY > 0 || (perpY === 0 && perpX < 0)) { perpX = -perpX; perpY = -perpY }
          // Text rotation — normalised to (-90°, 90°] so text is never upside-down
          let angle = Math.atan2(edgeDy, edgeDx) * 180 / Math.PI
          if (angle > 90) angle -= 180
          else if (angle <= -90) angle += 180

          const nextIdx = (i + 1) % pts.length
          const label = `P${i + 1}–P${nextIdx + 1}`
          const OFFSET = 12
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
        })}
        {/* Vertex dots + labels */}
        {pts.map((p, i) => (
          <React.Fragment key={`vtx-${i}`}>
            <Circle
              x={toX(p.x)}
              y={toY(p.y)}
              radius={i === 0 ? 6 : 5}
              fill={i === 0 ? '#2563eb' : 'white'}
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
}: {
  scanResult: ScanResult
  vp: Viewport
  width: number
  height: number
  focusMode: boolean
  hoveredPass: number | null
  onPassHover: (pass: number | null) => void
}) {
  const toX = (um: number) => umToPixel(um, vp.left, vp.scale)
  const toY = (um: number) => umToPixel(um, vp.top, vp.scale)

  // Viewport bounds in µm with a small buffer so dots don't pop in/out at edges
  const buf = 16 / vp.scale
  const visXMin = vp.left - buf
  const visXMax = vp.left + width  / vp.scale + buf
  const visYMin = vp.top  - buf
  const visYMax = vp.top  + height / vp.scale + buf

  const elements: React.ReactElement[] = []

  scanResult.passes.forEach((pass, passIdx) => {
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
        onMouseEnter={() => onPassHover(pass.pass_number)}
        onMouseLeave={() => onPassHover(null)}
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
        text={`Pass ${pass.pass_number}`}
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
      const r = Math.max(2.5, Math.min(5, vp.scale * 4))
      for (const { pt, idx } of visiblePts) {
        elements.push(
          <Circle
            key={`pt-${passIdx}-${idx}`}
            x={toX(pt.x)}
            y={toY(pt.y)}
            radius={r}
            fill={color}
            stroke="rgba(255,255,255,0.75)"
            strokeWidth={2}
            opacity={opacity * 0.8}
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
    const previewLine =
      drawState.preview
        ? [...flatPts, toX(drawState.preview.x), toY(drawState.preview.y)]
        : flatPts

    return (
      <>
        <Line
          points={previewLine}
          stroke="#2563eb"
          strokeWidth={2}
          dash={[4, 4]}
          listening={false}
        />
        {pts.map((p, i) => (
          <Circle
            key={i}
            x={toX(p.x)}
            y={toY(p.y)}
            radius={4}
            fill={i === 0 ? '#2563eb' : 'white'}
            stroke="#2563eb"
            strokeWidth={2}
            listening={false}
          />
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [vp, setVp] = useState<Viewport>({ left: -5000, top: -5000, scale: 0.04 })
  const [drawState, setDrawState] = useState<DrawState>({ mode: 'idle' })
  const [panState, setPanState] = useState<{ startX: number; startY: number; vpLeft: number; vpTop: number } | null>(null)
  const [previewRect, setPreviewRect] = useState<{
    x: number; y: number; w: number; h: number
  } | null>(null)
  const [previewCircle, setPreviewCircle] = useState<{
    cx: number; cy: number; r: number
  } | null>(null)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)

  // Refs for touch gesture tracking (refs = no stale-closure issues in touch handlers)
  const pinchRef = useRef<{
    dist: number; midX: number; midY: number
    startDist: number; startMidX: number; startMidY: number
    gestureMode: 'undecided' | 'zoom' | 'pan'
  } | null>(null)
  const lastTapRef = useRef<number>(0)
  // Flag: we just finished a two-finger gesture — ignore the next single-finger pointerdown
  const afterTwoFingerRef = useRef(false)

  // Responsive canvas sizing
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setSize({ w: Math.floor(width), h: Math.floor(height) })
      }
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Fit viewport when shape or scan result changes
  useEffect(() => {
    const bbox = shape ? shapeBoundingBox(shape) : null
    if (bbox) {
      setVp(fitViewport(bbox.xMin, bbox.yMin, bbox.xMax, bbox.yMax, size.w, size.h))
    }
  }, [shape, size.w, size.h])

  // ESC cancels active drawing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawState({ mode: 'idle' })
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
      const um = pointerToUm(pos.x, pos.y, vp)
      if (drawMode === 'rectangle') {
        setDrawState({ mode: 'drawing_rect', startX: um.x, startY: um.y })
        setPreviewRect({ x: um.x, y: um.y, w: 0, h: 0 })
      } else if (drawMode === 'circle') {
        setDrawState({ mode: 'drawing_circle', cx: um.x, cy: um.y })
        setPreviewCircle({ cx: um.x, cy: um.y, r: 0 })
      } else if (drawMode === 'freeform') {
        if (drawState.mode !== 'drawing_freeform') {
          setDrawState({ mode: 'drawing_freeform', points: [um], preview: null })
        } else {
          const existing = drawState.points
          const first = existing[0]
          const dx = (um.x - first.x) * vp.scale
          const dy = (um.y - first.y) * vp.scale
          if (existing.length >= 3 && Math.sqrt(dx * dx + dy * dy) < 12) {
            onShapeChange({ type: 'freeform', freeform: { points: existing } })
            setDrawState({ mode: 'idle' })
          } else {
            setDrawState({ ...drawState, points: [...existing, um] })
          }
        }
      }
    },
    [drawMode, drawState, onShapeChange, vp],
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
      const um = pointerToUm(pos.x, pos.y, vp)

      // ── Scan dot proximity tooltip ─────────────────────────────────────────
      // Only active when dots are rendered (same conditions as ScanGridRenderer):
      // focused pass is hovered, spacing is large enough, and we're not mid-draw.
      if (
        scanResult &&
        hoveredPass !== null &&
        drawState.mode === 'idle'
      ) {
        const pass = scanResult.passes.find((p) => p.pass_number === hoveredPass)
        if (pass) {
          const dotSpacePx = Math.min(pass.delta_x, pass.delta_y) * vp.scale
          if (dotSpacePx >= DOT_SPACING_THRESHOLD) {
            const DOT_HIT_PX = 8
            const buf = DOT_HIT_PX / vp.scale
            const visXMin = vp.left - buf
            const visXMax = vp.left + size.w / vp.scale + buf
            const visYMin = vp.top - buf
            const visYMax = vp.top + size.h / vp.scale + buf
            let bestDist = DOT_HIT_PX
            let bestInfo: HoverInfo | null = null
            for (let idx = 0; idx < pass.grid_points.length; idx++) {
              const pt = pass.grid_points[idx]
              if (pt.x < visXMin || pt.x > visXMax || pt.y < visYMin || pt.y > visYMax) continue
              const dpx = umToPixel(pt.x, vp.left, vp.scale) - pos.x
              const dpy = umToPixel(pt.y, vp.top, vp.scale) - pos.y
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
        const w = um.x - drawState.startX
        const h = um.y - drawState.startY
        setPreviewRect({
          x: w >= 0 ? drawState.startX : um.x,
          y: h >= 0 ? drawState.startY : um.y,
          w: Math.abs(w),
          h: Math.abs(h),
        })
        setHoverInfo(null)
      } else if (drawState.mode === 'drawing_circle') {
        const dx = um.x - drawState.cx
        const dy = um.y - drawState.cy
        setPreviewCircle({ cx: drawState.cx, cy: drawState.cy, r: Math.sqrt(dx * dx + dy * dy) })
        setHoverInfo(null)
      } else if (drawState.mode === 'drawing_freeform') {
        setDrawState({ ...drawState, preview: um })
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
      } else {
        setHoverInfo(null)
      }
    },
    [drawState, hoveredPass, panState, scanResult, shape, size.w, size.h, vp],
  )

  const handlePointerUp = useCallback(
    (pos: { x: number; y: number }) => {
      if (panState) {
        setPanState(null)
        return
      }
      const um = pointerToUm(pos.x, pos.y, vp)
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
      }
    },
    [drawState, onShapeChange],
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
    <div ref={containerRef} className="relative w-full h-full bg-white dark:bg-[#1a1a1a]" style={{ cursor, touchAction: 'none' }}>
      <Stage
        width={size.w}
        height={size.h}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDblClick}
        onMouseLeave={() => setHoverInfo(null)}
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
          {/* Axis labels */}
          <Text
            x={toX(0) - 18}
            y={4}
            text="Y"
            fontSize={14}
            fontStyle="bold"
            fill={darkMode ? '#555' : '#9ca3af'}
            listening={false}
          />
          <Text
            x={size.w - 20}
            y={toY(0) - 18}
            text="X"
            fontSize={14}
            fontStyle="bold"
            fill={darkMode ? '#555' : '#9ca3af'}
            listening={false}
          />
          {/* Origin dot */}
          <Circle x={toX(0)} y={toY(0)} radius={3} fill={darkMode ? '#555' : '#6b7280'} />
        </Layer>

        {/* Content layer — shapes, grid, drawing */}
        <Layer listening={focusMode}>
          {/* Sample shape */}
          {shape && <ShapeRenderer shape={shape} vp={vp} />}

          {/* Scan grid */}
          {scanResult && (
            <ScanGridRenderer
              scanResult={scanResult}
              vp={vp}
              width={size.w}
              height={size.h}
              focusMode={focusMode}
              hoveredPass={hoveredPass}
              onPassHover={onPassHover}
            />
          )}

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
        </Layer>
      </Stage>

      {/* Canvas controls — bottom-right */}
      <div className="absolute bottom-3 right-3 flex flex-col items-center gap-1.5 z-20 select-none">
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
            { label: '↓', col: 2, row: 2, dx:  0,    dy:  0.25 },
            { label: '→', col: 3, row: 2, dx:  0.25, dy:  0    },
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
              <div className="font-semibold">P{hoverInfo.fromIdx + 1}–P{hoverInfo.toIdx + 1}</div>
              <div className="opacity-80">Length:&nbsp;{fmtDisplay(hoverInfo.length, displayUnit, 2)}</div>
            </>
          )}
          {hoverInfo.kind === 'surface' && (
            <>
              <div className="font-semibold">Surface:&nbsp;{hoverInfo.surfaceIndex + 1}</div>
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
