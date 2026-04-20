import { useEffect, useState } from 'react'
import type { ScanParameters } from '../../types/scan'
import {
  type DisplayUnit,
  DISPLAY_UNIT_OPTIONS,
  displayToUm,
  fmtDisplay,
  umToDisplay,
} from '../../utils/units'
import Tooltip from '../UI/Tooltip'

interface Props {
  params: ScanParameters
  displayUnit: DisplayUnit
  onChange: (params: ScanParameters) => void
  inputMode: 'step' | 'count' | 'total'
  onInputModeChange: (mode: 'step' | 'count' | 'total') => void
  targetNx: number
  targetNy: number
  onTargetNxChange: (n: number) => void
  onTargetNyChange: (n: number) => void
  targetTotal: number
  onTargetTotalChange: (n: number) => void
}

const INPUT_CLS =
  'w-full bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-800 font-mono ' +
  'focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-colors ' +
  'dark:bg-[#2c2c2c] dark:border-[#3a3a3a] dark:text-[#d4d4d4] dark:focus:border-[#4a9eff] dark:focus:ring-[#4a9eff]/30'

const LABEL_CLS =
  'text-[10px] font-medium uppercase tracking-wide select-none cursor-default ' +
  'text-gray-500 dark:text-[#888]'

const ROW_CLS =
  'flex items-center gap-1 rounded px-1 py-0.5 transition-colors border border-transparent ' +
  'hover:bg-gray-50 dark:hover:bg-[#252525]'

const AXIS_CLS = 'text-[10px] text-gray-400 dark:text-[#555] shrink-0'

/** Buffered numeric input — lets user type partially without field resetting */
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



export default function ScanParamsForm({
  params, displayUnit, onChange,
  inputMode, onInputModeChange,
  targetNx, targetNy, onTargetNxChange, onTargetNyChange,
  targetTotal, onTargetTotalChange,
}: Props) {
  const set = (patch: Partial<ScanParameters>) => onChange({ ...params, ...patch })
  const opts = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!

  return (
    <section className="space-y-3">

      {/* Mode toggle */}
      <div className="flex rounded border border-gray-200 dark:border-[#3a3a3a] overflow-hidden text-[10px] font-semibold uppercase tracking-wide">
        {(['step', 'count', 'total'] as const).map((m) => (
          <button
            key={m}
            onClick={() => onInputModeChange(m)}
            className={`flex-1 py-1 transition-colors ${
              inputMode === m
                ? 'bg-blue-500 text-white dark:bg-[#4a9eff]'
                : 'text-gray-500 dark:text-[#888] hover:bg-gray-100 dark:hover:bg-[#2a2a2a]'
            }`}
          >
            {m === 'step' ? 'Offset' : m === 'count' ? 'Grid' : 'Total'}
          </button>
        ))}
      </div>

      {inputMode === 'step' ? (
        /* ── Step / offset mode ────────────────────────────────────────────── */
        <Tooltip text="Distance between adjacent scan points (X horizontal, Y vertical)" side="right">
          <div className="space-y-0.5">
            <span className={LABEL_CLS}>Offset</span>
            <div className={ROW_CLS + ' w-full'}>
              <span className={AXIS_CLS + ' w-4 shrink-0'}>X</span>
              <NumericInput
                value={umToDisplay(params.step_x, displayUnit)}
                onChange={(v) => set({ step_x: Math.max(0.001, displayToUm(v, displayUnit)) })}
                step={opts.step}
                className={INPUT_CLS + ' flex-1'}
              />
              <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
            </div>
            <div className={ROW_CLS + ' w-full'}>
              <span className={AXIS_CLS + ' w-4 shrink-0'}>Y</span>
              <NumericInput
                value={umToDisplay(params.step_y, displayUnit)}
                onChange={(v) => set({ step_y: Math.max(0.001, displayToUm(v, displayUnit)) })}
                step={opts.step}
                className={INPUT_CLS + ' flex-1'}
              />
              <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>{displayUnit}</span>
            </div>
          </div>
        </Tooltip>
      ) : inputMode === 'count' ? (
        /* ── Grid mode ─────────────────────────────────────────────────────── */
        <Tooltip text="Number of scan points along X and Y axes. Step size is computed from the shape bounding box." side="right">
          <div className="space-y-0.5">
            <span className={LABEL_CLS}>Grid</span>
            <div className={ROW_CLS + ' w-full'}>
              <span className={AXIS_CLS + ' w-4 shrink-0'}>X</span>
              <NumericInput
                value={targetNx}
                onChange={(v) => onTargetNxChange(Math.max(1, Math.round(v)))}
                step={1}
                className={INPUT_CLS + ' flex-1'}
              />
              <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>dots</span>
            </div>
            <div className={ROW_CLS + ' w-full'}>
              <span className={AXIS_CLS + ' w-4 shrink-0'}>Y</span>
              <NumericInput
                value={targetNy}
                onChange={(v) => onTargetNyChange(Math.max(1, Math.round(v)))}
                step={1}
                className={INPUT_CLS + ' flex-1'}
              />
              <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>dots</span>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-[#555] px-1 pt-0.5 leading-relaxed">
              Step is derived from shape size at generate time.
            </p>
          </div>
        </Tooltip>
      ) : inputMode === 'total' ? (
        /* ── Total dots mode ───────────────────────────────────────────────── */
        <Tooltip text="Enter total number of scan points. Grid and step sizes are calculated from shape geometry, inner offset, and exclusion zones, and reflected in the other tabs." side="right">
          <div className="space-y-0.5">
            <span className={LABEL_CLS}>Total Dots</span>
            <div className={ROW_CLS + ' w-full'}>
              <NumericInput
                value={targetTotal}
                onChange={(v) => onTargetTotalChange(Math.max(1, Math.round(v)))}
                step={1}
                className={INPUT_CLS + ' flex-1'}
              />
              <span className={AXIS_CLS + ' w-10 text-right shrink-0'}>dots</span>
            </div>
          </div>
        </Tooltip>
      ) : null}

      {/* Overlap */}
      <div className="flex flex-col gap-1">
        <Tooltip text="Fraction of step size that adjacent points overlap. 0% = no overlap, 50% = half-step overlap" side="right">
          <div className={ROW_CLS + ' w-full'}>
            <span className="text-[10px] font-mono font-semibold text-gray-400 dark:text-[#555] w-12 shrink-0">Overlap</span>
            <input
              type="range"
              className="flex-1 h-1 appearance-none rounded cursor-pointer accent-blue-500 bg-gray-300 dark:accent-[#4a9eff] dark:bg-[#444]"
              min={0} max={0.5} step={0.01}
              value={params.overlap}
              onChange={(e) => set({ overlap: parseFloat(e.target.value) })}
            />
            <span className="text-xs font-mono w-10 text-right shrink-0 text-gray-700 dark:text-[#d4d4d4]">
              {(params.overlap * 100).toFixed(0)}%
            </span>
          </div>
        </Tooltip>
        {params.overlap > 0 && inputMode === 'step' && (
          <span className="text-[10px] font-mono leading-relaxed text-gray-400 dark:text-[#555] px-1">
            eff X: {fmtDisplay(params.step_x * (1 - params.overlap), displayUnit, opts.decimals)}
            &nbsp;&nbsp;Y: {fmtDisplay(params.step_y * (1 - params.overlap), displayUnit, opts.decimals)}
          </span>
        )}
      </div>

    </section>
  )
}
