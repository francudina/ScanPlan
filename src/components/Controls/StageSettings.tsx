import { useEffect, useState } from 'react'
import type { StageConstraints } from '../../types/scan'
import {
  type DisplayUnit,
  DISPLAY_UNIT_OPTIONS,
  displayToUm,
  umToDisplay,
} from '../../utils/units'
import Tooltip from '../UI/Tooltip'

interface Props {
  constraints: StageConstraints
  displayUnit: DisplayUnit
  onChange: (c: StageConstraints) => void
}

const INPUT_CLS =
  'w-full bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-800 font-mono ' +
  'focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-colors ' +
  'dark:bg-[#2c2c2c] dark:border-[#3a3a3a] dark:text-[#d4d4d4] dark:focus:border-[#4a9eff] dark:focus:ring-[#4a9eff]/30'

const LABEL_CLS = 'text-[10px] font-medium text-gray-500 dark:text-[#888] uppercase tracking-wide select-none'

const ROW_CLS =
  'flex items-center gap-1 rounded px-1 py-0.5 transition-colors border border-transparent ' +
  'hover:bg-gray-50 dark:hover:bg-[#252525]'

const AXIS_CLS = 'text-[10px] text-gray-400 dark:text-[#555] shrink-0'

function NumericInput({
  value,
  onChange,
  step = 0.1,
  min,
  className = '',
}: {
  value: number
  onChange: (n: number) => void
  step?: number
  min?: number
  className?: string
}) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])

  return (
    <input
      type="number"
      step={step}
      min={min}
      value={raw}
      className={className}
      onChange={(e) => {
        setRaw(e.target.value)
        const n = parseFloat(e.target.value)
        if (!isNaN(n) && isFinite(n) && n > 0) onChange(n)
      }}
      onBlur={() => {
        const n = parseFloat(raw)
        if (isNaN(n) || !isFinite(n) || n <= 0) setRaw(String(value))
        else { setRaw(String(n)); onChange(n) }
      }}
    />
  )
}

export default function StageSettings({ constraints, displayUnit, onChange }: Props) {
  const set = (patch: Partial<StageConstraints>) => onChange({ ...constraints, ...patch })
  const opts = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!

  return (
    <section className="space-y-3">
      {/* Size — Width and Height each on their own line */}
      <Tooltip text="Maximum horizontal and vertical scan range of the stage" side="right">
        <div className="space-y-0.5">
          <span className={LABEL_CLS}>Stage Size</span>
          <div className={ROW_CLS + ' w-full'}>
            <span className={AXIS_CLS + ' w-4 shrink-0'}>W</span>
            <NumericInput
              value={umToDisplay(constraints.max_scan_width, displayUnit)}
              onChange={(v) => set({ max_scan_width: displayToUm(v, displayUnit) })}
              step={opts.step}
              className={INPUT_CLS + ' flex-1'}
            />
            <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
          </div>
          <div className={ROW_CLS + ' w-full'}>
            <span className={AXIS_CLS + ' w-4 shrink-0'}>H</span>
            <NumericInput
              value={umToDisplay(constraints.max_scan_height, displayUnit)}
              onChange={(v) => set({ max_scan_height: displayToUm(v, displayUnit) })}
              step={opts.step}
              className={INPUT_CLS + ' flex-1'}
            />
            <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
          </div>
        </div>
      </Tooltip>

      {/* Time per point row */}
      <Tooltip text="Acquisition time per spectrum point. Used to estimate total scan duration." side="right">
        <div className={ROW_CLS + ' w-full'}>
          <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555] w-12 shrink-0">Time</span>
          <input
            type="number"
            className={INPUT_CLS + ' flex-1'}
            value={constraints.time_per_point_seconds.toFixed(2)}
            min={0.01}
            step={0.01}
            onChange={(e) => {
              const n = parseFloat(e.target.value)
              if (!isNaN(n) && n > 0) set({ time_per_point_seconds: Math.round(n * 100) / 100 })
            }}
          />
          <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>s / pt</span>
        </div>
      </Tooltip>

      {/* Tile overlap */}
      <Tooltip text="Overlap between adjacent scan tiles when the sample is larger than the stage scan window" side="right">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className={LABEL_CLS}>Tile Overlap</span>
            <span className="text-[10px] font-mono text-gray-500 dark:text-[#888]">
              {Math.round((constraints.tile_overlap ?? 0) * 100)} %
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            step={5}
            value={Math.round((constraints.tile_overlap ?? 0) * 100)}
            onChange={(e) => set({ tile_overlap: parseInt(e.target.value) / 100 })}
            className="w-full h-1.5 rounded accent-[#4a9eff] cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-gray-300 dark:text-[#555]">
            <span>0%</span><span>20%</span><span>40%</span>
          </div>
        </div>
      </Tooltip>

    </section>
  )
}
