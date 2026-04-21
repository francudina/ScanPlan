# ScanPlan

A browser-based scan grid planner for any point-mapping microscopy instrument. Define your sample shape on an interactive canvas, configure scan parameters, and generate an optimised point grid: before touching the instrument.

Live at: [scanplan.nioquant.com](https://scanplan.nioquant.com)  
About: [nioquant.com/scanplan](https://nioquant.com/scanplan)

## Supported techniques

Works with any instrument that scans in a point grid: Raman microscopy, confocal fluorescence, TERS / nano-Raman, XRF mapping, EBSD / SEM-EDS, AFM / SPM, SIMS, EPMA, nano-FTIR / s-SNOM.

## Features
- **Interactive canvas**: draw rectangle, circle, or freeform polygon sample shapes
- **Scan grid generation**: computes scan passes with configurable step size and overlap
- **Multi-pass support**: automatically splits large scans that exceed stage constraints into multiple repositioned passes
- **Exclusion zones**: draw freeform no-scan regions; points inside are skipped automatically
- **Outer frame overlay**: per-edge configurable frame strips drawn outside the sample boundary
- **Inner offset**: push the scan grid inward from the tile boundary by a fixed distance
- **Rotation optimizer**: find the sample angle that minimises the number of scan tiles
- **Dot count mode**: define scan density by target number of points instead of step size
- **Stage constraints**: set max scan width/height and time per point for accurate time estimates
- **CSV / PDF export**: export all scan points as CSV or a formatted PDF report with canvas snapshot
- **Unit switching**: display values in µm or mm
- **Dark mode**: full light/dark theme support
- **Responsive**: works on desktop and mobile

## Workflow
1. **Draw Shape**: use the canvas to draw a rectangle, circle, or freeform polygon around your sample area
2. **Set Scan Parameters**: choose step size (or target dot count) and overlap
3. **Add Exclusion Zones**: optionally draw regions to skip
4. **Set Stage Constraints**: enter max scan width/height and time per point
5. **Generate**: click Generate Scan to compute the grid
6. **Review**: inspect per-pass start positions, step sizes, dot counts, and estimated acquisition time
7. **Export**: download as CSV or PDF, or copy parameters to clipboard

## Licence
Copyright (c) 2026 Nioquant. All rights reserved.

Full licence text: [LICENSE](./LICENSE)  
See also: [nioquant.com/scanplan/licence](https://nioquant.com/scanplan/licence.html)
