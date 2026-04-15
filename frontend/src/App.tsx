import { useCallback, useEffect, useRef, useState } from 'react'
import { generateScan } from './api/scanApi'
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
  time_per_point_seconds: 5,
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

  // Right panel is shown once the user has clicked Generate (even if loading/error)
  const [hasGenerated, setHasGenerated] = useState(false)

  // Dark / light mode — initial value comes from <html class="dark"> set by the inline head script
  const [darkMode, setDarkMode] = useState<boolean>(
    () => document.documentElement.classList.contains('dark')
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

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

  const handleGenerate = async () => {
    if (!shape) {
      setError('Please define a sample shape first.')
      setHasGenerated(true)
      return
    }
    setIsLoading(true)
    setError(null)
    setHasGenerated(true)
    try {
      const result = await generateScan({ shape, scan_params: scanParams, stage })
      setScanResult(result)
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'response' in err
          ? String((err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? err)
          : String(err)
      setError(msg)
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
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-[#111] overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2 bg-white dark:bg-[#161616] border-b border-gray-200 dark:border-[#2e2e2e] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-[#4a9eff] flex items-center justify-center text-white text-xs font-bold shrink-0 shadow">
            R
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 dark:text-[#e0e0e0]">DXR3 Raman Scan Planner</h1>
            <p className="text-[10px] text-gray-400 dark:text-[#666]">
              Define sample shape → compute DXR3 scan grid parameters
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Settings gear */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              title="Settings"
              className={`flex items-center justify-center w-7 h-7 rounded border transition-colors ${
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
              <div className="absolute right-0 top-full mt-1.5 w-44 rounded border shadow-lg z-50 bg-white dark:bg-[#252525] border-gray-200 dark:border-[#3a3a3a]">
                <div className="p-2.5">
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
                </div>
              </div>
            )}
          </div>

          {/* Unit selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-400 dark:text-[#666] uppercase tracking-wide">Unit</span>
            <select
              value={displayUnit}
              onChange={(e) => setDisplayUnit(e.target.value as DisplayUnit)}
              className="border border-gray-200 dark:border-[#3a3a3a] rounded px-2 py-1 text-xs text-gray-700 dark:text-[#d4d4d4] bg-white dark:bg-[#2c2c2c] focus:outline-none focus:border-blue-400 dark:focus:border-[#4a9eff] cursor-pointer"
            >
              {DISPLAY_UNIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!shape || isLoading}
            className="flex items-center gap-2 px-4 py-1.5 rounded bg-[#4a9eff] text-white text-xs font-semibold hover:bg-[#3a8eef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow"
          >
            {isLoading ? (
              <>
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Computing…
              </>
            ) : (
              'Generate Scan'
            )}
          </button>
        </div>
      </header>

      {/* ── Main layout ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — collapsible controls */}
        <aside className="w-72 shrink-0 bg-gray-50 dark:bg-[#1e1e1e] border-r border-gray-200 dark:border-[#3a3a3a] overflow-y-auto p-2 space-y-1.5 shadow-sm">
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

          <CollapsiblePanel title="Stage Constraints" defaultOpen={false}>
            <StageSettings
              constraints={stage}
              displayUnit={displayUnit}
              onChange={setStage}
            />
          </CollapsiblePanel>
        </aside>

        {/* Centre — canvas */}
        <main className="flex-1 relative overflow-hidden">
          <SampleCanvas
            shape={shape}
            scanResult={scanResult}
            drawMode={drawMode}
            darkMode={darkMode}
            displayUnit={displayUnit}
            onShapeChange={handleShapeChange}
          />

          {/* Status bar */}
          <div className="absolute bottom-2 left-2 text-[10px] text-gray-400 dark:text-[#888] bg-white/90 dark:bg-[#1e1e1e]/90 border border-gray-200 dark:border-[#333] rounded px-2 py-1 select-none shadow">
            Scroll to zoom · <strong className="text-gray-600 dark:text-[#aaa]">{drawMode}</strong>
            {shapeSummary && (
              <span className="ml-2 text-[#4a9eff]">
                {shape?.type} · {shapeSummary}
              </span>
            )}
          </div>
        </main>

        {/* Right panel — only shown after Generate is clicked */}
        {hasGenerated && (
          <aside className="w-72 shrink-0 bg-gray-50 dark:bg-[#1e1e1e] border-l border-gray-200 dark:border-[#3a3a3a] overflow-y-auto p-3 shadow-sm">
            <ScanResults
              result={scanResult}
              displayUnit={displayUnit}
              isLoading={isLoading}
              error={error}
            />
          </aside>
        )}
      </div>
    </div>
  )
}
