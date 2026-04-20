import { useEffect, useRef, useState } from 'react'
import type { RotationOptimum, ScanPass, ScanResult } from '../../types/scan'
import {
  type DisplayUnit,
  DISPLAY_UNIT_OPTIONS,
  fmtAreaDisplay,
  fmtCount,
  fmtDisplay,
  fmtMm2,
  fmtTime,
  umToDisplay,
} from '../../utils/units'
import { analytics } from '../../utils/analytics'

interface Props {
  result: ScanResult | null
  displayUnit: DisplayUnit
  isLoading: boolean
  error: string | null
  focusMode: boolean
  hoveredPass: number | null
  onPassHover: (pass: number | null) => void
  rotationOptimizerEnabled: boolean
  onRotationOptimizerToggle: (v: boolean) => void
  rotationOptimum: RotationOptimum | null
  rotatedScanResult?: ScanResult | null
  activeTab?: 'current' | 'rotated'
  onActiveTabChange?: (tab: 'current' | 'rotated') => void
}

const PASS_COLORS = ['#4a9eff', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#06b6d4']

function buildCopyText(result: ScanResult, displayUnit: DisplayUnit): string {
  // Full precision: convert to display unit and strip trailing zeros
  const fmtFull = (um: number): string => {
    const val = umToDisplay(um, displayUnit)
    // Use enough decimal places then strip trailing zeros
    const s = val.toFixed(10).replace(/\.?0+$/, '')
    return `${s} ${displayUnit}`
  }
  const lines: string[] = [
    '=== Raman Scan Configuration ===',
    `Unit: ${displayUnit}`,
    '',
  ]

  result.passes.forEach((pass) => {
    lines.push(`Tile ${pass.pass_number}:`)
    lines.push(`  Stage position:  X = ${fmtFull(pass.start_point.x)},  Y = ${fmtFull(pass.start_point.y)}`)
    lines.push(`  Start (X, Y):  ${fmtFull(pass.start_point.x)}  ,  ${fmtFull(pass.start_point.y)}`)
    lines.push(`  Step X:  ${fmtFull(pass.delta_x)}`)
    lines.push(`  Step Y:  ${fmtFull(pass.delta_y)}`)
    lines.push(`  Dots X:  ${fmtCount(pass.nx)}`)
    lines.push(`  Dots Y:  ${fmtCount(pass.ny)}`)
    lines.push(`  Points:  ${fmtCount(pass.total_points)}  (${pass.nx} cols x ${pass.ny} rows)`)
    lines.push(`  Area:  ${fmtMm2(pass.area_mm2)}`)
    lines.push('')
  })

  lines.push('─────────────────────────────────────')
  lines.push(`Total points:    ${fmtCount(result.total_points)}`)
  lines.push(`Total area:      ${fmtMm2(result.total_area_mm2)}`)
  lines.push(`Estimated time:  ${fmtTime(result.estimated_time_minutes)}`)

  if (result.warnings.length > 0) {
    lines.push('')
    lines.push('Warnings:')
    result.warnings.forEach((w) => lines.push(`  ⚠  ${w}`))
  }

  return lines.join('\n')
}

export default function ScanResults({
  result,
  displayUnit,
  isLoading,
  error,
  focusMode,
  hoveredPass,
  onPassHover,
  rotationOptimizerEnabled,
  onRotationOptimizerToggle,
  rotationOptimum,
  rotatedScanResult,
  activeTab: activeTabProp,
  onActiveTabChange,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [detailPass, setDetailPass] = useState<ScanPass | null>(null)
  const [loadingPass, setLoadingPass] = useState<number | null>(null)
  const [activeTabLocal, setActiveTabLocal] = useState<'current' | 'rotated'>('current')
  const passRefs = useRef<Record<number, HTMLDivElement | null>>({})

  const activeTab = activeTabProp ?? activeTabLocal
  const setActiveTab = (tab: 'current' | 'rotated') => {
    setActiveTabLocal(tab)
    onActiveTabChange?.(tab)
  }
  useEffect(() => {
    if (hoveredPass === null) return
    const el = passRefs.current[hoveredPass]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [hoveredPass])

  const handleCopy = async () => {
    if (!result) return
    const isRotated = activeTab === 'rotated' && rotatedScanResult &&
      rotatedScanResult.passes.length < result.passes.length
    const toCopy = isRotated ? rotatedScanResult! : result
    await navigator.clipboard.writeText(buildCopyText(toCopy, displayUnit))
    setCopied(true)
    analytics.scanCopied()
    setTimeout(() => setCopied(false), 2000)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-[#666] gap-2">
        <div className="w-5 h-5 border-2 border-[#4a9eff] border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">Computing scan grid…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-600 dark:text-red-400">
        <strong className="text-red-700 dark:text-red-300">Error:</strong> {error}
      </div>
    )
  }

  if (!result) {
    return (
      <div className="text-xs text-gray-400 dark:text-[#555] text-center py-8 leading-relaxed">
        Define a shape and click{' '}
        <strong className="text-gray-500 dark:text-[#888]">Generate Scan</strong>{' '}
        to see scan parameters here.
      </div>
    )
  }

  const multiTile = result.passes.length > 1

  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#888]">Scan Parameters</h3>
        <button
          onClick={handleCopy}
          className="text-[10px] px-2 py-1 rounded border border-gray-200 dark:border-[#3a3a3a] text-gray-500 dark:text-[#888] hover:border-blue-400 hover:text-blue-500 dark:hover:border-[#4a9eff] dark:hover:text-[#4a9eff] transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy all'}
        </button>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((w, i) => (
            <div
              key={i}
              className="flex gap-2 text-[10px] rounded border border-amber-400 bg-amber-50 p-2 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-400"
            >
              <span>⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div className="rounded border border-gray-200 dark:border-[#333] bg-white dark:bg-[#252525] px-3 py-2 space-y-1.5">
        {[
          { label: 'Total points', val: fmtCount(result.total_points) },
          { label: 'Total area', val: fmtAreaDisplay(result.total_area_mm2 * 1e6, displayUnit) },
          { label: 'Estimated time', val: fmtTime(result.estimated_time_minutes) },
        ].map(({ label, val }) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-gray-400 dark:text-[#666]">{label}</span>
            <span className="font-mono text-gray-800 dark:text-[#d4d4d4]">{val}</span>
          </div>
        ))}
        {multiTile && (
          <div className="pt-1 border-t border-gray-200 dark:border-[#333] text-[10px] text-amber-600 dark:text-amber-400">
            {result.passes.length} tiles, reposition stage between each tile.
          </div>
        )}
      </div>

      {/* Rotation optimizer — only shown when multi-tile */}
      {multiTile && (
        <div className="rounded border border-gray-200 dark:border-[#333] bg-white dark:bg-[#252525] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2">
            <div>
              <span className="text-xs font-medium text-gray-700 dark:text-[#d4d4d4]">Rotation optimizer</span>
              <p className="text-[9px] text-gray-400 dark:text-[#666] mt-0.5">
                Find the angle that minimises tile count
              </p>
            </div>
            <button
              onClick={() => onRotationOptimizerToggle(!rotationOptimizerEnabled)}
              className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${
                rotationOptimizerEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-[#444]'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  rotationOptimizerEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {rotationOptimizerEnabled && rotationOptimum && (
            rotatedScanResult && rotatedScanResult.passes.length < result.passes.length ? (
              <div className="mx-3 mb-2 rounded border border-amber-400 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 space-y-1.5">
                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">Rotation suggested</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Rotating sample by <strong>{rotationOptimum.angle_deg}°</strong> reduces tiles from{' '}
                  <strong>{result.passes.length}</strong> to{' '}
                  <strong>{rotatedScanResult.passes.length}</strong>.
                </p>
                <div className="border-t border-amber-300 dark:border-amber-700/40 pt-1.5 space-y-0.5">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">Alignment angles</p>
                  <div className="flex gap-4">
                    <span className="text-[10px] font-mono text-amber-700 dark:text-amber-300">
                      → X: <strong>{rotationOptimum.angle_deg}°</strong>
                    </span>
                    <span className="text-[10px] font-mono text-amber-700 dark:text-amber-300">
                      ↑ Y: <strong>{+(90 - rotationOptimum.angle_deg).toFixed(1)}°</strong>
                    </span>
                  </div>
                </div>
                <p className="text-[9px] text-amber-600 dark:text-amber-500">
                  Rotate the sample around its centre before placing on the stage.
                </p>
              </div>
            ) : (
              <p className="px-3 pb-2 text-[9px] text-gray-400 dark:text-[#666]">
                No rotation benefit, current orientation is already optimal ({result.passes.length} tile{result.passes.length !== 1 ? 's' : ''}).
              </p>
            )
          )}
        </div>
      )}

      {/* Tabs — shown when rotation optimizer finds actual benefit */}
      {multiTile && rotationOptimizerEnabled && rotationOptimum &&
        rotatedScanResult && rotatedScanResult.passes.length < result.passes.length && (
        <div className="flex rounded overflow-hidden border border-gray-200 dark:border-[#333]">
          {(['current', 'rotated'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                activeTab === tab
                  ? 'bg-white dark:bg-[#252525] text-gray-800 dark:text-[#d4d4d4]'
                  : 'bg-gray-100 dark:bg-[#2a2a2a] text-gray-400 dark:text-[#666] hover:text-gray-600 dark:hover:text-[#aaa]'
              }`}
            >
              {tab === 'current'
                ? `Current (${result.passes.length} tile${result.passes.length !== 1 ? 's' : ''})`
                : `Rotated ${rotationOptimum.angle_deg}° (${rotatedScanResult.passes.length} tile${rotatedScanResult.passes.length !== 1 ? 's' : ''})`}
            </button>
          ))}
        </div>
      )}

      {/* Per-tile blocks */}
      {(activeTab === 'rotated' && rotatedScanResult && rotationOptimizerEnabled &&
        rotatedScanResult.passes.length < result.passes.length
          ? rotatedScanResult
          : result
      ).passes.map((pass, idx) => {
        const color = PASS_COLORS[idx % PASS_COLORS.length]
        const d = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!.decimals
        const fmt = (um: number) => fmtDisplay(um, displayUnit, d)
        const isHovered = focusMode && hoveredPass === pass.pass_number
        const isDimmed = focusMode && hoveredPass !== null && hoveredPass !== pass.pass_number
        return (
          <div
            key={pass.pass_number}
            ref={(el) => { passRefs.current[pass.pass_number] = el }}
            className="rounded border overflow-hidden transition-opacity"
            style={{
              borderColor: color + (isHovered ? 'aa' : '44'),
              opacity: isDimmed ? 0.4 : 1,
            }}
            onMouseEnter={() => focusMode && onPassHover(pass.pass_number)}
            onMouseLeave={() => focusMode && onPassHover(null)}
          >
            {/* Tile header */}
            <div
              className="px-3 py-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: color + '18', color }}
            >
              <span>Tile {pass.pass_number}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono">{fmtCount(pass.total_points)} pts</span>
                <button
                  onClick={() => {
                    setLoadingPass(pass.pass_number)
                    analytics.passDetailOpened(pass.pass_number)
                    setTimeout(() => { setDetailPass(pass); setLoadingPass(null) }, 50)
                  }}
                  className="text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide transition-colors min-w-[48px] flex items-center justify-center gap-1"
                  style={{ borderColor: color + '88', color, background: color + '18' }}
                  onMouseEnter={e => (e.currentTarget.style.background = color + '33')}
                  onMouseLeave={e => (e.currentTarget.style.background = color + '18')}
                >
                  {loadingPass === pass.pass_number ? (
                    <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="15" strokeLinecap="round"/>
                    </svg>
                  ) : 'Details'}
                </button>
              </div>
            </div>

            {/* Stage position row */}
            <div
              className="px-3 pt-2 pb-1.5 flex items-center gap-3 text-xs border-b"
              style={{ borderColor: color + '22', background: color + '08' }}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#666] shrink-0 leading-tight">
                Move<br />stage
              </span>
              <div className="grid grid-cols-2 gap-x-3 min-w-0">
                <span className="font-mono font-semibold whitespace-nowrap" style={{ color }}>
                  X = {fmt(pass.start_point.x)}
                </span>
                <span className="font-mono font-semibold whitespace-nowrap" style={{ color }}>
                  Y = {fmt(pass.start_point.y)}
                </span>
              </div>
            </div>

            {/* Scan detail table */}
            <div className="px-3 py-2 bg-white dark:bg-[#252525]">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#666] pb-1 w-10"></th>
                    <th className="text-right text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#666] pb-1">X</th>
                    <th className="text-right text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#666] pb-1">Y</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Start', x: fmt(pass.start_point.x), y: fmt(pass.start_point.y) },
                    { label: 'Step',  x: fmt(pass.delta_x),       y: fmt(pass.delta_y)       },
                    { label: 'Dots',  x: fmtCount(pass.nx),       y: fmtCount(pass.ny)       },
                  ].map(({ label, x, y }) => (
                    <tr key={label}>
                      <td className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#666] py-0.5">{label}</td>
                      <td className="text-right font-mono text-gray-800 dark:text-[#d4d4d4] py-0.5">{x}</td>
                      <td className="text-right font-mono text-gray-800 dark:text-[#d4d4d4] py-0.5">{y}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-gray-200 dark:border-[#333] pt-1.5 mt-1.5 flex justify-between text-xs">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#666]">Area</span>
                <span className="font-mono text-gray-600 dark:text-[#aaa]">{fmtAreaDisplay(pass.area_mm2 * 1e6, displayUnit)}</span>
              </div>
            </div>
          </div>
        )
      })}

      {/* Tile dots detail modal */}
      {detailPass && (() => {
        const idx = result!.passes.indexOf(detailPass)
        const color = PASS_COLORS[idx % PASS_COLORS.length]
        const d = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!.decimals
        const fmt = (um: number) => fmtDisplay(um, displayUnit, d)
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setDetailPass(null)}
          >
            <div
              className="relative bg-white dark:bg-[#1e1e1e] rounded-lg shadow-2xl border border-gray-200 dark:border-[#333] w-[calc(100vw-2rem)] max-w-[420px] max-h-[80vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div
                className="px-4 py-3 flex items-center justify-between rounded-t-lg border-b border-gray-200 dark:border-[#333]"
                style={{ background: color + '18' }}
              >
                <div>
                  <span className="text-sm font-bold" style={{ color }}>Tile {detailPass.pass_number}</span>
                  <span className="ml-2 text-xs text-gray-400 dark:text-[#888]">
                    {fmtCount(detailPass.total_points)} points
                  </span>
                </div>
                <button
                  onClick={() => setDetailPass(null)}
                  className="text-gray-400 hover:text-gray-600 dark:text-[#666] dark:hover:text-[#aaa] text-lg leading-none"
                >
                  ×
                </button>
              </div>
              <div className="px-4 py-1.5 grid grid-cols-3 gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-[#666] border-b border-gray-100 dark:border-[#2a2a2a]">
                <span>#</span>
                <span>X</span>
                <span>Y</span>
              </div>
              <div className="overflow-y-auto flex-1 px-4 py-1 divide-y divide-gray-100 dark:divide-[#2a2a2a]">
                {detailPass.grid_points.map((pt, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 py-1 text-xs font-mono text-gray-700 dark:text-[#ccc]">
                    <span className="text-gray-400 dark:text-[#555]">{i + 1}</span>
                    <span>{fmt(pt.x)}</span>
                    <span>{fmt(pt.y)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
