// ── Display unit system ────────────────────────────────────────────────────────

export type DisplayUnit = 'nm' | 'µm' | 'mm' | 'cm'

export interface DisplayUnitOption {
  value: DisplayUnit
  label: string
  step: number       // sensible input step in this unit
  decimals: number   // decimal places for display
}

export const DISPLAY_UNIT_OPTIONS: DisplayUnitOption[] = [
  { value: 'nm',  label: 'nm  (nanometres)',  step: 1,      decimals: 1 },
  { value: 'µm',  label: 'µm  (microns)',     step: 0.1,    decimals: 3 },
  { value: 'mm',  label: 'mm  (millimetres)', step: 0.001,  decimals: 4 },
  { value: 'cm',  label: 'cm  (centimetres)', step: 0.0001, decimals: 5 },
]

/** Convert internal µm value to the selected display unit. */
export function umToDisplay(um: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'nm': return um * 1_000
    case 'µm': return um
    case 'mm': return um / 1_000
    case 'cm': return um / 10_000
  }
}

/** Convert a display-unit value back to internal µm. */
export function displayToUm(val: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'nm': return val / 1_000
    case 'µm': return val
    case 'mm': return val * 1_000
    case 'cm': return val * 10_000
  }
}

// ── Scientific notation ────────────────────────────────────────────────────────

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'

/**
 * Format `value` in scientific notation with `decimals` mantissa decimal places.
 * Uses Unicode superscripts: 1.23×10⁻⁴
 */
function sciStr(value: number, decimals: number): string {
  if (value === 0) return decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0'
  const sign = value < 0 ? '−' : ''
  const abs = Math.abs(value)
  // Add small epsilon to avoid floor(log10(10^n)) = n-1 due to floating-point
  let exp = Math.floor(Math.log10(abs) + 1e-10)
  let mantissa = abs / Math.pow(10, exp)
  // If rounding the mantissa would push it to 10, bump the exponent
  if (parseFloat(mantissa.toFixed(decimals)) >= 10) {
    exp += 1
    mantissa = abs / Math.pow(10, exp)
  }
  const expSign = exp < 0 ? '⁻' : ''
  const expStr = String(Math.abs(exp)).split('').map((d) => SUP[+d]).join('')
  return `${sign}${mantissa.toFixed(decimals)}×10${expSign}${expStr}`
}

/** Returns true when the value is outside the "comfortable" reading range. */
function needsSci(value: number): boolean {
  const abs = Math.abs(value)
  return abs !== 0 && (abs >= 10_000 || abs < 0.001)
}

/** Format a number, switching to scientific notation for extreme values. */
function fmt(value: number, decimals: number): string {
  return needsSci(value) ? sciStr(value, decimals) : value.toFixed(decimals)
}

// ── Public formatters ──────────────────────────────────────────────────────────

/** Format a µm value using the chosen display unit. */
export function fmtDisplay(um: number, unit: DisplayUnit, decimals?: number): string {
  const opts = DISPLAY_UNIT_OPTIONS.find((o) => o.value === unit)!
  const d = decimals ?? opts.decimals
  return `${fmt(umToDisplay(um, unit), d)} ${unit}`
}

/** Format µm² in the current display unit's area (unit²). */
export function fmtAreaDisplay(um2: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'nm': return `${fmt(um2 * 1e6,  1)} nm²`
    case 'µm': return `${fmt(um2,        2)} µm²`
    case 'mm': return `${fmt(um2 / 1e6,  4)} mm²`
    case 'cm': return `${fmt(um2 / 1e8,  6)} cm²`
  }
}

/**
 * Format an integer count, using scientific notation for large values (≥ 10 000).
 * Mantissa is given 1 decimal place (e.g. 1.2×10⁶).
 */
export function fmtCount(n: number): string {
  return needsSci(n) ? sciStr(n, 1) : n.toLocaleString()
}

/** Format mm², switching to cm² for large values and sci notation for tiny ones. */
export function fmtMm2(mm2: number): string {
  if (mm2 >= 100) return `${fmt(mm2 / 100, 3)} cm²`
  return `${fmt(mm2, 4)} mm²`
}

/**
 * Returns a Tailwind min-width class for numeric inputs so numbers fit without
 * truncation. Wider for units that produce larger digit counts (e.g. nm).
 */
export function inputMinW(unit: DisplayUnit): string {
  switch (unit) {
    case 'nm': return 'min-w-[76px]'
    case 'µm': return 'min-w-[52px]'
    case 'mm': return 'min-w-[56px]'
    case 'cm': return 'min-w-[64px]'
  }
}

// ── Legacy helpers (kept for internal use) ────────────────────────────────────

/** Convert µm → mm */
export const umToMm = (um: number): number => um / 1_000

/** Convert µm → cm */
export const umToCm = (um: number): number => um / 10_000

/** Convert mm → µm */
export const mmToUm = (mm: number): number => mm * 1_000

/** Convert cm → µm */
export const cmToUm = (cm: number): number => cm * 10_000

/**
 * Format a micron value with the most readable unit.
 * < 1000 µm → show in µm
 * ≥ 1000 µm → show in mm
 * ≥ 10 000 µm → show in cm
 */
export function formatUm(um: number, decimals = 2): string {
  const abs = Math.abs(um)
  if (abs >= 10_000) return `${umToCm(um).toFixed(decimals)} cm`
  if (abs >= 1_000)  return `${umToMm(um).toFixed(decimals)} mm`
  return `${um.toFixed(decimals)} µm`
}

/** Always show in µm with fixed decimals */
export function fmtUm(um: number, decimals = 3): string {
  return `${um.toFixed(decimals)} µm`
}

/** Format minutes into h m s */
export function fmtTime(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} s`
  if (minutes < 60) return `${minutes.toFixed(1)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h} h ${m} min`
}
