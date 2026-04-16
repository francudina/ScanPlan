import { useCallback, useEffect, useRef, useState } from 'react'
import { generateScanGrid } from './utils/scanGenerator'
import SampleCanvas from './components/Canvas/SampleCanvas'
import ShapeControls from './components/Controls/ShapeControls'
import ScanParamsForm from './components/Controls/ScanParamsForm'
import StageSettings from './components/Controls/StageSettings'
import ScanResults from './components/Output/ScanResults'
import type {
  DrawMode,
  SampleShape,
  ScanParameters,
  ScanResult,
  StageConstraints,
} from './types/scan'
import {
  type DisplayUnit,
  DISPLAY_UNIT_OPTIONS,
  fmtDisplay,
  mmToUm,
} from './utils/units'

const DEFAULT_SCAN_PARAMS: ScanParameters = {
  step_x: 50,
  step_y: 50,
  overlap: 0,
}

const DEFAULT_STAGE: StageConstraints = {
  max_scan_width: mmToUm(25),
  max_scan_height: mmToUm(25),
  time_per_point_seconds: 1,
}

// ── Collapsible panel ─────────────────────────────────────────────────────────

function CollapsiblePanel({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded overflow-hidden border border-gray-200 dark:border-[#3a3a3a]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors select-none bg-gray-100 dark:bg-[#2c2c2c] hover:bg-gray-200 dark:hover:bg-[#333] text-gray-500 dark:text-[#a0a0a0] hover:text-gray-700 dark:hover:text-[#d4d4d4]"
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest">{title}</span>
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
  const [drawMode, setDrawMode] = useState<DrawMode>('rectangle')
  const [scanParams, setScanParams] = useState<ScanParameters>(DEFAULT_SCAN_PARAMS)
  const [stage, setStage] = useState<StageConstraints>(DEFAULT_STAGE)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('mm')

  const [hasGenerated, setHasGenerated] = useState(false)
  const [focusMode, setFocusMode] = useState(true)
  const [hoveredPass, setHoveredPass] = useState<number | null>(null)

  const [darkMode, setDarkMode] = useState<boolean>(
    () => document.documentElement.classList.contains('dark')
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  // Mobile panel state
  const [leftOpen, setLeftOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  // Desktop sidebar collapse
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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

  const handleShapeChange = useCallback((s: SampleShape) => {
    setShape(s)
    setScanResult(null)
    setError(null)
  }, [])

  const handleClear = useCallback(() => {
    setShape(null)
    setScanResult(null)
    setError(null)
    setHasGenerated(false)
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
      const result = generateScanGrid(shape, scanParams, stage)
      setScanResult(result)
      setDrawMode('select')
      // Auto-open results sheet on mobile
      if (window.innerWidth < 768) setResultsOpen(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  const shapeSummary = (() => {
    if (!shape) return null
    if (shape.type === 'rectangle' && shape.rect)
      return `${fmtDisplay(shape.rect.width, displayUnit, 2)} × ${fmtDisplay(shape.rect.height, displayUnit, 2)}`
    if (shape.type === 'circle' && shape.circle)
      return `r = ${fmtDisplay(shape.circle.radius, displayUnit, 2)}`
    if (shape.type === 'freeform' && shape.freeform)
      return `${shape.freeform.points.length} pts`
    return null
  })()

  return (
    <div className="flex flex-col h-screen h-[100dvh] bg-gray-50 dark:bg-[#111] overflow-hidden">

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

          <div className="w-7 h-7 rounded bg-[#4a9eff] flex items-center justify-center text-white text-xs font-bold shrink-0 shadow">
            R
          </div>
          <div className="hidden sm:block min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 dark:text-[#e0e0e0] truncate">DXR3 Raman Scan Planner</h1>
            <p className="text-[10px] text-gray-400 dark:text-[#666] hidden md:block">
              Define sample shape → compute DXR3 scan grid parameters
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
                    onClick={() => setDarkMode((v) => !v)}
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
                      onClick={() => setFocusMode((v) => !v)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-xs transition-colors text-gray-700 dark:text-[#d4d4d4] hover:bg-gray-100 dark:hover:bg-[#333]"
                    >
                      <span>Focus on hover</span>
                      <span className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${focusMode ? 'bg-blue-500' : 'bg-gray-300 dark:bg-[#444]'}`}>
                        <span className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${focusMode ? 'translate-x-3' : 'translate-x-0'}`} />
                      </span>
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
              onChange={(e) => setDisplayUnit(e.target.value as DisplayUnit)}
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
      <div className="flex flex-1 overflow-hidden relative">

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
                onDrawModeChange={setDrawMode}
                onShapeChange={handleShapeChange}
                onClear={handleClear}
              />
            </CollapsiblePanel>

            <CollapsiblePanel title="Scan Parameters" defaultOpen>
              <ScanParamsForm
                params={scanParams}
                displayUnit={displayUnit}
                onChange={setScanParams}
              />
            </CollapsiblePanel>

            <CollapsiblePanel title="Stage Constraints" defaultOpen>
              <StageSettings
                constraints={stage}
                displayUnit={displayUnit}
                onChange={setStage}
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
        </aside>

        {/* Centre canvas + mobile results sheet */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <main className="flex-1 relative overflow-hidden">
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
            />

            {/* Status bar */}
            <div className="absolute bottom-2 left-2 text-[10px] text-gray-400 dark:text-[#888] bg-white/90 dark:bg-[#1e1e1e]/90 border border-gray-200 dark:border-[#333] rounded px-2 py-1 select-none shadow">
              <span className="hidden sm:inline">Scroll</span><span className="sm:hidden">Pinch</span> to zoom · <strong className="text-gray-600 dark:text-[#aaa]">{drawMode}</strong>
              {shapeSummary && (
                <span className="ml-2 text-[#4a9eff]">
                  {shape?.type} · {shapeSummary}
                </span>
              )}
            </div>
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
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel — desktop only */}
        {hasGenerated && (
          <aside className="hidden md:flex md:flex-col w-72 shrink-0 bg-gray-50 dark:bg-[#1e1e1e] border-l border-gray-200 dark:border-[#3a3a3a] overflow-y-auto p-3 shadow-sm">
            <ScanResults
              result={scanResult}
              displayUnit={displayUnit}
              isLoading={isLoading}
              error={error}
              focusMode={focusMode}
              hoveredPass={hoveredPass}
              onPassHover={setHoveredPass}
            />
          </aside>
        )}
      </div>
    </div>
  )
}
