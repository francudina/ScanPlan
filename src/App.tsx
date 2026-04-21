import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateScanGrid, calcTotalModeParams } from './utils/scanGenerator'
import { findOptimalRotation, getRotatedFreeformShape } from './utils/tilingPlanner'
import SampleCanvas from './components/Canvas/SampleCanvas'
import ShapeControls from './components/Controls/ShapeControls'
import ExclusionControls from './components/Controls/ExclusionControls'
import ScanParamsForm from './components/Controls/ScanParamsForm'
import StageSettings from './components/Controls/StageSettings'
import ScanResults from './components/Output/ScanResults'
import FrameControls from './components/Controls/FrameControls'
import Tooltip from './components/UI/Tooltip'
import type {
  DrawMode,
  ExclusionZone,
  FrameSegment,
  FullConfig,
  Point,
  SampleShape,
  ScanParameters,
  ScanResult,
  SnapshotInfo,
  StageConstraints,
  RotationOptimum,
} from './types/scan'
import {
  type DisplayUnit,
  DISPLAY_UNIT_OPTIONS,
  displayToUm,
  mmToUm,
  umToDisplay,
} from './utils/units'
import { analytics } from './utils/analytics'

const DEFAULT_SCAN_PARAMS: ScanParameters = {
  step_x: mmToUm(5),
  step_y: mmToUm(5),
  overlap: 0,
}

const DEFAULT_STAGE: StageConstraints = {
  max_scan_width: mmToUm(50),
  max_scan_height: mmToUm(50),
  time_per_point_seconds: 1,
  tile_overlap: 0,
}

// ── Collapsible panel ─────────────────────────────────────────────────────────

const INPUT_CLS_SHARED =
  'bg-white border border-gray-200 rounded px-2 py-0.5 text-xs text-gray-800 font-mono ' +
  'focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-colors ' +
  'dark:bg-[#2c2c2c] dark:border-[#3a3a3a] dark:text-[#d4d4d4] dark:focus:border-[#4a9eff] dark:focus:ring-[#4a9eff]/30'

function OffsetInput({ valueUm, displayUnit, onChange }: { valueUm: number; displayUnit: DisplayUnit; onChange: (um: number) => void }) {
  const fmt = (um: number) => String(umToDisplay(um, displayUnit))
  const [raw, setRaw] = useState(() => fmt(valueUm))
  const prev = useRef(valueUm)
  const prevUnit = useRef(displayUnit)
  useEffect(() => {
    if (valueUm !== prev.current || displayUnit !== prevUnit.current) {
      prev.current = valueUm
      prevUnit.current = displayUnit
      setRaw(fmt(valueUm))
    }
  }, [valueUm, displayUnit])
  return (
    <input
      type="number" min={0} step={0.1}
      value={raw}
      className={INPUT_CLS_SHARED + ' w-20'}
      onChange={(e) => {
        setRaw(e.target.value)
        const n = parseFloat(e.target.value)
        if (!isNaN(n) && n >= 0) { prev.current = displayToUm(n, displayUnit); onChange(displayToUm(n, displayUnit)) }
      }}
      onBlur={() => {
        const n = parseFloat(raw)
        if (isNaN(n) || n < 0) setRaw(fmt(valueUm))
        else { const um = displayToUm(n, displayUnit); prev.current = um; setRaw(fmt(um)) }
      }}
    />
  )
}

function CollapsiblePanel({
  title,
  defaultOpen = true,
  info,
  children,
}: {
  title: string
  defaultOpen?: boolean
  info?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded overflow-hidden border border-gray-200 dark:border-[#3a3a3a]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors select-none bg-gray-100 dark:bg-[#2c2c2c] hover:bg-gray-200 dark:hover:bg-[#333] text-gray-500 dark:text-[#a0a0a0] hover:text-gray-700 dark:hover:text-[#d4d4d4]"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest">{title}</span>
          {info && (
            <Tooltip text={info}>
              <span
                className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[8px] font-bold shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                i
              </span>
            </Tooltip>
          )}
        </span>
        <svg
          className={`w-3 h-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M2 4 L6 8 L10 4" />
        </svg>
      </button>

      {open && <div className="p-3 bg-white dark:bg-[#1e1e1e]">{children}</div>}
    </div>
  )
}

// ── Root app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [shape, setShape] = useState<SampleShape | null>(null)
  const [, setShapeHistory] = useState<(SampleShape | null)[]>([])
  const [drawMode, setDrawMode] = useState<DrawMode>('rectangle')
  const [scanParams, setScanParams] = useState<ScanParameters>(DEFAULT_SCAN_PARAMS)
  const [stage, setStage] = useState<StageConstraints>(DEFAULT_STAGE)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('mm')

  // Scan input mode: step size or target dot count or total dots
  const [scanInputMode, setScanInputMode] = useState<'step' | 'count' | 'total'>('step')
  const [targetNx, setTargetNx] = useState(10)
  const [targetNy, setTargetNy] = useState(10)
  const [targetTotal, setTargetTotal] = useState(25)

  // Keep offset and dot-count fields in sync based on stage max scan size:
  //   step = max_scan / (n - 1)  <->  n = round(max_scan / step) + 1
  const handleScanParamsChange = (p: ScanParameters) => {
    setScanParams(p)
    if (p.step_x > 0) setTargetNx(Math.max(2, Math.round(stage.max_scan_width / p.step_x) + 1))
    if (p.step_y > 0) setTargetNy(Math.max(2, Math.round(stage.max_scan_height / p.step_y) + 1))
  }
  const handleTargetNxChange = (nx: number) => {
    setTargetNx(nx)
    if (nx > 1) setScanParams(p => ({ ...p, step_x: stage.max_scan_width / (nx - 1) }))
  }
  const handleTargetNyChange = (ny: number) => {
    setTargetNy(ny)
    if (ny > 1) setScanParams(p => ({ ...p, step_y: stage.max_scan_height / (ny - 1) }))
  }

  const handleStageChange = (s: StageConstraints) => {
    setStage(s)
    // Re-sync dot counts to new stage size
    if (scanParams.step_x > 0) setTargetNx(Math.max(2, Math.round(s.max_scan_width / scanParams.step_x) + 1))
    if (scanParams.step_y > 0) setTargetNy(Math.max(2, Math.round(s.max_scan_height / scanParams.step_y) + 1))
  }

  const [hasGenerated, setHasGenerated] = useState(false)
  const [focusMode, setFocusMode] = useState(true)
  const [hoveredPass, setHoveredPass] = useState<number | null>(null)

  // Rotation optimizer
  const [rotationOptimizerEnabled, setRotationOptimizerEnabled] = useState(false)
  const [rotationOptimum, setRotationOptimum] = useState<RotationOptimum | null>(null)
  const [rotatedScanResult, setRotatedScanResult] = useState<ScanResult | null>(null)
  const [rotationTab, setRotationTab] = useState<'current' | 'rotated'>('current')

  const handleRotationOptimizerToggle = useCallback((v: boolean) => {
    analytics.rotationOptimizerToggled(v)
    setRotationOptimizerEnabled(v)
  }, [])

  const handleRotationTabChange = useCallback((tab: 'current' | 'rotated') => {
    const saving = rotatedScanResult && scanResult
      ? scanResult.passes.length - rotatedScanResult.passes.length : 0
    analytics.rotationTabChanged(tab, saving)
    setRotationTab(tab)
  }, [rotatedScanResult, scanResult])

  const [darkMode, setDarkMode] = useState<boolean>(
    () => document.documentElement.classList.contains('dark')
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  // Mobile panel state
  const [leftOpen, setLeftOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  // Desktop sidebar collapse
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    if (!settingsOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [settingsOpen])

  // Close left drawer when viewport grows past md breakpoint
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => { if (e.matches) setLeftOpen(false) }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Swipe from left edge to open sidebar on mobile
  useEffect(() => {
    let startX = 0
    let startY = 0
    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }
    const onTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX
      const dy = Math.abs(e.changedTouches[0].clientY - startY)
      if (startX < 24 && dx > 60 && dy < 100) setLeftOpen(true)
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const pushHistory = useCallback((prev: SampleShape | null) => {
    setShapeHistory((h) => [...h.slice(-49), prev])
  }, [])

  const handleShapeChange = useCallback((s: SampleShape) => {
    setShape((prev) => { pushHistory(prev); return s })
    setScanResult(null)
    setError(null)
  }, [pushHistory])

  const handleClear = useCallback(() => {
    setShape((prev) => { pushHistory(prev); return null })
    setScanResult(null)
    setError(null)
    setHasGenerated(false)
  }, [pushHistory])

  const handleUndo = useCallback(() => {
    setShapeHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setShape(prev)
      setScanResult(null)
      setError(null)
      if (prev === null) setHasGenerated(false)
      return h.slice(0, -1)
    })
  }, [])

  const [exclusionZones, setExclusionZones] = useState<ExclusionZone[]>([])

  const [frameEnabled, setFrameEnabled] = useState(false)
  const [frameSegments, setFrameSegments] = useState<FrameSegment[]>([])
  const [innerOffsetUm, setInnerOffsetUm] = useState(0)

  // Live calculation for Total mode — accounts for inner offset, shape geometry, exclusion zones
  const totalModeCalc = useMemo(() => {
    if (!shape || scanInputMode !== 'total') return null
    try { return calcTotalModeParams(shape, targetTotal, innerOffsetUm, exclusionZones) }
    catch { return null }
  }, [shape, scanInputMode, targetTotal, innerOffsetUm, exclusionZones])

  // Sync Total mode results back into step/grid state so other tabs reflect the values
  useEffect(() => {
    if (!totalModeCalc) return
    setScanParams((p) => ({ ...p, step_x: totalModeCalc.stepX, step_y: totalModeCalc.stepY }))
    setTargetNx(totalModeCalc.nx)
    setTargetNy(totalModeCalc.ny)
  }, [totalModeCalc])

  const handleExclusionZoneAdd = useCallback((points: Point[]) => {
    setExclusionZones((prev) => {
      const next = [...prev, { id: `ez-${Date.now()}`, points }]
      analytics.exclusionZoneAdded(points.length, next.length)
      return next
    })
    setScanResult(null)
    setDrawMode('select')
  }, [])

  const handleExclusionZoneRemove = useCallback((id: string) => {
    setExclusionZones((prev) => {
      const next = prev.filter((z) => z.id !== id)
      analytics.exclusionZoneRemoved(next.length)
      return next
    })
    setScanResult(null)
  }, [])

  const snapshotFnRef = useRef<(() => SnapshotInfo | null) | null>(null)
  const handleRegisterSnapshot = useCallback((fn: () => SnapshotInfo | null) => {
    snapshotFnRef.current = fn
  }, [])

  const handleImportConfig = useCallback((config: FullConfig) => {
    const { displayUnit: du, shape: s, scanParams: sp, stage: st,
            scanInputMode: sim, targetNx: nx, targetNy: ny,
            rotationOptimizerEnabled: rot } = config
    setShapeHistory([])
    if (s) setShape(s)
    setScanParams(sp)
    setStage(st)
    setDisplayUnit(du as DisplayUnit)
    setScanInputMode(sim)
    setTargetNx(nx)
    setTargetNy(ny)
    setTargetTotal(config.targetTotal ?? 25)
    setRotationOptimizerEnabled(rot)
    setExclusionZones(config.exclusionZones ?? [])
    setFrameEnabled(config.frameEnabled ?? false)
    setFrameSegments(config.frameSegments ?? [])
    setInnerOffsetUm(config.innerOffsetUm ?? 0)
    setScanResult(null)
    setError(null)
    setHasGenerated(false)
  }, [])

  // Ctrl+Z / Cmd+Z undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUndo])

  // Compute rotation optimum when optimizer is toggled or scan result changes
  useEffect(() => {
    if (rotationOptimizerEnabled && scanResult && shape) {
      const optimum = findOptimalRotation(shape, stage)
      setRotationOptimum(optimum)
      if (optimum.tile_count < optimum.baseline_tile_count) {
        try {
          const rotatedShape = getRotatedFreeformShape(shape, optimum.angle_deg)
          const rotated = generateScanGrid(rotatedShape, scanParams, stage)
          // Only keep rotated result if it actually reduces tile count
          if (rotated.passes.length < scanResult.passes.length) {
            setRotatedScanResult(rotated)
            analytics.rotationOptimumFound(optimum.angle_deg, scanResult.passes.length, rotated.passes.length)
          } else {
            setRotatedScanResult(null)
            setRotationTab('current')
          }
        } catch {
          setRotatedScanResult(null)
        }
      } else {
        setRotatedScanResult(null)
      }
    } else {
      setRotationOptimum(null)
      setRotatedScanResult(null)
      setRotationTab('current')
    }
  }, [rotationOptimizerEnabled, scanResult, shape, stage])

  // Derive frame segments from shape
  useEffect(() => {
    if (!shape) { setFrameSegments([]); return }
    const DEFAULT_W = 0
    const makeSegments = (sides: string[]): FrameSegment[] =>
      sides.map((side, i) => {
        const label = `F${i + 1}`
        const existing = frameSegments.find((s) => s.id === `f${i + 1}`)
        return { id: `f${i + 1}`, label, widthUm: existing?.widthUm ?? DEFAULT_W, side }
      })

    if (shape.type === 'rectangle') {
      setFrameSegments(makeSegments(['top', 'right', 'bottom', 'left']))
    } else if (shape.type === 'circle') {
      setFrameSegments(makeSegments(['arc']))
    } else if (shape.type === 'freeform' && shape.freeform) {
      setFrameSegments(makeSegments(shape.freeform.points.map((_, i) => `edge-${i}`)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape])

  const handleFrameSegmentWidthChange = useCallback((id: string, widthUm: number) => {
    setFrameSegments((prev) => prev.map((s) => s.id === id ? { ...s, widthUm } : s))
  }, [])

  const handleGenerate = () => {
    setLeftOpen(false) // close drawer on mobile when generating
    if (!shape) {
      setError('Please define a sample shape first.')
      setHasGenerated(true)
      return
    }
    setIsLoading(true)
    setError(null)
    setHasGenerated(true)
    try {
      let params = scanParams
      if (scanInputMode === 'count') {
        const nx = Math.max(1, targetNx)
        const ny = Math.max(1, targetNy)
        params = {
          ...scanParams,
          step_x: nx > 1 ? stage.max_scan_width / (nx - 1) : stage.max_scan_width,
          step_y: ny > 1 ? stage.max_scan_height / (ny - 1) : stage.max_scan_height,
        }
      } else if (scanInputMode === 'total') {
        const calc = calcTotalModeParams(shape, targetTotal, innerOffsetUm, exclusionZones)
        params = { ...scanParams, step_x: calc.stepX, step_y: calc.stepY }
      }
      const result = generateScanGrid(shape, params, stage, exclusionZones, innerOffsetUm)
      setScanResult(result)
      setDrawMode('select')
      analytics.scanGenerated(result.total_points, shape.type, params.step_x)
      // Auto-open results sheet on mobile
      if (window.innerWidth < 768) setResultsOpen(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }


  return (
    <div className="flex flex-col h-screen h-[100dvh] bg-gray-50 dark:bg-[#111] overflow-hidden print:h-auto print:overflow-visible">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-3 py-2 bg-white dark:bg-[#161616] border-b border-gray-200 dark:border-[#2e2e2e] shrink-0 gap-2">

        <div className="flex items-center gap-2 min-w-0">
          {/* Mobile hamburger */}
          <button
            className="md:hidden flex items-center justify-center w-8 h-8 rounded border border-gray-200 dark:border-[#3a3a3a] bg-white dark:bg-[#2c2c2c] text-gray-500 dark:text-[#888] hover:bg-gray-50 dark:hover:bg-[#333] transition-colors shrink-0"
            onClick={() => setLeftOpen(true)}
            title="Open controls"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </button>

          <div className="w-7 h-7 rounded shrink-0 shadow overflow-hidden">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" className="w-full h-full">
              <rect width="32" height="32" rx="6" fill="#1e40af"/>
              <circle cx="8"  cy="8"  r="2" fill="#93c5fd"/>
              <circle cx="16" cy="8"  r="2" fill="#93c5fd"/>
              <circle cx="24" cy="8"  r="2" fill="#93c5fd"/>
              <circle cx="8"  cy="16" r="2" fill="#93c5fd"/>
              <circle cx="16" cy="16" r="2" fill="#ffffff"/>
              <circle cx="24" cy="16" r="2" fill="#93c5fd"/>
              <circle cx="8"  cy="24" r="2" fill="#93c5fd"/>
              <circle cx="16" cy="24" r="2" fill="#93c5fd"/>
              <circle cx="24" cy="24" r="2" fill="#93c5fd"/>
              <line x1="16" y1="10" x2="16" y2="22" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="10" y1="16" x2="22" y2="16" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="hidden sm:block min-w-0">
            <h1 className="text-base font-bold text-gray-900 dark:text-[#e0e0e0] truncate">Raman Sample Analyzer <span className="text-[10px] font-normal text-gray-400 dark:text-[#666]">v1.1.0</span></h1>
            <a href="https://nioquant.com/" target="_blank" rel="noopener noreferrer" className="hidden md:block text-[10px] text-gray-400 dark:text-[#666] hover:text-[#4a9eff] dark:hover:text-[#4a9eff] transition-colors">by nioquant</a>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Contact Developer */}
          <a
            href="mailto:info@nioquant.com"
            onClick={() => analytics.contactClicked()}
            className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-[#4a9eff] hover:text-[#3a8eef] transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
              <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
              <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
            </svg>
            Contact Developer
          </a>

          {/* Settings gear */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              title="Settings"
              className={`flex items-center justify-center w-8 h-8 rounded border transition-colors ${
                settingsOpen
                  ? 'border-blue-400 bg-blue-50 text-blue-500 dark:border-[#4a9eff] dark:bg-[#1a3a5c] dark:text-[#4a9eff]'
                  : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600 dark:border-[#3a3a3a] dark:bg-[#2c2c2c] dark:text-[#666] dark:hover:border-[#555] dark:hover:text-[#aaa]'
              }`}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                />
              </svg>
            </button>

            {settingsOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded border shadow-lg z-50 bg-white dark:bg-[#252525] border-gray-200 dark:border-[#3a3a3a]">
                <div className="p-2.5 space-y-1">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#666] mb-2">Theme</p>
                  <button
                    onClick={() => setDarkMode((v) => {
                      const next = !v
                      analytics.themeToggled(next ? 'dark' : 'light')
                      return next
                    })}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors text-gray-700 dark:text-[#d4d4d4] hover:bg-gray-100 dark:hover:bg-[#333]"
                  >
                    {darkMode ? (
                      <>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-amber-400 shrink-0">
                          <path fillRule="evenodd" clipRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" />
                        </svg>
                        Switch to Light
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-indigo-400 shrink-0">
                          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                        </svg>
                        Switch to Dark
                      </>
                    )}
                  </button>
                  <div className="border-t border-gray-100 dark:border-[#333] pt-1.5 mt-1">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#666] mb-1.5">Canvas</p>
                    <button
                      onClick={() => setFocusMode((v) => { analytics.focusModeToggled(!v); return !v })}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-xs transition-colors text-gray-700 dark:text-[#d4d4d4] hover:bg-gray-100 dark:hover:bg-[#333]"
                    >
                      <span>Focus on hover</span>
                      <span className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${focusMode ? 'bg-blue-500' : 'bg-gray-300 dark:bg-[#444]'}`}>
                        <span className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${focusMode ? 'translate-x-3' : 'translate-x-0'}`} />
                      </span>
                    </button>
                  </div>
                  <div className="border-t border-gray-100 dark:border-[#333] pt-1.5 mt-1">
                    <button
                      onClick={() => { setHelpOpen(true); setSettingsOpen(false); analytics.helpOpened() }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors text-gray-700 dark:text-[#d4d4d4] hover:bg-gray-100 dark:hover:bg-[#333]"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-gray-400 dark:text-[#666] shrink-0">
                        <path fillRule="evenodd" clipRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 10a3 3 0 01-2 2.83V13a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" />
                      </svg>
                      Help
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Unit selector */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400 dark:text-[#666] uppercase tracking-wide hidden sm:inline">Unit</span>
            <select
              value={displayUnit}
              onChange={(e) => {
                const u = e.target.value as DisplayUnit
                setDisplayUnit(u)
                analytics.unitChanged(u)
              }}
              className="border border-gray-200 dark:border-[#3a3a3a] rounded px-2 py-1 text-xs text-gray-700 dark:text-[#d4d4d4] bg-white dark:bg-[#2c2c2c] focus:outline-none focus:border-blue-400 dark:focus:border-[#4a9eff] cursor-pointer"
            >
              {DISPLAY_UNIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {/* Abbreviated label on mobile */}
                  {opt.value}
                </option>
              ))}
            </select>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!shape || isLoading}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#4a9eff] text-white text-xs font-semibold hover:bg-[#3a8eef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow"
          >
            {isLoading ? (
              <>
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                <span className="hidden sm:inline">Computing…</span>
                <span className="sm:hidden">…</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 sm:hidden">
                  <path d="M5 3l8 5-8 5V3z" fill="currentColor" stroke="none" />
                </svg>
                <span className="hidden sm:inline">Generate Scan</span>
                <span className="sm:hidden">Scan</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Main layout ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative print:block print:overflow-visible">

        {/* Mobile backdrop */}
        {leftOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setLeftOpen(false)}
          />
        )}

        {/* Left sidebar — drawer on mobile, collapsible column on desktop */}
        <aside
          className={[
            // Mobile: fixed overlay from left
            'fixed inset-y-0 left-0 z-50 w-[17rem] shadow-xl',
            // Desktop: static column, width toggles with collapse
            'md:static md:z-auto md:shadow-sm',
            sidebarCollapsed ? 'md:w-10' : 'md:w-72',
            // Slide animation (mobile only; md always visible)
            'transform transition-all duration-200 ease-in-out',
            leftOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            // Shared styles
            'bg-gray-50 dark:bg-[#1e1e1e] border-r border-gray-200 dark:border-[#3a3a3a]',
            'flex flex-col shrink-0 overflow-hidden',
            'print:hidden',
          ].join(' ')}
        >
          {/* Mobile drawer header */}
          <div className="md:hidden flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-[#3a3a3a] bg-white dark:bg-[#161616] shrink-0">
            <span className="text-[10px] font-semibold text-gray-500 dark:text-[#888] uppercase tracking-widest">Controls</span>
            <button
              onClick={() => setLeftOpen(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-[#ccc] transition-colors p-1 -mr-1 rounded"
              title="Close"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          {/* Desktop collapse/expand toggle */}
          <div className="hidden md:flex items-center shrink-0 border-b border-gray-200 dark:border-[#3a3a3a] bg-white dark:bg-[#161616]"
            style={{ justifyContent: sidebarCollapsed ? 'center' : 'space-between' }}
          >
            {!sidebarCollapsed && (
              <span className="px-3 text-[10px] font-semibold text-gray-400 dark:text-[#666] uppercase tracking-widest">Controls</span>
            )}
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="flex items-center justify-center w-8 h-8 m-0.5 rounded text-gray-400 hover:text-gray-600 dark:text-[#666] dark:hover:text-[#aaa] hover:bg-gray-100 dark:hover:bg-[#2c2c2c] transition-colors"
              title={sidebarCollapsed ? 'Expand controls' : 'Collapse controls'}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
                <path d={sidebarCollapsed ? 'M6 4l4 4-4 4' : 'M10 4L6 8l4 4'} />
              </svg>
            </button>
          </div>

          {/* Scrollable panel content — hidden on desktop when sidebar is collapsed */}
          <div className={`flex-1 overflow-y-auto p-2 space-y-1.5${sidebarCollapsed ? ' md:hidden' : ''}`}>
            <CollapsiblePanel title="Sample Shape" defaultOpen>
              <ShapeControls
                shape={shape}
                drawMode={drawMode}
                displayUnit={displayUnit}
                scanParams={scanParams}
                stage={stage}
                scanInputMode={scanInputMode}
                targetNx={targetNx}
                targetNy={targetNy}
                targetTotal={targetTotal}
                rotationOptimizerEnabled={rotationOptimizerEnabled}
                exclusionZones={exclusionZones}
                frameEnabled={frameEnabled}
                frameSegments={frameSegments}
                innerOffsetUm={innerOffsetUm}
                onDrawModeChange={setDrawMode}
                onShapeChange={handleShapeChange}
                onClear={handleClear}
                onImportConfig={handleImportConfig}
              />
            </CollapsiblePanel>


            <CollapsiblePanel title="Exclusion Zones" defaultOpen={false}>
              <ExclusionControls
                exclusionZones={exclusionZones}
                drawMode={drawMode}
                onDrawModeChange={setDrawMode}
                onRemove={handleExclusionZoneRemove}
                onClearAll={() => { analytics.exclusionZonesCleared(exclusionZones.length); setExclusionZones([]); setScanResult(null) }}
              />
            </CollapsiblePanel>

            <CollapsiblePanel title="Outer Frame" defaultOpen={false}>
              <FrameControls
                enabled={frameEnabled}
                onToggle={setFrameEnabled}
                segments={frameSegments}
                onSegmentWidthChange={handleFrameSegmentWidthChange}
                displayUnit={displayUnit}
              />
            </CollapsiblePanel>

            <CollapsiblePanel title="Inner Offset" defaultOpen={false}>
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] text-gray-500 dark:text-[#888] shrink-0 w-14">Offset</span>
                  <Tooltip text="Uniform inset from all sample edges. Scan points within this margin are excluded, preventing scanning too close to the boundary.">
                    <OffsetInput valueUm={innerOffsetUm} displayUnit={displayUnit} onChange={setInnerOffsetUm} />
                  </Tooltip>
                  <span className="text-[10px] text-gray-400 dark:text-[#555]">{displayUnit}</span>
                  <Tooltip text="Reset">
                    <button
                      onClick={() => setInnerOffsetUm(0)}
                      className="text-gray-300 dark:text-[#444] hover:text-gray-500 dark:hover:text-[#888] transition-colors shrink-0"
                    >
                      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
                        <path d="M8 2.5a5.5 5.5 0 1 0 5.03 3.25.75.75 0 0 1 1.37-.6A7 7 0 1 1 8 1v1.5z"/>
                        <path d="M8 5.5V.5a.35.35 0 0 1 .574-.27l3 2.5a.35.35 0 0 1 0 .54l-3 2.5A.35.35 0 0 1 8 5.5z"/>
                      </svg>
                    </button>
                  </Tooltip>
                </div>
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel title="Scan Parameters" defaultOpen>
              <ScanParamsForm
                params={scanParams}
                displayUnit={displayUnit}
                onChange={handleScanParamsChange}
                inputMode={scanInputMode}
                onInputModeChange={(m) => { setScanInputMode(m); analytics.scanInputModeChanged(m) }}
                targetNx={targetNx}
                targetNy={targetNy}
                onTargetNxChange={handleTargetNxChange}
                onTargetNyChange={handleTargetNyChange}
                targetTotal={targetTotal}
                onTargetTotalChange={setTargetTotal}
              />
            </CollapsiblePanel>

            <CollapsiblePanel title="Stage Constraints" defaultOpen>
              <StageSettings
                constraints={stage}
                displayUnit={displayUnit}
                onChange={handleStageChange}
              />
            </CollapsiblePanel>

            {/* Generate button inside drawer on mobile for easy access */}
            <div className="md:hidden pt-1">
              <button
                onClick={handleGenerate}
                disabled={!shape || isLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded bg-[#4a9eff] text-white text-sm font-semibold hover:bg-[#3a8eef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow"
              >
                {isLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Computing…
                  </>
                ) : (
                  'Generate Scan'
                )}
              </button>
            </div>
          </div>

          {/* Copyright */}
          <div className={`shrink-0 px-3 py-2 border-t border-gray-200 dark:border-[#2e2e2e]${sidebarCollapsed ? ' md:hidden' : ''}`}>
            <p className="text-[9px] text-gray-400 dark:text-[#555] text-center">
              <a
                href="https://nioquant.com/raman/licence"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => analytics.licenceClicked()}
                className="hover:text-[#4a9eff] dark:hover:text-[#4a9eff] transition-colors"
              >Copyright &copy; 2026 Nioquant</a>
            </p>
          </div>
        </aside>

        {/* Centre canvas + mobile results sheet */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden print:block print:overflow-visible print:h-auto">
          <main className="flex-1 relative overflow-hidden print:overflow-visible print:h-auto print:static">
            <SampleCanvas
              shape={shape}
              scanResult={scanResult}
              drawMode={drawMode}
              darkMode={darkMode}
              displayUnit={displayUnit}
              focusMode={focusMode}
              hoveredPass={hoveredPass}
              onPassHover={setHoveredPass}
              onShapeChange={handleShapeChange}
              rotationOptimum={rotationOptimum}
              rotationTab={rotationTab}
              rotatedScanResult={rotatedScanResult}
              exclusionZones={exclusionZones}
              onExclusionZoneAdd={handleExclusionZoneAdd}
              onRegisterSnapshot={handleRegisterSnapshot}
              frameEnabled={frameEnabled}
              frameSegments={frameSegments}
            />

          </main>

          {/* Mobile results bottom sheet */}
          {hasGenerated && (
            <div className="md:hidden shrink-0 border-t border-gray-200 dark:border-[#3a3a3a]">
              {/* Tab button / handle */}
              <button
                onClick={() => setResultsOpen((v) => !v)}
                className="relative w-full flex items-center justify-center gap-2 px-3 pt-4 pb-2.5 bg-white dark:bg-[#1e1e1e] text-xs font-semibold text-gray-600 dark:text-[#aaa] hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors"
              >
                {/* Visual drag handle pill */}
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-8 h-1 bg-gray-200 dark:bg-[#444] rounded-full" />
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className={`w-3 h-3 shrink-0 transition-transform duration-200 ${resultsOpen ? 'rotate-180' : ''}`}
                >
                  <path d="M2 8 L6 4 L10 8" />
                </svg>
                Scan Results
                {isLoading && (
                  <span className="w-3 h-3 border-2 border-[#4a9eff] border-t-transparent rounded-full animate-spin ml-1" />
                )}
                {scanResult && !isLoading && (
                  <span className="ml-1 bg-blue-100 text-blue-600 dark:bg-[#1a3a5c] dark:text-[#4a9eff] rounded-full px-1.5 text-[10px] font-bold">
                    {scanResult.passes.length}
                  </span>
                )}
              </button>

              {/* Sheet content */}
              {resultsOpen && (
                <div className="max-h-[55vh] overflow-y-auto bg-gray-50 dark:bg-[#1e1e1e] p-3">
                  <ScanResults
                    result={scanResult}
                    displayUnit={displayUnit}
                    isLoading={isLoading}
                    error={error}
                    focusMode={focusMode}
                    hoveredPass={hoveredPass}
                    onPassHover={setHoveredPass}
                    rotationOptimizerEnabled={rotationOptimizerEnabled}
                    onRotationOptimizerToggle={handleRotationOptimizerToggle}
                    rotationOptimum={rotationOptimum}
                    rotatedScanResult={rotatedScanResult}
                    activeTab={rotationTab}
                    onActiveTabChange={handleRotationTabChange}
                    getSnapshot={() => snapshotFnRef.current?.() ?? null}
                    shape={shape}
                    scanParams={scanParams}
                    stage={stage}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel — desktop only */}
        {hasGenerated && (
          <aside className={`hidden md:flex md:flex-col shrink-0 bg-gray-50 dark:bg-[#1e1e1e] border-l border-gray-200 dark:border-[#3a3a3a] shadow-sm transition-all duration-200 print:hidden ${resultsCollapsed ? 'w-10' : 'w-72'}`}>
            {/* Collapse toggle strip */}
            <div className="flex items-center justify-between px-2 py-2 border-b border-gray-200 dark:border-[#2e2e2e] shrink-0">
              {!resultsCollapsed && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-[#666] select-none">Results</span>
              )}
              <button
                onClick={() => setResultsCollapsed((v) => !v)}
                className={`flex items-center justify-center w-6 h-6 rounded hover:bg-gray-200 dark:hover:bg-[#333] text-gray-400 dark:text-[#666] transition-colors ${resultsCollapsed ? 'mx-auto' : 'ml-auto'}`}
                title={resultsCollapsed ? 'Expand results' : 'Collapse results'}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d={resultsCollapsed ? 'M10 4l-4 4 4 4' : 'M6 4l4 4-4 4'} />
                </svg>
              </button>
            </div>
            {/* Scrollable content */}
            {!resultsCollapsed && (
              <div className="flex-1 overflow-y-auto p-3">
                <ScanResults
                  result={scanResult}
                  displayUnit={displayUnit}
                  isLoading={isLoading}
                  error={error}
                  focusMode={focusMode}
                  hoveredPass={hoveredPass}
                  onPassHover={setHoveredPass}
                  rotationOptimizerEnabled={rotationOptimizerEnabled}
                  onRotationOptimizerToggle={handleRotationOptimizerToggle}
                  rotationOptimum={rotationOptimum}
                  rotatedScanResult={rotatedScanResult}
                  activeTab={rotationTab}
                  onActiveTabChange={handleRotationTabChange}
                  getSnapshot={() => snapshotFnRef.current?.() ?? null}
                  shape={shape}
                  scanParams={scanParams}
                  stage={stage}
                />
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ── Help modal ───────────────────────────────────────────────────── */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-lg border shadow-xl bg-white dark:bg-[#1e1e1e] border-gray-200 dark:border-[#3a3a3a] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#2e2e2e]">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-[#4a9eff]">
                  <path fillRule="evenodd" clipRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 10a3 3 0 01-2 2.83V13a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" />
                </svg>
                <span className="text-sm font-semibold text-gray-800 dark:text-[#e0e0e0]">Help</span>
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-[#ccc] transition-colors p-1 -mr-1 rounded"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-4 py-4 space-y-4 text-sm text-gray-600 dark:text-[#b0b0b0] leading-relaxed">
              <div>
                <p className="font-semibold text-gray-800 dark:text-[#e0e0e0] mb-1">What is Raman Sample Analyzer?</p>
                <p>A tool for planning Raman microscopy scan grids. Define your sample shape on the canvas, configure scan parameters, and generate an optimised point grid, before touching the instrument.</p>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-gray-800 dark:text-[#e0e0e0]">Workflow</p>
                <ol className="space-y-1.5 list-none">
                  {[
                    ['1', 'Draw Shape', 'Use the canvas to draw a rectangle, circle, or freeform polygon around your sample area.'],
                    ['2', 'Set Parameters', 'Choose step size (or target grid) and overlap in the Scan Parameters panel.'],
                    ['3', 'Set Stage', 'Enter your stage constraints: max scan width/height and time per point.'],
                    ['4', 'Generate', 'Click Generate Scan to compute the grid. Results show pass count, total points, and estimated time.'],
                  ].map(([num, title, desc]) => (
                    <li key={num} className="flex gap-2.5">
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-[#4a9eff]/15 text-[#4a9eff] text-[10px] font-bold flex items-center justify-center shrink-0">{num}</span>
                      <span><span className="font-medium text-gray-700 dark:text-[#d4d4d4]">{title}: </span>{desc}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="border-t border-gray-100 dark:border-[#2e2e2e] pt-3 text-xs text-gray-400 dark:text-[#666]">
                All units can be switched between µm, mm, and cm in the header. Hover over scan dots on the canvas for position details.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
