declare function gtag(...args: unknown[]): void

function track(event: string, params?: Record<string, unknown>) {
  try {
    if (typeof gtag !== 'undefined') {
      gtag('event', event, params)
    }
  } catch {
    // analytics not available (dev, ad blockers, etc.)
  }
}

export const analytics = {
  scanGenerated(pointCount: number, shapeType: string, stepUm: number) {
    track('scan_generated', {
      point_count: pointCount,
      shape_type: shapeType,
      step_um: stepUm,
    })
  },

  scanCopied() {
    track('scan_copied')
  },

  drawModeSelected(mode: string) {
    track('draw_mode_selected', { mode })
  },

  shapeTypeSelected(type: string) {
    track('shape_type_selected', { shape_type: type })
  },

  stagePresetApplied(widthMm: number, heightMm: number) {
    track('stage_preset_applied', { width_mm: widthMm, height_mm: heightMm })
  },

  shapeCleared() {
    track('shape_cleared')
  },

  freeformPointAdded(totalPoints: number) {
    track('freeform_point_added', { total_points: totalPoints })
  },

  freeformPointRemoved(totalPoints: number) {
    track('freeform_point_removed', { total_points: totalPoints })
  },

  sidebarToggled(open: boolean) {
    track('sidebar_toggled', { state: open ? 'open' : 'closed' })
  },

  unitChanged(unit: string) {
    track('unit_changed', { unit })
  },

  themeToggled(theme: string) {
    track('theme_toggled', { theme })
  },

  contactClicked() {
    track('contact_clicked')
  },

  helpOpened() {
    track('help_opened')
  },

  scanInputModeChanged(mode: string) {
    track('scan_input_mode_changed', { mode })
  },

  passDetailOpened(passNumber: number) {
    track('pass_detail_opened', { pass_number: passNumber })
  },

  focusModeToggled(enabled: boolean) {
    track('focus_mode_toggled', { enabled })
  },

  licenceClicked() {
    track('licence_clicked')
  },

  // ── New in v1.1.0 ───────────────────────────────────────────────────────────

  csvExported(pointCount: number, tileCount: number) {
    track('csv_exported', { point_count: pointCount, tile_count: tileCount })
  },

  pdfExported(pageCount: number, tileCount: number, hasSnapshot: boolean) {
    track('pdf_exported', { page_count: pageCount, tile_count: tileCount, has_snapshot: hasSnapshot })
  },

  exclusionZoneAdded(vertexCount: number, totalZones: number) {
    track('exclusion_zone_added', { vertex_count: vertexCount, total_zones: totalZones })
  },

  exclusionZoneRemoved(totalZones: number) {
    track('exclusion_zone_removed', { total_zones: totalZones })
  },

  exclusionZonesCleared(clearedCount: number) {
    track('exclusion_zones_cleared', { cleared_count: clearedCount })
  },

  rotationOptimizerToggled(enabled: boolean) {
    track('rotation_optimizer_toggled', { enabled })
  },

  rotationTabChanged(tab: string, tileSaving: number) {
    track('rotation_tab_changed', { tab, tile_saving: tileSaving })
  },

  rotationOptimumFound(angleDeg: number, baselineTiles: number, optimizedTiles: number) {
    track('rotation_optimum_found', {
      angle_deg: angleDeg,
      baseline_tiles: baselineTiles,
      optimized_tiles: optimizedTiles,
      tile_saving: baselineTiles - optimizedTiles,
    })
  },
}
