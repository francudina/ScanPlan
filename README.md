# Raman Sample Analyzer

A browser-based tool for planning Raman microscopy scan grids. Define your sample shape on an interactive canvas, configure scan parameters, and generate an optimised point grid : before touching the instrument.

Live at: [raman.nioquant.com](https://raman.nioquant.com)

## Features
- **Interactive canvas** : draw rectangle, circle, or freeform polygon sample shapes
- **Scan grid generation** : computes scan passes with configurable step size and overlap
- **Multi-pass support** : automatically splits large scans that exceed stage constraints into multiple repositioned passes
- **Dot count mode** : define scan density by target number of points instead of step size
- **Stage constraints** : set max scan width/height and time per point to get accurate time estimates
- **Unit switching** : display values in µm, mm, or cm
- **Results export** : copy all scan parameters to clipboard in a structured text format
- **Dark mode** : full light/dark theme support
- **Responsive** : works on desktop and mobile

## Workflow
1. **Draw Shape** : use the canvas to draw a rectangle, circle, or freeform polygon around your sample area
2. **Set Scan Parameters** : choose step size (or target dot count) and overlap
3. **Set Stage Constraints** : enter max scan width/height and time per point
4. **Generate** : click Generate Scan to compute the grid
5. **Review** : inspect per-pass start positions, step sizes, dot counts, and estimated acquisition time
6. **Copy** : export all parameters to clipboard for use in your acquisition software

## Licence
Copyright (c) 2026 Nioquant. All rights reserved.

Full licence text: [LICENSE](./LICENSE)
See also: [nioquant.com/raman/licence](https://nioquant.com/raman/licence)
