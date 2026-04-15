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
}

const INPUT_CLS =
  'w-full bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-800 font-mono ' +
  'focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-colors ' +
  'dark:bg-[#2c2c2c] dark:border-[#3a3a3a] dark:text-[#d4d4d4] dark:focus:border-[#4a9eff] dark:focus:ring-[#4a9eff]/30'

const LABEL_CLS =
  'text-[10px] font-medium uppercase tracking-wide select-none cursor-default ' +
  'text-gray-500 dark:text-[#888]'

function StepField({
  label,
  hint,
  valueUm,
  onChangeUm,
  displayUnit,
}: {
  label: string
  hint: string
  valueUm: number
  onChangeUm: (um: number) => void
  displayUnit: DisplayUnit
}) {
  const opts = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!
  const [raw, setRaw] = useState(String(umToDisplay(valueUm, displayUnit)))

  useEffect(() => {
    setRaw(String(umToDisplay(valueUm, displayUnit)))
  }, [valueUm, displayUnit])

  return (
    <div className="flex flex-col gap-0.5">
      <Tooltip text={hint} side="right">
        <span className={LABEL_CLS + ' border-b border-dashed border-gray-400 dark:border-[#444]'}>{label}</span>
      </Tooltip>
      <div className="flex items-center gap-1">
        <input
          type="number"
          className={INPUT_CLS}
          value={raw}
          step={opts.step}
          onChange={(e) => {
            setRaw(e.target.value)
            const n = parseFloat(e.target.value)
            if (!isNaN(n) && isFinite(n) && n > 0) onChangeUm(displayToUm(n, displayUnit))
          }}
          onBlur={() => {
            const n = parseFloat(raw)
            if (isNaN(n) || !isFinite(n) || n <= 0) setRaw(String(umToDisplay(valueUm, displayUnit)))
            else { setRaw(String(n)); onChangeUm(displayToUm(n, displayUnit)) }
          }}
        />
        <span className="text-[10px] shrink-0 w-7 text-right text-gray-400 dark:text-[#555]">{displayUnit}</span>
      </div>
    </div>
  )
}

const PRESETS_UM = [1, 5, 10, 25, 50, 100, 500, 1000]

export default function ScanParamsForm({ params, displayUnit, onChange }: Props) {
  const set = (patch: Partial<ScanParameters>) => onChange({ ...params, ...patch })
  const opts = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <StepField
          label="Step X (ΔX)"
          hint="Horizontal distance between adjacent scan points"
          valueUm={params.step_x}
          onChangeUm={(v) => set({ step_x: Math.max(0.001, v) })}
          displayUnit={displayUnit}
        />
        <StepField
          label="Step Y (ΔY)"
          hint="Vertical distance between adjacent scan points"
          valueUm={params.step_y}
          onChangeUm={(v) => set({ step_y: Math.max(0.001, v) })}
          displayUnit={displayUnit}
        />
      </div>

      {/* Overlap */}
      <div className="flex flex-col gap-1">
        <Tooltip text="Fraction of step size that adjacent points overlap — 0% = no overlap, 50% = half-step overlap" side="right">
          <span className={LABEL_CLS + ' border-b border-dashed border-gray-400 dark:border-[#444]'}>Overlap</span>
        </Tooltip>
        <div className="flex items-center gap-2">
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
        {params.overlap > 0 && (
          <span className="text-[10px] font-mono leading-relaxed text-gray-400 dark:text-[#555]">
            eff ΔX: {fmtDisplay(params.step_x * (1 - params.overlap), displayUnit, opts.decimals)}
            &nbsp;&nbsp;ΔY: {fmtDisplay(params.step_y * (1 - params.overlap), displayUnit, opts.decimals)}
          </span>
        )}
      </div>

      {/* Quick presets */}
      <div className="flex flex-col gap-0.5">
        <span className={LABEL_CLS}>Quick Presets</span>
        <select
          className="w-full bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 font-mono cursor-pointer
            focus:outline-none focus:border-blue-400 transition-colors
            dark:bg-[#2c2c2c] dark:border-[#3a3a3a] dark:text-[#d4d4d4] dark:focus:border-[#4a9eff]"
          value=""
          onChange={(e) => {
            const um = parseFloat(e.target.value)
            if (!isNaN(um)) set({ step_x: um, step_y: um })
          }}
        >
          <option value="" disabled>Select step size…</option>
          {PRESETS_UM.map((um) => (
            <option key={um} value={um}>
              {fmtDisplay(um, displayUnit, opts.decimals)} {displayUnit}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}
