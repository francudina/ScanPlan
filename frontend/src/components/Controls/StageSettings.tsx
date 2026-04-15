import { useEffect, useState } from 'react'
import type { StageConstraints } from '../../types/scan'
import {
  type DisplayUnit,
  DISPLAY_UNIT_OPTIONS,
  displayToUm,
  fmtDisplay,
  mmToUm,
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

function StageField({
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
        <span className={LABEL_CLS + ' cursor-default border-b border-dashed border-gray-400 dark:border-[#444]'}>{label}</span>
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
        <span className="text-[10px] text-gray-400 dark:text-[#555] shrink-0 w-7 text-right">{displayUnit}</span>
      </div>
    </div>
  )
}

export default function StageSettings({ constraints, displayUnit, onChange }: Props) {
  const set = (patch: Partial<StageConstraints>) => onChange({ ...constraints, ...patch })

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <StageField
          label="Max width"
          hint="Maximum horizontal scan range of the DXR3 stage"
          valueUm={constraints.max_scan_width}
          onChangeUm={(v) => set({ max_scan_width: v })}
          displayUnit={displayUnit}
        />
        <StageField
          label="Max height"
          hint="Maximum vertical scan range of the DXR3 stage"
          valueUm={constraints.max_scan_height}
          onChangeUm={(v) => set({ max_scan_height: v })}
          displayUnit={displayUnit}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        <Tooltip text="Acquisition time per spectrum point — used to estimate total scan duration" side="right">
          <span className={LABEL_CLS + ' cursor-default border-b border-dashed border-gray-400 dark:border-[#444]'}>Time per point</span>
        </Tooltip>
        <div className="flex items-center gap-1">
          <input
            type="number"
            className={INPUT_CLS + ' w-20'}
            value={constraints.time_per_point_seconds}
            min={0.1}
            step={0.5}
            onChange={(e) =>
              set({ time_per_point_seconds: parseFloat(e.target.value) || 1 })
            }
          />
          <span className="text-[10px] text-gray-400 dark:text-[#555] shrink-0">sec</span>
        </div>
      </div>

      {/* DXR3 presets */}
      <div className="flex flex-col gap-0.5">
        <span className={LABEL_CLS}>DXR3 Presets</span>
        <select
          className="w-full bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 font-mono cursor-pointer
            focus:outline-none focus:border-blue-400 transition-colors
            dark:bg-[#2c2c2c] dark:border-[#3a3a3a] dark:text-[#d4d4d4] dark:focus:border-[#4a9eff]"
          value=""
          onChange={(e) => {
            const [w, h] = e.target.value.split(',').map(Number)
            if (!isNaN(w)) set({ max_scan_width: w, max_scan_height: h })
          }}
        >
          <option value="" disabled>Select stage size…</option>
          {[
            { wUm: mmToUm(25), hUm: mmToUm(25) },
            { wUm: mmToUm(50), hUm: mmToUm(50) },
          ].map(({ wUm, hUm }) => (
            <option key={wUm} value={`${wUm},${hUm}`}>
              {fmtDisplay(wUm, displayUnit, 0)} × {fmtDisplay(hUm, displayUnit, 0)} {displayUnit}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}
