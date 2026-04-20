import { useEffect, useRef, useState } from 'react'
import type { FrameSegment } from '../../types/scan'
import type { DisplayUnit } from '../../utils/units'
import { displayToUm, umToDisplay } from '../../utils/units'
import Tooltip from '../UI/Tooltip'

interface Props {
  enabled: boolean
  onToggle: (v: boolean) => void
  segments: FrameSegment[]
  onSegmentWidthChange: (id: string, widthUm: number) => void
  displayUnit: DisplayUnit
}

const INPUT_CLS =
  'bg-white border border-gray-200 rounded px-2 py-0.5 text-xs text-gray-800 font-mono ' +
  'focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-colors ' +
  'dark:bg-[#2c2c2c] dark:border-[#3a3a3a] dark:text-[#d4d4d4] dark:focus:border-[#4a9eff] dark:focus:ring-[#4a9eff]/30'

const FRAME_COLORS = ['#f97316','#ec4899','#8b5cf6','#06b6d4','#22c55e','#eab308','#ef4444','#3b82f6']

function WidthInput({ value, onChange, displayUnit }: { value: number; onChange: (n: number) => void; displayUnit: DisplayUnit }) {
  const fmt = (um: number) => String(umToDisplay(um, displayUnit))
  const [raw, setRaw] = useState(() => fmt(value))
  const prev = useRef(value)
  const prevUnit = useRef(displayUnit)
  useEffect(() => {
    if (value !== prev.current || displayUnit !== prevUnit.current) {
      prev.current = value
      prevUnit.current = displayUnit
      setRaw(fmt(value))
    }
  }, [value, displayUnit])
  return (
    <input
      type="number" min={0} step={0.1}
      value={raw}
      className={INPUT_CLS + ' w-20'}
      onChange={(e) => {
        setRaw(e.target.value)
        const n = parseFloat(e.target.value)
        if (!isNaN(n) && n >= 0) onChange(displayToUm(n, displayUnit))
      }}
      onBlur={() => {
        const n = parseFloat(raw)
        if (isNaN(n) || n < 0) setRaw(fmt(value))
        else { prev.current = displayToUm(n, displayUnit); onChange(displayToUm(n, displayUnit)); setRaw(fmt(displayToUm(n, displayUnit))) }
      }}
    />
  )
}

export default function FrameControls({ enabled, onToggle, segments, onSegmentWidthChange, displayUnit }: Props) {
  if (segments.length === 0) {
    return (
      <p className="text-[10px] text-gray-400 dark:text-[#555] leading-relaxed">
        Define a shape first to configure its frame.
      </p>
    )
  }

  return (
    <section className="space-y-2.5">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700 dark:text-[#d4d4d4]">Show frame overlay</span>
        <Tooltip text="Colored overlay strips drawn outside the sample boundary. Each segment (F1, F2, ...) has a configurable width. Visual reference only - does not affect scan points.">
          <button
            onClick={() => onToggle(!enabled)}
            className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${enabled ? 'bg-orange-400' : 'bg-gray-300 dark:bg-[#444]'}`}
          >
            <span className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </Tooltip>
      </div>

      {enabled && (
        <div className="space-y-1">
          <p className="text-[9px] text-gray-400 dark:text-[#555] leading-relaxed">
            Width of each frame segment drawn outside the shape edge.
          </p>
          {segments.map((seg, i) => (
            <Tooltip key={seg.id} text={`Width of frame segment ${seg.label}`} side="right">
              <div className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-50 dark:hover:bg-[#252525]">
                <span
                  className="text-[10px] font-mono font-bold w-6 shrink-0"
                  style={{ color: FRAME_COLORS[i % FRAME_COLORS.length] }}
                >
                  {seg.label}
                </span>
                <WidthInput
                  value={seg.widthUm}
                  onChange={(v) => onSegmentWidthChange(seg.id, v)}
                  displayUnit={displayUnit}
                />
                <span className="text-[10px] text-gray-400 dark:text-[#555]">{displayUnit}</span>
              </div>
            </Tooltip>
          ))}
        </div>
      )}

      {!enabled && (
        <p className="text-[10px] text-gray-400 dark:text-[#555] leading-relaxed">
          Enable to show colored frame segments around the sample boundary.
        </p>
      )}
    </section>
  )
}
