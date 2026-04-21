import { useEffect, useRef, useState } from 'react'
import jsPDF from 'jspdf'
import type { RotationOptimum, SampleShape, ScanParameters, ScanPass, ScanResult, SnapshotInfo, StageConstraints } from '../../types/scan'
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
  getSnapshot?: () => SnapshotInfo | null
  shape?: SampleShape | null
  scanParams?: ScanParameters
  stage?: StageConstraints
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
    '=== ScanPlan – Scan Configuration ===',
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
  getSnapshot,
  shape,
  scanParams,
  stage,
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

  const handleExportCsv = () => {
    if (!result) return
    const isRotated = activeTab === 'rotated' && rotatedScanResult &&
      rotatedScanResult.passes.length < result.passes.length
    const src = isRotated ? rotatedScanResult! : result
    const dec = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!.decimals
    const lines = [`No,Tile,X (${displayUnit}),Y (${displayUnit})`]
    let order = 1
    for (const pass of src.passes) {
      for (const pt of pass.grid_points) {
        lines.push(
          `${order},Tile ${pass.pass_number},` +
          `${umToDisplay(pt.x, displayUnit).toFixed(dec)},` +
          `${umToDisplay(pt.y, displayUnit).toFixed(dec)}`
        )
        order++
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    a.download = `ScanPoints-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.csv`
    a.href = url
    a.click()
    URL.revokeObjectURL(url)
    analytics.csvExported(src.total_points, src.passes.length)
  }

  const handleExportPdf = () => {
    if (!result) return
    const isRotated = activeTab === 'rotated' && rotatedScanResult &&
      rotatedScanResult.passes.length < result.passes.length
    const src = isRotated ? rotatedScanResult! : result
    const snapshot = getSnapshot?.()

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210, H = 297, margin = 14, footerY = 284
    const contentW = W - margin * 2

    // Area formatter safe for jsPDF (no Unicode superscripts)
    const fmtArea = (mm2: number): string => {
      if (mm2 >= 100)    return `${(mm2 / 100).toFixed(3)} cm2`
      if (mm2 >= 0.0001) return `${mm2.toFixed(4)} mm2`
      return `${(mm2 * 1e6).toFixed(2)} um2`
    }

    // Header bar
    pdf.setFillColor(30, 64, 175)
    pdf.rect(0, 0, W, 18, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(13)
    pdf.setFont('helvetica', 'bold')
    pdf.text('ScanPlan  |  Scan Report', margin, 12)

    let y = 26

    // Canvas snapshot — preserve actual aspect ratio, scale to fit within bounds
    if (snapshot) {
      try {
        const imgProps = (pdf as unknown as { getImageProperties: (s: string) => { width: number; height: number } })
          .getImageProperties(snapshot.dataURL)
        const ratio = imgProps.height / imgProps.width
        const maxH = 110  // mm — cap so config still fits on page 1
        let imgW = contentW
        let imgH = imgW * ratio
        if (imgH > maxH) { imgH = maxH; imgW = imgH / ratio }
        const imgX = margin + (contentW - imgW) / 2
        pdf.addImage(snapshot.dataURL, 'PNG', imgX, y, imgW, imgH)

        // Draw scan dots on top of the snapshot using jsPDF circles
        const { vp, canvasW, canvasH } = snapshot
        const DOT_R = 0.35  // dot radius in mm on the PDF
        src.passes.forEach((pass) => {
          for (const pt of pass.grid_points) {
            const cx = (pt.x - vp.left) * vp.scale / canvasW
            const cy = (pt.y - vp.top)  * vp.scale / canvasH
            if (cx < 0 || cx > 1 || cy < 0 || cy > 1) continue
            const px = imgX + cx * imgW
            const py = y    + cy * imgH
            pdf.setFillColor(250, 204, 21)    // yellow fill
            pdf.setDrawColor(146, 64, 14)     // amber stroke
            pdf.setLineWidth(0.1)
            pdf.circle(px, py, DOT_R, 'FD')
          }
        })

        y += imgH + 7
      } catch { /* skip if snapshot fails */ }
    }

    // ── Layout helpers ───────────────────────────────────────────────────────
    const SEC_H   = 7
    const ROW_H   = 5.5
    const PAGE_BOT = footerY - 4

    const newPage = () => { pdf.addPage(); y = margin + 4 }
    const checkSpace = (needed: number) => { if (y + needed > PAGE_BOT) newPage() }

    const section = (title: string, minRows = 1) => {
      checkSpace(SEC_H + minRows * ROW_H)
      pdf.setFillColor(226, 232, 240)
      pdf.rect(margin, y, contentW, SEC_H - 1, 'F')
      pdf.setTextColor(51, 65, 85)
      pdf.setFontSize(7.5)
      pdf.setFont('helvetica', 'bold')
      pdf.text(title.toUpperCase(), margin + 3, y + 4.4)
      y += SEC_H + 4
    }

    let rowIdx = 0
    const row = (label: string, value: string) => {
      checkSpace(ROW_H + 1)
      if (rowIdx % 2 === 1) {
        pdf.setFillColor(248, 250, 252)
        pdf.rect(margin, y - 3.8, contentW, ROW_H, 'F')
      }
      rowIdx++
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8.5)
      pdf.setTextColor(71, 85, 105)
      pdf.text(label, margin + 3, y)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(15, 23, 42)
      pdf.text(value, margin + 80, y)
      y += ROW_H
    }

    // ── Scan summary ─────────────────────────────────────────────────────────
    rowIdx = 0
    section('Scan Summary', 4)
    row('Total points',  fmtCount(src.total_points))
    row('Tiles',         String(src.passes.length))
    row('Total area',    fmtArea(src.total_area_mm2))
    row('Estimated time', fmtTime(src.estimated_time_minutes))
    y += 3

    // ── Sample shape ─────────────────────────────────────────────────────────
    if (shape) {
      rowIdx = 0
      const shapeRows = shape.type === 'rectangle' ? 5 : shape.type === 'circle' ? 4 : 2
      section('Sample Shape', shapeRows)
      const typeLabel = shape.type === 'rectangle' ? 'Rectangle'
        : shape.type === 'circle' ? 'Circle' : 'Custom polygon'
      row('Shape type', typeLabel)
      if (shape.type === 'rectangle' && shape.rect) {
        row(`X origin (${displayUnit})`, umToDisplay(shape.rect.x,      displayUnit).toFixed(4))
        row(`Y origin (${displayUnit})`, umToDisplay(shape.rect.y,      displayUnit).toFixed(4))
        row(`Width (${displayUnit})`,    umToDisplay(shape.rect.width,  displayUnit).toFixed(4))
        row(`Height (${displayUnit})`,   umToDisplay(shape.rect.height, displayUnit).toFixed(4))
      } else if (shape.type === 'circle' && shape.circle) {
        row(`Center X (${displayUnit})`, umToDisplay(shape.circle.cx,     displayUnit).toFixed(4))
        row(`Center Y (${displayUnit})`, umToDisplay(shape.circle.cy,     displayUnit).toFixed(4))
        row(`Radius (${displayUnit})`,   umToDisplay(shape.circle.radius, displayUnit).toFixed(4))
      } else if (shape.type === 'freeform' && shape.freeform) {
        row('Vertices', String(shape.freeform.points.length))
      }
      y += 3
    }

    // ── Scan parameters ───────────────────────────────────────────────────────
    if (scanParams) {
      rowIdx = 0
      section('Scan Parameters', 3)
      row(`Step X (${displayUnit})`, umToDisplay(scanParams.step_x, displayUnit).toFixed(4))
      row(`Step Y (${displayUnit})`, umToDisplay(scanParams.step_y, displayUnit).toFixed(4))
      row('Point overlap',           `${(scanParams.overlap * 100).toFixed(0)}%`)
      y += 3
    }

    // ── Stage constraints ─────────────────────────────────────────────────────
    if (stage) {
      rowIdx = 0
      section('Stage Constraints', 4)
      row(`Max scan width (${displayUnit})`,  umToDisplay(stage.max_scan_width,  displayUnit).toFixed(4))
      row(`Max scan height (${displayUnit})`, umToDisplay(stage.max_scan_height, displayUnit).toFixed(4))
      row('Time per point',  `${stage.time_per_point_seconds} s`)
      row('Tile overlap',    `${(stage.tile_overlap * 100).toFixed(0)}%`)
      y += 3
    }

    // ── Tiles table ───────────────────────────────────────────────────────────
    section('Tiles', 3)

    const dec = DISPLAY_UNIT_OPTIONS.find((o) => o.value === displayUnit)!.decimals
    const C = {
      tile:   margin + 2,
      pts:    margin + 22,
      startX: margin + 46,
      startY: margin + 90,
      stepX:  margin + 131,
      stepY:  margin + 153,
    }

    const drawTileHeader = () => {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.5)
      pdf.setTextColor(100, 116, 139)
      pdf.text('Tile',                      C.tile,   y)
      pdf.text('Points',                    C.pts,    y)
      pdf.text(`Start X (${displayUnit})`,  C.startX, y)
      pdf.text(`Start Y (${displayUnit})`,  C.startY, y)
      pdf.text(`Step X (${displayUnit})`,   C.stepX,  y)
      pdf.text(`Step Y (${displayUnit})`,   C.stepY,  y)
      y += 3.5
      pdf.setDrawColor(203, 213, 225)
      pdf.line(margin, y, margin + contentW, y)
      y += 3
    }

    drawTileHeader()

    src.passes.forEach((pass, idx) => {
      if (y > PAGE_BOT) {
        newPage()
        drawTileHeader()
      }
      if (idx % 2 === 1) {
        pdf.setFillColor(248, 250, 252)
        pdf.rect(margin, y - 3.5, contentW, 5, 'F')
      }
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(15, 23, 42)
      pdf.text(`Tile ${pass.pass_number}`,                                     C.tile,   y)
      pdf.text(fmtCount(pass.total_points),                                    C.pts,    y)
      pdf.text(umToDisplay(pass.start_point.x, displayUnit).toFixed(dec),      C.startX, y)
      pdf.text(umToDisplay(pass.start_point.y, displayUnit).toFixed(dec),      C.startY, y)
      pdf.text(umToDisplay(pass.delta_x,        displayUnit).toFixed(dec),     C.stepX,  y)
      pdf.text(umToDisplay(pass.delta_y,        displayUnit).toFixed(dec),     C.stepY,  y)
      y += 5
    })

    // ── Warnings ──────────────────────────────────────────────────────────────
    if (src.warnings.length > 0) {
      y += 3
      rowIdx = 0
      section('Warnings', src.warnings.length)
      src.warnings.forEach((w) => {
        checkSpace(ROW_H * 2)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8)
        pdf.setTextColor(180, 83, 9)
        const lines = pdf.splitTextToSize(`! ${w}`, contentW - 6) as string[]
        pdf.text(lines, margin + 3, y)
        y += lines.length * ROW_H
      })
    }

    // ── Footer on every page ──────────────────────────────────────────────────
    const pageCount = (pdf as unknown as { internal: { getNumberOfPages: () => number } })
      .internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i)
      pdf.setFillColor(241, 245, 249)
      pdf.rect(0, footerY, W, H - footerY, 'F')
      pdf.setDrawColor(203, 213, 225)
      pdf.line(margin, footerY, W - margin, footerY)
      pdf.setFontSize(7)
      pdf.setTextColor(148, 163, 184)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`Generated by ScanPlan  ${new Date().toLocaleString()}`, margin, footerY + 5)
      pdf.text(`Page ${i} / ${pageCount}`, W - margin, footerY + 5, { align: 'right' })
    }

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    pdf.save(`ScanReport-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.pdf`)
    analytics.pdfExported(pageCount, src.passes.length, !!snapshot)
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
      <div className="flex items-center justify-between gap-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#888]">Scan Parameters</h3>
        <div className="flex items-center gap-1 shrink-0 pr-1">
          <button
            onClick={handleCopy}
            className="text-[10px] px-2 py-1 rounded border border-gray-200 dark:border-[#3a3a3a] text-gray-500 dark:text-[#888] hover:border-blue-400 hover:text-blue-500 dark:hover:border-[#4a9eff] dark:hover:text-[#4a9eff] transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onClick={handleExportCsv}
            title="Export scan points as CSV"
            className="text-[10px] px-2 py-1 rounded border border-green-400 text-green-600 dark:border-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
          >
            CSV
          </button>
          <button
            onClick={handleExportPdf}
            title="Export report as PDF"
            className="text-[10px] px-2 py-1 rounded border border-red-400 text-red-600 dark:border-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            PDF
          </button>
        </div>
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
                      X: <strong>{rotationOptimum.angle_deg}°</strong>
                    </span>
                    <span className="text-[10px] font-mono text-amber-700 dark:text-amber-300">
                      Y: <strong>{+(90 - rotationOptimum.angle_deg).toFixed(1)}°</strong>
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
