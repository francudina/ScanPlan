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
  pointerToUm,
  shapeBoundingBox,
  umToPixel,
  zoomViewport,
} from '../../utils/geometry'
import { type DisplayUnit, fmtDisplay } from '../../utils/units'

// Pass colours for multi-pass scans
const PASS_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#06b6d4']

interface Props {
  shape: SampleShape | null
  scanResult: ScanResult | null
  drawMode: DrawMode
  darkMode: boolean
  displayUnit: DisplayUnit
  onShapeChange: (shape: SampleShape) => void
}

// ── Grid lines helper ──────────────────────────────────────────────────────────

function CoordGrid({ vp, width, height, darkMode, displayUnit }: { vp: Viewport; width: number; height: number; darkMode: boolean; displayUnit: DisplayUnit }) {
  const gridColor = darkMode ? '#2e2e2e' : '#e5e7eb'
  const labelColor = darkMode ? '#555' : '#9ca3af'

  // Pick a sensible grid spacing in microns
  const rawSpacing = 100 / vp.scale // ~100 px apart
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawSpacing)))
  const candidates = [1, 2, 5, 10].map((m) => m * magnitude)
  const spacing = candidates.find((c) => c * vp.scale >= 60) ?? candidates[candidates.length - 1]

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
        text={fmtDisplay(x, displayUnit, 0)}
        fontSize={9}
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
        text={fmtDisplay(y, displayUnit, 0)}
        fontSize={9}
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
        {/* Segment lines with labels */}
        {pts.map((p, i) => {
          const next = pts[(i + 1) % pts.length]
          const mx = (toX(p.x) + toX(next.x)) / 2
          const my = (toY(p.y) + toY(next.y)) / 2
          const nextLabel = i < pts.length - 1 ? `P${i + 2}` : 'P1'
          return (
            <React.Fragment key={`seg-${i}`}>
              <Line
                points={[toX(p.x), toY(p.y), toX(next.x), toY(next.y)]}
                stroke="#2563eb"
                strokeWidth={1.5}
                listening={false}
              />
              <Text
                x={mx + 3}
                y={my - 9}
                text={`P${i + 1}–${nextLabel}`}
                fontSize={9}
                fill="#2563eb"
                opacity={0.7}
                listening={false}
              />
            </React.Fragment>
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

function ScanGridRenderer({
  scanResult,
  vp,
}: {
  scanResult: ScanResult
  vp: Viewport
}) {
  const toX = (um: number) => umToPixel(um, vp.left, vp.scale)
  const toY = (um: number) => umToPixel(um, vp.top, vp.scale)

  const elements: React.ReactElement[] = []

  scanResult.passes.forEach((pass, passIdx) => {
    const color = PASS_COLORS[passIdx % PASS_COLORS.length]

    // Pass region outline
    elements.push(
      <Rect
        key={`region-${passIdx}`}
        x={toX(pass.region.x_min)}
        y={toY(pass.region.y_min)}
        width={(pass.region.x_max - pass.region.x_min) * vp.scale}
        height={(pass.region.y_max - pass.region.y_min) * vp.scale}
        stroke={color}
        strokeWidth={1.5}
        dash={[8, 4]}
        fill="transparent"
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
        fontSize={11}
        fill={color}
        fontStyle="bold"
        listening={false}
      />,
    )

    if (pass.total_points <= 2000) {
      // Render individual scan points
      pass.grid_points.forEach((pt, ptIdx) => {
        elements.push(
          <Circle
            key={`pt-${passIdx}-${ptIdx}`}
            x={toX(pt.x)}
            y={toY(pt.y)}
            radius={Math.max(1.5, Math.min(3, vp.scale * 3))}
            fill={color}
            opacity={0.8}
            listening={false}
          />,
        )
      })
    } else {
      // Render grid lines for large point sets (performance)
      const r = pass.region
      const stepXpx = pass.delta_x * vp.scale
      const stepYpx = pass.delta_y * vp.scale

      if (stepXpx >= 1) {
        for (let i = 0; i < pass.nx; i++) {
          const px = toX(r.x_min + i * pass.delta_x)
          elements.push(
            <Line
              key={`vline-${passIdx}-${i}`}
              points={[px, toY(r.y_min), px, toY(r.y_max)]}
              stroke={color}
              strokeWidth={0.5}
              opacity={0.5}
              listening={false}
            />,
          )
        }
      }
      if (stepYpx >= 1) {
        for (let j = 0; j < pass.ny; j++) {
          const py = toY(r.y_min + j * pass.delta_y)
          elements.push(
            <Line
              key={`hline-${passIdx}-${j}`}
              points={[toX(r.x_min), py, toX(r.x_max), py]}
              stroke={color}
              strokeWidth={0.5}
              opacity={0.5}
              listening={false}
            />,
          )
        }
      }
      // Corner dots to show actual scan boundaries
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

// ── Main component ─────────────────────────────────────────────────────────────

export default function SampleCanvas({
  shape,
  scanResult,
  drawMode,
  darkMode,
  displayUnit,
  onShapeChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [vp, setVp] = useState<Viewport>({ left: -5000, top: -5000, scale: 0.04 })
  const [drawState, setDrawState] = useState<DrawState>({ mode: 'idle' })
  // Track live rect preview
  const [previewRect, setPreviewRect] = useState<{
    x: number; y: number; w: number; h: number
  } | null>(null)
  const [previewCircle, setPreviewCircle] = useState<{
    cx: number; cy: number; r: number
  } | null>(null)

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

  const getPointerUm = useCallback(
    (e: KonvaEventObject<MouseEvent>): Point => {
      const stage = e.target.getStage()!
      const pos = stage.getPointerPosition()!
      return pointerToUm(pos.x, pos.y, vp)
    },
    [vp],
  )

  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = e.target.getStage()!
      const pos = stage.getPointerPosition()!
      const cursorUm = pointerToUm(pos.x, pos.y, vp)
      const factor = e.evt.deltaY < 0 ? 1.15 : 1 / 1.15
      setVp((v) => zoomViewport(v, cursorUm.x, cursorUm.y, factor))
    },
    [vp],
  )

  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0) return
      const um = getPointerUm(e)

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
          // Close polygon if clicking near first point (within 10px)
          const first = existing[0]
          const dx = (um.x - first.x) * vp.scale
          const dy = (um.y - first.y) * vp.scale
          if (existing.length >= 3 && Math.sqrt(dx * dx + dy * dy) < 12) {
            onShapeChange({
              type: 'freeform',
              freeform: { points: existing },
            })
            setDrawState({ mode: 'idle' })
          } else {
            setDrawState({
              ...drawState,
              points: [...existing, um],
            })
          }
        }
      }
    },
    [drawMode, drawState, getPointerUm, onShapeChange, vp.scale],
  )

  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const um = getPointerUm(e)
      if (drawState.mode === 'drawing_rect') {
        const w = um.x - drawState.startX
        const h = um.y - drawState.startY
        setPreviewRect({
          x: w >= 0 ? drawState.startX : um.x,
          y: h >= 0 ? drawState.startY : um.y,
          w: Math.abs(w),
          h: Math.abs(h),
        })
      } else if (drawState.mode === 'drawing_circle') {
        const dx = um.x - drawState.cx
        const dy = um.y - drawState.cy
        setPreviewCircle({
          cx: drawState.cx,
          cy: drawState.cy,
          r: Math.sqrt(dx * dx + dy * dy),
        })
      } else if (drawState.mode === 'drawing_freeform') {
        setDrawState({ ...drawState, preview: um })
      }
    },
    [drawState, getPointerUm],
  )

  const handleMouseUp = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const um = getPointerUm(e)
      if (drawState.mode === 'drawing_rect') {
        const w = Math.abs(um.x - drawState.startX)
        const h = Math.abs(um.y - drawState.startY)
        if (w > 1 && h > 1) {
          onShapeChange({
            type: 'rectangle',
            rect: {
              x: Math.min(drawState.startX, um.x),
              y: Math.min(drawState.startY, um.y),
              width: w,
              height: h,
            },
          })
        }
        setDrawState({ mode: 'idle' })
        setPreviewRect(null)
      } else if (drawState.mode === 'drawing_circle') {
        const dx = um.x - drawState.cx
        const dy = um.y - drawState.cy
        const r = Math.sqrt(dx * dx + dy * dy)
        if (r > 1) {
          onShapeChange({
            type: 'circle',
            circle: { cx: drawState.cx, cy: drawState.cy, radius: r },
          })
        }
        setDrawState({ mode: 'idle' })
        setPreviewCircle(null)
      }
    },
    [drawState, getPointerUm, onShapeChange],
  )

  const handleDblClick = useCallback(
    (_e: KonvaEventObject<MouseEvent>) => {
      if (drawState.mode === 'drawing_freeform' && drawState.points.length >= 3) {
        onShapeChange({
          type: 'freeform',
          freeform: { points: drawState.points },
        })
        setDrawState({ mode: 'idle' })
      }
    },
    [drawState, onShapeChange],
  )

  const toX = (um: number) => umToPixel(um, vp.left, vp.scale)
  const toY = (um: number) => umToPixel(um, vp.top, vp.scale)

  const cursor =
    drawMode === 'select' ? 'default'
    : drawMode === 'freeform' ? 'crosshair'
    : 'crosshair'

  return (
    <div ref={containerRef} className="w-full h-full bg-white dark:bg-[#1a1a1a]" style={{ cursor }}>
      <Stage
        width={size.w}
        height={size.h}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDblClick}
      >
        {/* Background + coordinate grid (not transformed — drawn in pixel space) */}
        <Layer listening={false}>
          <CoordGrid vp={vp} width={size.w} height={size.h} darkMode={darkMode} displayUnit={displayUnit} />
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
          {/* Origin dot */}
          <Circle x={toX(0)} y={toY(0)} radius={3} fill={darkMode ? '#555' : '#6b7280'} />
        </Layer>

        {/* Content layer — shapes, grid, drawing */}
        <Layer listening={false}>
          {/* Sample shape */}
          {shape && <ShapeRenderer shape={shape} vp={vp} />}

          {/* Scan grid */}
          {scanResult && <ScanGridRenderer scanResult={scanResult} vp={vp} />}

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
    </div>
  )
}
