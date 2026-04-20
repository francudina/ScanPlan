import { useEffect, useRef, useState } from 'react'
import type {
  CircleParams,
  DrawMode,
  RectParams,
  SampleShape,
  ShapeType,
} from '../../types/scan'
import {
  type DisplayUnit,
  DISPLAY_UNIT_OPTIONS,
  displayToUm,
  mmToUm,
  umToDisplay,
} from '../../utils/units'
import Tooltip from '../UI/Tooltip'
import { analytics } from '../../utils/analytics'

interface Props {
  shape: SampleShape | null
  drawMode: DrawMode
  displayUnit: DisplayUnit
  onDrawModeChange: (mode: DrawMode) => void
  onShapeChange: (shape: SampleShape) => void
  onClear: () => void
}

const shapeTypes: { label: string; value: ShapeType; hint: string }[] = [
  { label: 'Rectangle', value: 'rectangle', hint: 'Define a rectangular scan area' },
  { label: 'Circle', value: 'circle', hint: 'Define a circular scan area' },
  { label: 'Custom', value: 'freeform', hint: 'Define a custom polygon scan area' },
]

const drawModes: { label: string; value: DrawMode; icon: string | null; hint: string }[] = [
  { label: 'Select', value: 'select', icon: null, hint: 'Select & move shapes' },
  { label: 'Rect', value: 'rectangle', icon: '▭', hint: 'Draw a rectangle by dragging' },
  { label: 'Circle', value: 'circle', icon: '○', hint: 'Draw a circle by dragging' },
  { label: 'Custom', value: 'freeform', icon: '✏', hint: 'Click to add vertices; double-click or click near start to close' },
]

const INPUT_CLS =
  'w-full bg-white border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-mono text-gray-800 ' +
  'focus:outline-none focus:border-blue-400 transition-colors ' +
  'dark:bg-[#2c2c2c] dark:border-[#3a3a3a] dark:text-[#d4d4d4] dark:focus:border-[#4a9eff]'

const LABEL_CLS =
  'text-[10px] font-medium uppercase tracking-wide select-none cursor-default ' +
  'text-gray-500 dark:text-[#888]'

const ROW_CLS =
  'flex items-center gap-1 rounded px-1 py-0.5 transition-colors border border-transparent ' +
  'hover:bg-gray-50 dark:hover:bg-[#252525]'

const AXIS_CLS = 'text-[10px] text-gray-400 dark:text-[#555] shrink-0'

/** Buffered input — lets user type "-10", "1.", etc. without field resetting */
function NumericInput({
  value,
  onChange,
  step = 0.1,
  className = '',
}: {
  value: number
  onChange: (n: number) => void
  step?: number
  className?: string
}) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])

  return (
    <input
      type="number"
      step={step}
      value={raw}
      className={className}
      onChange={(e) => {
        const str = e.target.value
        setRaw(str)
        const n = parseFloat(str)
        if (!isNaN(n) && isFinite(n)) onChange(n)
      }}
      onBlur={() => {
        const n = parseFloat(raw)
        if (isNaN(n) || !isFinite(n)) setRaw(String(value))
        else { setRaw(String(n)); onChange(n) }
      }}
    />
  )
}

export default function ShapeControls({
  shape,
  drawMode,
  displayUnit,
  onDrawModeChange,
  onShapeChange,
  onClear,
}: Props) {
  const activeShapeType = shape?.type ?? null
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [pointsExpanded, setPointsExpanded] = useState(false)
  const POINTS_PREVIEW = 4
  const importRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    if (!shape) return
    const c = (um: number) => umToDisplay(um, displayUnit)
    let payload: Record<string, unknown> = { unit: displayUnit, type: shape.type }
    if (shape.type === 'rectangle' && shape.rect) {
      const r = shape.rect
      payload.rect = { x: c(r.x), y: c(r.y), width: c(r.width), height: c(r.height) }
    } else if (shape.type === 'circle' && shape.circle) {
      const ci = shape.circle
      payload.circle = { cx: c(ci.cx), cy: c(ci.cy), radius: c(ci.radius) }
    } else if (shape.type === 'freeform' && shape.freeform) {
      payload.freeform = { points: shape.freeform.points.map((p) => ({ x: c(p.x), y: c(p.y) })) }
    }
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const datetime =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `CustomShape-${datetime}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string)
        const validUnits: DisplayUnit[] = ['nm', 'µm', 'mm', 'cm']
        const fileUnit: DisplayUnit = validUnits.includes(raw.unit) ? raw.unit : 'µm'
        const c = (val: number) => displayToUm(val, fileUnit)
        let imported: SampleShape | null = null
        if (raw.type === 'rectangle' && raw.rect) {
          const r = raw.rect
          imported = { type: 'rectangle', rect: { x: c(r.x), y: c(r.y), width: c(r.width), height: c(r.height) } }
        } else if (raw.type === 'circle' && raw.circle) {
          const ci = raw.circle
          imported = { type: 'circle', circle: { cx: c(ci.cx), cy: c(ci.cy), radius: c(ci.radius) } }
        } else if (raw.type === 'freeform' && Array.isArray(raw.freeform?.points)) {
          imported = { type: 'freeform', freeform: { points: raw.freeform.points.map((p: { x: number; y: number }) => ({ x: c(p.x), y: c(p.y) })) } }
        }
        if (!imported) { alert('Invalid shape file: missing or unknown shape type.'); return }
        onShapeChange(imported)
        analytics.shapeTypeSelected(imported.type)
      } catch {
        alert('Failed to parse shape file. Make sure it is a valid CustomShape JSON.')
      } finally {
        if (importRef.current) importRef.current.value = ''
      }
    }
    reader.readAsText(file)
  }

  const opts = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!

  const setShapeType = (type: ShapeType) => {
    analytics.shapeTypeSelected(type)
    if (type === 'rectangle') {
      onShapeChange({ type, rect: shape?.rect ?? { x: 0, y: 0, width: mmToUm(200), height: mmToUm(100) } })
    } else if (type === 'circle') {
      onShapeChange({ type, circle: shape?.circle ?? { cx: 0, cy: 0, radius: mmToUm(50) } })
    } else {
      // Derive 4 corners from rectangle so the user can continue editing as freeform
      let points = shape?.freeform?.points
      if (!points && shape?.type === 'rectangle' && shape.rect) {
        const r = shape.rect
        points = [
          { x: r.x,           y: r.y            },
          { x: r.x + r.width, y: r.y            },
          { x: r.x + r.width, y: r.y + r.height },
          { x: r.x,           y: r.y + r.height },
        ]
      }
      onShapeChange({
        type: 'freeform',
        freeform: { points: points ?? [{ x: 0, y: 0 }, { x: mmToUm(200), y: 0 }, { x: mmToUm(200), y: mmToUm(100) }, { x: 0, y: mmToUm(100) }] },
      })
      onDrawModeChange('freeform')
      return
    }
    onDrawModeChange('select')
  }

  const updateRect = (patch: Partial<RectParams>) => {
    if (!shape) return
    onShapeChange({ ...shape, type: 'rectangle', rect: { ...(shape.rect ?? { x: 0, y: 0, width: 0, height: 0 }), ...patch } })
  }

  const updateCircle = (patch: Partial<CircleParams>) => {
    if (!shape) return
    onShapeChange({ ...shape, type: 'circle', circle: { ...(shape.circle ?? { cx: 0, cy: 0, radius: 0 }), ...patch } })
  }

  const activeBtn = 'border-blue-400 bg-blue-50 text-blue-600 dark:border-[#4a9eff] dark:bg-[#1a3a5c] dark:text-[#4a9eff]'
  const idleBtn = 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:border-[#3a3a3a] dark:bg-[#2c2c2c] dark:text-[#888] dark:hover:bg-[#333] dark:hover:text-[#bbb]'

  return (
    <section className="space-y-4">

      {/* Draw tools */}
      <div>
        <p className={LABEL_CLS + ' mb-2'}>Draw Tool</p>
        <div className="grid grid-cols-4 gap-1">
          {drawModes.map((m) => (
            <Tooltip key={m.value} text={m.hint} side="top">
              <button
                onClick={() => { analytics.drawModeSelected(m.value); onDrawModeChange(m.value) }}
                className={`w-full flex flex-col items-center justify-center py-2 rounded border text-xs transition-colors ${drawMode === m.value ? activeBtn : idleBtn}`}
              >
                {m.value === 'select' ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 20" fill="currentColor">
                    <path d="M1 1 L1 14 L4.5 10.5 L7.5 18 L9.5 17 L6.5 9.5 L12 9.5 Z" />
                  </svg>
                ) : m.value === 'freeform' ? (
                  <svg className="w-3 h-4" viewBox="0 0 12 22" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    {/* eraser cap */}
                    <rect x="3.5" y="0.6" width="5" height="3" rx="1" fill="currentColor" stroke="none" />
                    {/* metal band */}
                    <rect x="3" y="3.6" width="6" height="1.4" fill="currentColor" opacity="0.4" stroke="none" />
                    {/* shaft body */}
                    <rect x="3" y="5" width="6" height="11" rx="0.5" fill="currentColor" opacity="0.15" />
                    <line x1="3" y1="5" x2="3" y2="16" />
                    <line x1="9" y1="5" x2="9" y2="16" />
                    {/* tip */}
                    <path d="M3 16 L6 21.4 L9 16 Z" fill="currentColor" stroke="none" />
                  </svg>
                ) : (
                  <span className="text-sm leading-none">{m.icon}</span>
                )}
                <span className="mt-0.5 text-[10px]">{m.label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
        {drawMode === 'freeform' && (
          <p className="mt-1.5 text-[10px] text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-1.5 leading-relaxed dark:text-[#4a9eff] dark:bg-[#1a3a5c]/40 dark:border-[#4a9eff]/20">
            Click to add vertices. Click any existing vertex to resume from it. Click near the first point to close.
          </p>
        )}
      </div>

      {/* Shape type */}
      <div>
        <p className={LABEL_CLS + ' mb-2'}>Sample Shape</p>
        <div className="grid grid-cols-3 gap-1">
          {shapeTypes.map((s) => (
            <Tooltip key={s.value} text={s.hint} side="top">
              <button
                onClick={() => setShapeType(s.value)}
                className={`w-full py-1.5 rounded border text-xs transition-colors ${shape && activeShapeType === s.value ? activeBtn : idleBtn}`}
              >
                {s.label}
              </button>
            </Tooltip>
          ))}
        </div>
        {/* Export / Import — icon only, 2nd row */}
        <div className="grid grid-cols-2 gap-1 mt-1">
          <Tooltip text={shape ? 'Export shape to JSON file' : 'No shape to export'} side="top">
            <button
              onClick={handleExport}
              disabled={!shape}
              className={`w-full flex items-center justify-center py-1.5 rounded border text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${idleBtn}`}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M8 2v8M5 7l3 3 3-3" />
                <path d="M2 12h12" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip text="Import shape from JSON file" side="top">
            <button
              onClick={() => importRef.current?.click()}
              className={`w-full flex items-center justify-center py-1.5 rounded border text-xs transition-colors ${idleBtn}`}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M8 10V2M5 5l3-3 3 3" />
                <path d="M2 12h12" />
              </svg>
            </button>
          </Tooltip>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        </div>
      </div>

      {/* Rectangle dimensions */}
      {shape?.type === 'rectangle' && shape.rect && (
        <div className="space-y-0.5">
          <p className={LABEL_CLS + ' mb-1'}>Dimensions</p>

          <Tooltip text="Top-left corner X and Y coordinates of the rectangle" side="right">
            <div className="space-y-0.5 w-full">
              <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555]">Origin</span>
              <div className={ROW_CLS + ' w-full'}>
                <span className={AXIS_CLS + ' w-4 shrink-0'}>X</span>
                <NumericInput value={umToDisplay(shape.rect.x, displayUnit)} onChange={(v) => updateRect({ x: displayToUm(v, displayUnit) })} step={opts.step} className={INPUT_CLS + ' flex-1'} />
                <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
              </div>
              <div className={ROW_CLS + ' w-full'}>
                <span className={AXIS_CLS + ' w-4 shrink-0'}>Y</span>
                <NumericInput value={umToDisplay(shape.rect.y, displayUnit)} onChange={(v) => updateRect({ y: displayToUm(v, displayUnit) })} step={opts.step} className={INPUT_CLS + ' flex-1'} />
                <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
              </div>
            </div>
          </Tooltip>

          <Tooltip text="Width (X) and height (Y) of the rectangle" side="right">
            <div className="space-y-0.5 w-full">
              <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555]">Size</span>
              <div className={ROW_CLS + ' w-full'}>
                <span className={AXIS_CLS + ' w-4 shrink-0'}>W</span>
                <NumericInput value={umToDisplay(shape.rect.width, displayUnit)} onChange={(v) => updateRect({ width: Math.max(0.001, displayToUm(v, displayUnit)) })} step={opts.step} className={INPUT_CLS + ' flex-1'} />
                <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
              </div>
              <div className={ROW_CLS + ' w-full'}>
                <span className={AXIS_CLS + ' w-4 shrink-0'}>H</span>
                <NumericInput value={umToDisplay(shape.rect.height, displayUnit)} onChange={(v) => updateRect({ height: Math.max(0.001, displayToUm(v, displayUnit)) })} step={opts.step} className={INPUT_CLS + ' flex-1'} />
                <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
              </div>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Circle dimensions */}
      {shape?.type === 'circle' && shape.circle && (
        <div className="space-y-0.5">
          <p className={LABEL_CLS + ' mb-1'}>Dimensions</p>

          <Tooltip text="Center point X and Y coordinates of the circle" side="right">
            <div className="space-y-0.5 w-full">
              <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555]">Center</span>
              <div className={ROW_CLS + ' w-full'}>
                <span className={AXIS_CLS + ' w-4 shrink-0'}>X</span>
                <NumericInput value={umToDisplay(shape.circle.cx, displayUnit)} onChange={(v) => updateCircle({ cx: displayToUm(v, displayUnit) })} step={opts.step} className={INPUT_CLS + ' flex-1'} />
                <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
              </div>
              <div className={ROW_CLS + ' w-full'}>
                <span className={AXIS_CLS + ' w-4 shrink-0'}>Y</span>
                <NumericInput value={umToDisplay(shape.circle.cy, displayUnit)} onChange={(v) => updateCircle({ cy: displayToUm(v, displayUnit) })} step={opts.step} className={INPUT_CLS + ' flex-1'} />
                <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
              </div>
            </div>
          </Tooltip>

          <Tooltip text="Radius of the circle" side="right">
            <div className={ROW_CLS + ' w-full'}>
              <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555] w-12 shrink-0">Radius</span>
              <NumericInput value={umToDisplay(shape.circle.radius, displayUnit)} onChange={(v) => updateCircle({ radius: Math.max(0.001, displayToUm(v, displayUnit)) })} step={opts.step} className={INPUT_CLS + ' flex-1'} />
              <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Freeform points */}
      {shape?.type === 'freeform' && shape.freeform && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className={LABEL_CLS}>Polygon Points <span className="text-gray-400 dark:text-[#555]">({shape.freeform.points.length})</span></p>
            {shape.freeform.points.length > POINTS_PREVIEW && (
              <button
                onClick={() => setPointsExpanded((v) => !v)}
                className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-gray-600 dark:text-[#555] dark:hover:text-[#999] transition-colors"
              >
                {pointsExpanded ? 'Collapse' : 'Expand'}
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={`w-2.5 h-2.5 transition-transform duration-150 ${pointsExpanded ? 'rotate-180' : ''}`}>
                  <path d="M2 4 L6 8 L10 4" />
                </svg>
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {shape.freeform.points.slice(0, pointsExpanded ? undefined : POINTS_PREVIEW).map((p, i) => {
              const pts = shape.freeform!.points
              const isOver = dragOverIndex === i && dragIndex !== i

              const updatePoint = (axis: 'x' | 'y', um: number) => {
                const updated = pts.map((pt, j) => j === i ? { ...pt, [axis]: um } : pt)
                onShapeChange({ ...shape, freeform: { points: updated } })
              }

              const removePoint = () => {
                if (pts.length <= 3) return
                const newPts = pts.filter((_, j) => j !== i)
                analytics.freeformPointRemoved(newPts.length)
                onShapeChange({ ...shape, freeform: { points: newPts } })
              }

              const rowBase = 'rounded px-1 py-0.5 transition-colors border'
              const rowState = isOver
                ? ' bg-blue-50 border-blue-300 dark:bg-[#1a3a5c] dark:border-[#4a9eff]/50'
                : dragIndex === i
                ? ' opacity-40 border-dashed border-gray-300 dark:border-[#555]'
                : ' border-transparent hover:bg-gray-50 dark:hover:bg-[#252525]'
              const rowCls = rowBase + rowState + ' flex flex-col items-start gap-0.5'

              return (
                <div
                  key={i}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i) }}
                  onDrop={() => {
                    if (dragIndex === null || dragIndex === i) return
                    const reordered = [...pts]
                    const [moved] = reordered.splice(dragIndex, 1)
                    reordered.splice(i, 0, moved)
                    onShapeChange({ ...shape, freeform: { points: reordered } })
                    setDragIndex(null); setDragOverIndex(null)
                  }}
                  onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                  className={rowCls}
                >
                  {/* Header: drag handle + point label + delete button */}
                  <div className="flex items-center gap-1 w-full">
                    <span className="text-gray-300 cursor-grab active:cursor-grabbing select-none shrink-0 text-sm leading-none hover:text-gray-500 dark:text-[#444] dark:hover:text-[#888]" title="Drag to reorder">⠿</span>
                    <span className="text-[10px] font-mono font-semibold text-blue-500 w-6 shrink-0 dark:text-[#4a9eff]">P{i + 1}</span>
                    <span className="flex-1" />
                    <Tooltip text={pts.length <= 3 ? 'Need at least 3 points' : `Remove point P${i + 1}`} side="right">
                      <button onClick={removePoint} disabled={pts.length <= 3} className="text-gray-300 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed text-sm leading-none shrink-0 transition-colors dark:text-[#444]">×</button>
                    </Tooltip>
                  </div>
                  {/* X row */}
                  <div className={ROW_CLS + ' w-full'}>
                    <span className={AXIS_CLS + ' w-4 shrink-0'}>X</span>
                    <NumericInput value={umToDisplay(p.x, displayUnit)} onChange={(v) => updatePoint('x', displayToUm(v, displayUnit))} step={opts.step} className={INPUT_CLS + ' flex-1'} />
                    <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
                  </div>
                  {/* Y row */}
                  <div className={ROW_CLS + ' w-full'}>
                    <span className={AXIS_CLS + ' w-4 shrink-0'}>Y</span>
                    <NumericInput value={umToDisplay(p.y, displayUnit)} onChange={(v) => updatePoint('y', displayToUm(v, displayUnit))} step={opts.step} className={INPUT_CLS + ' flex-1'} />
                    <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {shape.freeform.points.length > POINTS_PREVIEW && (
            <button
              onClick={() => setPointsExpanded((v) => !v)}
              className="w-full flex items-center justify-center gap-1 py-1 text-[10px] text-gray-400 hover:text-gray-600 dark:text-[#555] dark:hover:text-[#999] border border-dashed border-gray-200 dark:border-[#333] rounded transition-colors"
            >
              {pointsExpanded ? (
                <>
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5 rotate-180">
                    <path d="M2 4 L6 8 L10 4" />
                  </svg>
                  Show less
                </>
              ) : (
                <>
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-2.5 h-2.5">
                    <path d="M2 4 L6 8 L10 4" />
                  </svg>
                  Show {shape.freeform.points.length - POINTS_PREVIEW} more
                </>
              )}
            </button>
          )}

          <div className="grid grid-cols-2 gap-1">
            <Tooltip text="Add a new vertex after the last point" side="top">
              <button
                onClick={() => {
                  const pts = shape.freeform!.points
                  const last = pts[pts.length - 1]
                  const newPts = [...pts, { x: last.x + displayToUm(1, displayUnit), y: last.y }]
                  analytics.freeformPointAdded(newPts.length)
                  onShapeChange({ ...shape, freeform: { points: newPts } })
                }}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-blue-400 text-blue-500 text-xs font-semibold hover:bg-blue-400 hover:text-white transition-colors shadow dark:border-[#4a9eff] dark:text-[#4a9eff] dark:hover:bg-[#4a9eff] dark:hover:text-white"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3 h-3 shrink-0">
                  <path d="M6 2v8M2 6h8" />
                </svg>
                Add Point
              </button>
            </Tooltip>
            <Tooltip text="Remove the current shape and start over" side="top">
              <button
                onClick={() => { analytics.shapeCleared(); onClear() }}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-red-400 text-red-400 text-xs font-semibold hover:bg-red-400 hover:text-white transition-colors shadow dark:border-red-500 dark:text-red-400 dark:hover:bg-red-500 dark:hover:text-white"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
                  <path d="M2 4h12" />
                  <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
                  <path d="M13 4l-.867 9.143A1 1 0 0 1 11.138 14H4.862a1 1 0 0 1-.995-.857L3 4" />
                  <path d="M6.5 7v4M9.5 7v4" />
                </svg>
                Clear Shape
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {shape && shape.type !== 'freeform' && (
        <Tooltip text="Remove the current shape and start over" side="right">
          <button
            onClick={() => { analytics.shapeCleared(); onClear() }}
            className="w-full flex items-center justify-center gap-2 px-4 py-1.5 rounded border border-red-400 text-red-400 text-xs font-semibold hover:bg-red-400 hover:text-white transition-colors shadow dark:border-red-500 dark:text-red-400 dark:hover:bg-red-500 dark:hover:text-white"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
              <path d="M2 4h12" />
              <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
              <path d="M13 4l-.867 9.143A1 1 0 0 1 11.138 14H4.862a1 1 0 0 1-.995-.857L3 4" />
              <path d="M6.5 7v4M9.5 7v4" />
            </svg>
            Clear Shape
          </button>
        </Tooltip>
      )}
    </section>
  )
}
