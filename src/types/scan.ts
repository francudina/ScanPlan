// ── Shape types ────────────────────────────────────────────────────────────────

export type ShapeType = 'rectangle' | 'circle' | 'freeform'

export interface Point {
  x: number // microns
  y: number // microns
}

export interface RectParams {
  x: number      // top-left X, microns
  y: number      // top-left Y, microns
  width: number  // microns
  height: number // microns
}

export interface CircleParams {
  cx: number     // center X, microns
  cy: number     // center Y, microns
  radius: number // microns
}

export interface FreeformParams {
  points: Point[] // polygon vertices, microns
}

export interface SampleShape {
  type: ShapeType
  rect?: RectParams
  circle?: CircleParams
  freeform?: FreeformParams
}

// ── Request types ──────────────────────────────────────────────────────────────

export interface ScanParameters {
  step_x: number   // µm — ΔX
  step_y: number   // µm — ΔY
  overlap: number  // 0.0–0.5
}

export interface StageConstraints {
  max_scan_width: number         // µm
  max_scan_height: number        // µm
  time_per_point_seconds: number
  tile_overlap: number           // 0.0–0.5, overlap fraction between adjacent tiles
}

export interface ScanRequest {
  shape: SampleShape
  scan_params: ScanParameters
  stage: StageConstraints
}

// ── Response types ─────────────────────────────────────────────────────────────

export interface ScanPass {
  pass_number: number
  region: { x_min: number; y_min: number; x_max: number; y_max: number }
  start_point: Point
  delta_x: number    // ΔX
  delta_y: number    // ΔY
  nx: number         // Nx
  ny: number         // Ny
  total_points: number
  area_mm2: number
  grid_points: Point[]
}

export interface ScanResult {
  passes: ScanPass[]
  total_points: number
  total_area_mm2: number
  warnings: string[]
  estimated_time_minutes: number
  requires_multiple_passes: boolean
}

export interface ValidationResult {
  valid: boolean
  warnings: string[]
  approx_points: number
  exceeds_stage: boolean
  bounding_box_um: { width: number; height: number }
}

export interface ImageDetectionResult {
  detected_shape: SampleShape
  confidence: number
  preview_bounds: { width: number; height: number }
}

// ── Canvas / UI types ──────────────────────────────────────────────────────────

export type DrawMode = 'select' | 'rectangle' | 'circle' | 'freeform' | 'exclusion'

export interface Viewport {
  left: number  // left edge in microns
  top: number   // top edge in microns
  scale: number // pixels per micron
}

export interface SnapshotInfo {
  dataURL: string
  vp: Viewport
  canvasW: number
  canvasH: number
}

export type DrawState =
  | { mode: 'idle' }
  | { mode: 'drawing_rect'; startX: number; startY: number }
  | { mode: 'drawing_circle'; cx: number; cy: number }
  | { mode: 'drawing_freeform'; points: Point[]; preview: Point | null; anchorIndex?: number }
  | { mode: 'drawing_exclusion'; points: Point[]; preview: Point | null }

export interface ExclusionZone {
  id: string
  points: Point[] // closed polygon vertices in µm
}

export interface FrameSegment {
  id: string       // "f1", "f2", ...
  label: string    // "F1", "F2", ...
  widthUm: number  // thickness in µm
  side: string     // "top"|"right"|"bottom"|"left" for rect; "arc" for circle; "edge-0","edge-1",... for freeform
}

// ── Full session config (export / import) ─────────────────────────────────────

export interface FullConfig {
  version: 1
  unit: string
  shape: SampleShape | null
  scanParams: ScanParameters
  stage: StageConstraints
  displayUnit: string
  scanInputMode: 'step' | 'count' | 'total'
  targetNx: number
  targetNy: number
  targetTotal: number
  rotationOptimizerEnabled: boolean
  exclusionZones: ExclusionZone[]
  frameEnabled: boolean
  frameSegments: FrameSegment[]
  innerOffsetUm: number
}

// ── Rotation optimizer ─────────────────────────────────────────────────────────

export interface RotationOptimum {
  angle_deg: number
  tile_count: number
  baseline_tile_count: number  // tile count at 0°
}
