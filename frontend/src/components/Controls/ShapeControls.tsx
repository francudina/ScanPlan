import { useEffect, useState } from 'react'
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
  { label: 'Freeform', value: 'freeform', hint: 'Define a custom polygon scan area' },
]

const drawModes: { label: string; value: DrawMode; icon: string | null; hint: string }[] = [
  { label: 'Select', value: 'select', icon: null, hint: 'Select & move shapes' },
  { label: 'Rect', value: 'rectangle', icon: '▭', hint: 'Draw a rectangle by dragging' },
  { label: 'Circle', value: 'circle', icon: '○', hint: 'Draw a circle by dragging' },
  { label: 'Freeform', value: 'freeform', icon: '✏', hint: 'Click to add vertices; double-click or click near start to close' },
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

  const opts = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!

  const setShapeType = (type: ShapeType) => {
    if (type === 'rectangle') {
      onShapeChange({ type, rect: shape?.rect ?? { x: 0, y: 0, width: mmToUm(10), height: mmToUm(5) } })
    } else if (type === 'circle') {
      onShapeChange({ type, circle: shape?.circle ?? { cx: 0, cy: 0, radius: mmToUm(5) } })
    } else {
      onShapeChange({
        type: 'freeform',
        freeform: shape?.freeform ?? {
          points: [{ x: 0, y: 0 }, { x: mmToUm(10), y: 0 }, { x: mmToUm(5), y: mmToUm(10) }],
        },
      })
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
                onClick={() => onDrawModeChange(m.value)}
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
            Click to add vertices. Double-click or click near the first point to close.
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
      </div>

      {/* Rectangle dimensions */}
      {shape?.type === 'rectangle' && shape.rect && (
        <div className="space-y-0.5">
          <p className={LABEL_CLS + ' mb-1'}>Dimensions</p>

          <Tooltip text="Top-left corner X and Y coordinates of the rectangle" side="right">
            <div className={ROW_CLS + ' w-full'}>
              <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555] w-12 shrink-0">Origin</span>
              <span className={AXIS_CLS}>X</span>
              <NumericInput value={umToDisplay(shape.rect.x, displayUnit)} onChange={(v) => updateRect({ x: displayToUm(v, displayUnit) })} step={opts.step} className={INPUT_CLS} />
              <span className={AXIS_CLS}>Y</span>
              <NumericInput value={umToDisplay(shape.rect.y, displayUnit)} onChange={(v) => updateRect({ y: displayToUm(v, displayUnit) })} step={opts.step} className={INPUT_CLS} />
              <span className={AXIS_CLS + ' w-6 text-right'}>{displayUnit}</span>
            </div>
          </Tooltip>

          <Tooltip text="Width (X) and height (Y) of the rectangle" side="right">
            <div className={ROW_CLS + ' w-full'}>
              <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555] w-12 shrink-0">Size</span>
              <span className={AXIS_CLS}>X</span>
              <NumericInput value={umToDisplay(shape.rect.width, displayUnit)} onChange={(v) => updateRect({ width: Math.max(0.001, displayToUm(v, displayUnit)) })} step={opts.step} className={INPUT_CLS} />
              <span className={AXIS_CLS}>Y</span>
              <NumericInput value={umToDisplay(shape.rect.height, displayUnit)} onChange={(v) => updateRect({ height: Math.max(0.001, displayToUm(v, displayUnit)) })} step={opts.step} className={INPUT_CLS} />
              <span className={AXIS_CLS + ' w-6 text-right'}>{displayUnit}</span>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Circle dimensions */}
      {shape?.type === 'circle' && shape.circle && (
        <div className="space-y-0.5">
          <p className={LABEL_CLS + ' mb-1'}>Dimensions</p>

          <Tooltip text="Center point X and Y coordinates of the circle" side="right">
            <div className={ROW_CLS + ' w-full'}>
              <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555] w-12 shrink-0">Center</span>
              <span className={AXIS_CLS}>X</span>
              <NumericInput value={umToDisplay(shape.circle.cx, displayUnit)} onChange={(v) => updateCircle({ cx: displayToUm(v, displayUnit) })} step={opts.step} className={INPUT_CLS} />
              <span className={AXIS_CLS}>Y</span>
              <NumericInput value={umToDisplay(shape.circle.cy, displayUnit)} onChange={(v) => updateCircle({ cy: displayToUm(v, displayUnit) })} step={opts.step} className={INPUT_CLS} />
              <span className={AXIS_CLS + ' w-6 text-right'}>{displayUnit}</span>
            </div>
          </Tooltip>

          <Tooltip text="Radius of the circle" side="right">
            <div className={ROW_CLS + ' w-full'}>
              <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555] w-12 shrink-0">Radius</span>
              <NumericInput value={umToDisplay(shape.circle.radius, displayUnit)} onChange={(v) => updateCircle({ radius: Math.max(0.001, displayToUm(v, displayUnit)) })} step={opts.step} className={INPUT_CLS + ' w-20'} />
              <span className={AXIS_CLS + ' w-6 text-right'}>{displayUnit}</span>
            </div>
          </Tooltip>
        </div>
      )}

      {/* Freeform points */}
      {shape?.type === 'freeform' && shape.freeform && (
        <div className="space-y-1.5">
          <p className={LABEL_CLS}>Polygon Points</p>

          <div className="space-y-0.5">
            {shape.freeform.points.map((p, i) => {
              const pts = shape.freeform!.points
              const isOver = dragOverIndex === i && dragIndex !== i

              const updatePoint = (axis: 'x' | 'y', um: number) => {
                const updated = pts.map((pt, j) => j === i ? { ...pt, [axis]: um } : pt)
                onShapeChange({ ...shape, freeform: { points: updated } })
              }

              const removePoint = () => {
                if (pts.length <= 3) return
                onShapeChange({ ...shape, freeform: { points: pts.filter((_, j) => j !== i) } })
              }

              const rowBase = 'flex items-center gap-1 rounded px-1 py-0.5 transition-colors border'
              const rowCls = isOver
                ? rowBase + ' bg-blue-50 border-blue-300 dark:bg-[#1a3a5c] dark:border-[#4a9eff]/50'
                : dragIndex === i
                ? rowBase + ' opacity-40 border-dashed border-gray-300 dark:border-[#555]'
                : rowBase + ' border-transparent hover:bg-gray-50 dark:hover:bg-[#252525]'

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
                  <span className="text-gray-300 cursor-grab active:cursor-grabbing select-none shrink-0 text-sm leading-none hover:text-gray-500 dark:text-[#444] dark:hover:text-[#888]" title="Drag to reorder">⠿</span>
                  <span className="text-[10px] font-mono font-semibold text-blue-500 w-6 shrink-0 dark:text-[#4a9eff]">P{i + 1}</span>
                  <div className="flex items-center gap-0.5 flex-1">
                    <span className={AXIS_CLS}>X</span>
                    <NumericInput value={umToDisplay(p.x, displayUnit)} onChange={(v) => updatePoint('x', displayToUm(v, displayUnit))} step={opts.step} className={INPUT_CLS} />
                  </div>
                  <div className="flex items-center gap-0.5 flex-1">
                    <span className={AXIS_CLS}>Y</span>
                    <NumericInput value={umToDisplay(p.y, displayUnit)} onChange={(v) => updatePoint('y', displayToUm(v, displayUnit))} step={opts.step} className={INPUT_CLS} />
                  </div>
                  <Tooltip text={pts.length <= 3 ? 'Need at least 3 points' : `Remove point P${i + 1}`} side="right">
                    <button onClick={removePoint} disabled={pts.length <= 3} className="text-gray-300 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed text-sm leading-none shrink-0 transition-colors dark:text-[#444]">×</button>
                  </Tooltip>
                </div>
              )
            })}
          </div>

          <Tooltip text="Add a new vertex after the last point" side="right">
            <button
              onClick={() => {
                const pts = shape.freeform!.points
                const last = pts[pts.length - 1]
                onShapeChange({ ...shape, freeform: { points: [...pts, { x: last.x + displayToUm(1, displayUnit), y: last.y }] } })
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-1.5 rounded border border-blue-400 text-blue-500 text-xs font-semibold hover:bg-blue-400 hover:text-white transition-colors shadow dark:border-[#4a9eff] dark:text-[#4a9eff] dark:hover:bg-[#4a9eff] dark:hover:text-white"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3 h-3 shrink-0">
                <path d="M6 2v8M2 6h8" />
              </svg>
              Add Point
            </button>
          </Tooltip>
        </div>
      )}

      {shape && (
        <Tooltip text="Remove the current shape and start over" side="right">
          <button
            onClick={onClear}
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
