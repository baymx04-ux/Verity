---
name: Verity Slate
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#3f4850'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#707881'
  outline-variant: '#bfc7d2'
  surface-tint: '#006398'
  primary: '#006194'
  on-primary: '#ffffff'
  primary-container: '#007bb9'
  on-primary-container: '#fdfcff'
  inverse-primary: '#93ccff'
  secondary: '#006c4a'
  on-secondary: '#ffffff'
  secondary-container: '#82f5c1'
  on-secondary-container: '#00714e'
  tertiary: '#894d00'
  on-tertiary: '#ffffff'
  tertiary-container: '#ac6200'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cce5ff'
  primary-fixed-dim: '#93ccff'
  on-primary-fixed: '#001d31'
  on-primary-fixed-variant: '#004b73'
  secondary-fixed: '#85f8c4'
  secondary-fixed-dim: '#68dba9'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#005137'
  tertiary-fixed: '#ffdcc0'
  tertiary-fixed-dim: '#ffb875'
  on-tertiary-fixed: '#2d1600'
  on-tertiary-fixed-variant: '#6b3b00'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-xl:
    fontFamily: Manrope
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  data-tabular:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  gutter-lg: 2rem
  margin: 2rem
  margin-mobile: 1rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system delivers an authoritative, high-integrity enterprise environment engineered for data clarity, compliance, and decision-making confidence. Combining modern minimalism with structured corporate reliability, the visual tone avoids decorative distraction in favor of institutional trust, quiet precision, and effortless readability.

The aesthetic philosophy centers on atmospheric calm: crisp, low-glare canvas tones paired with pristine white elevated surfaces, restrained hairline strokes, and high-legibility slate typography. Accent colors are applied strictly as functional beacons—guiding focus, signaling state verification, and directing analytical workflow without visual fatigue.

## Colors

The palette is anchored by deep slate neutrals layered across cool slate canvas tones, punctuated by precise ocean sapphire and verification emerald accents.

### Palette Architecture

- **Canvas Base (`#f8fafc`)**: Universal application background providing soft, non-glare visual relief.
- **Canvas Muted (`#f1f5f9`)**: Recessed areas, secondary rails, table header strips, and inset metrics blocks.
- **Surface Elevation (`#ffffff`)**: Primary workspace containers, cards, dialogs, and interactive popovers.
- **Structural Stroke (`#e2e8f0`)**: Subtle separation lines, card perimeters, and modular boundaries.
- **Stroke Focus / Hover (`#cbd5e1`)**: Heightened hairline state for hover and structural focus.
- **Text Primary (`#0f172a`)**: Dominant slate for titles, primary values, and high-emphasis data.
- **Text Secondary (`#334155`)**: Supporting descriptive copy, labels, and form values.
- **Text Muted (`#64748b`)**: Non-critical metadata, table headers, and timestamp cues.
- **Primary Accent (`#0284c7`)**: Targeted interactive focus, key commands, active navigation items, and primary selections.
- **Success / Verification (`#059669`)**: Audit validation, confirmed statuses, cryptographic checks, and healthy metrics.

### Functional States

- Interactive states use calibrated alpha overlays of the primary token rather than unrelated hues.
- Destructive alerts leverage muted crimson (`#e11d48`) with light rose tinted containment (`#fff1f2`).
- Warning cues leverage warm amber (`#d97706`) over soft sand containment (`#fffbeb`).

## Typography

The typographic hierarchy pairs Manrope for structural headlines with Inter for content-dense utility, forms, and data visualization.

### Font Pairing Logic

- **Manrope**: Delivers geometric rigor and polished modern authority to dashboard overviews, sheet headers, and module titles without feeling industrial or abrasive.
- **Inter**: Operates with optimal micro-legibility and neutrality across tables, operational metadata, body paragraphs, and administrative inputs. Numeric figures across metrics and financial panels must enable tabular figures (`font-variant-numeric: tabular-nums`).

### Application Guidelines

- Headlines use optical tracking compression (`-0.01em` to `-0.025em`) to preserve visual density in high-resolution enterprise displays.
- Section tags and table column headers utilize `label-sm` with upper casing and expanded tracking for instant scannability.
- Body sizes default to `body-md` (14px) for data efficiency while maintaining generous line height (22px) to prevent cognitive strain during continuous audit tasks.

## Layout & Spacing

Layouts follow a fluid, responsive 12-column grid system balanced by generous negative space and explicit spatial boundaries.

### Grid & Responsive Behavior

- **Desktop (1280px and above)**: 12-column grid with a maximum content container of 1600px. Outer canvas margins default to `margin-desktop` (48px) with internal column gutters at `gutter-lg` (32px).
- **Tablet / Small Desktop (768px – 1279px)**: 8-column layout with `margin` (32px) and `gutter` (24px). Analytical side rails collapse into responsive drawer layers or tabs.
- **Mobile (< 768px)**: 4-column layout with `margin-mobile` (16px) and `gutter-sm` (16px). Data cards adopt single-column vertical stacks.

### Density and Padding Conventions

- Component cards and data panels employ `space-lg` (24px) for internal padding, expanding to `space-xl` (40px) on sparse summary sections.
- Tables, inline toolbars, and nested data trees reduce internal component gaps to `space-sm` (8px) and `space-xs` (4px) to balance operational velocity with generous surrounding margins.

## Elevation & Depth

Visual hierarchy is constructed primarily through crisp tonal contrast and delicate outlines, supplemented by hyper-diffused ambient drop shadows rather than heavy skeuomorphic projections.

### Surface Elevation Levels

- **Level 0 (Flat Canvas)**: Hex `#f8fafc` — the canvas foundation. Contains no borders or elevation.
- **Level 1 (Card & Module Layer)**: Pure white `#ffffff` surface, bounded by a 1px solid stroke in `#e2e8f0`. Casts an ultra-diffused atmospheric shadow: `box-shadow: 0 1px 3px 0 rgba(15, 23, 42, 0.03), 0 1px 2px -1px rgba(15, 23, 42, 0.02)`.
- **Level 2 (Dropdowns, Popovers, & Hover States)**: Pure white `#ffffff` surface with boundary `#cbd5e1`. Elevation shadow: `box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.05), 0 4px 6px -4px rgba(15, 23, 42, 0.02)`.
- **Level 3 (Modals, Critical Verification Sheets)**: Pure white `#ffffff` floating surface resting above an ambient slate backdrop (`rgba(15, 23, 42, 0.35)` with a 4px blur). Shadow: `box-shadow: 0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.03)`.

### Border Integrity

Every elevated card or modal must retain its hairline boundary stroke (`#e2e8f0`) even when shadowed, ensuring boundary distinction on wide variety of display panels.

## Shapes

The design system establishes a refined geometry using `roundedness: 2`, matching rounded-lg and rounded-xl primitives to humanize analytical interfaces while sustaining clean enterprise discipline.

### Geometry Rules

- **Base Containers & Cards (`rounded-xl` / 1.5rem)**: Large surface blocks, analytical dashboards, audit reports, and modal frames adopt 24px corner radii.
- **Nested Inner Containers (`rounded-lg` / 1rem)**: Inset sections, secondary metric modules, and code/log panels utilize 16px corner radii.
- **Controls & Form Elements (0.5rem / 8px)**: Inputs, buttons, segmented controls, dropdown triggers, and interactive menu items use an 8px radius.
- **Data Chips & Status Badges (Pill / 9999px)**: Verification tags, numerical badges, and filter capsules use full capsule radii to stand out from structural card boundaries.

## Components

### Buttons

- **Primary**: Solid sapphire blue (`#0284c7`) background, `#ffffff` text, 8px border radius, medium font weight (14px). Hover state deepens to `#0369a1`. Active state scales down slightly to `0.99`.
- **Secondary / Outline**: Pure white surface, 1px border in `#e2e8f0`, text in slate primary (`#0f172a`). Hover introduces subtle slate canvas background (`#f8fafc`) and border focus (`#cbd5e1`).
- **Verification / Success**: Soft emerald container (`#ecfdf5`), border in `#a7f3d0`, text `#065f46`, accented by an emerald icon.
- **Ghost**: Transparent background, text `#334155`. Hover background `#f1f5f9`.

### Cards & Analytical Panels

- White `#ffffff` surface, 1px `#e2e8f0` hairline perimeter, 24px border radius (`rounded-xl`), and internal padding of 24px (`space-lg`).
- Header modules within cards feature bottom borders in `#f1f5f9` with an 8px offset margin, cleanly isolating operational titles from metrics.

### Input Fields & Controls

- **Text Inputs**: 40px standard height, white background, 1px `#e2e8f0` border, 8px radius, text in `#0f172a`. Focused state activates a 1px border in `#0284c7` and a soft ambient focus ring (`box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.12)`).
- **Checkboxes & Radios**: 18px dimensions, border in `#cbd5e1`, 4px radius for checkboxes, full circle for radios. Checked state applies `#0284c7` fill with crisp white vector markings.

### Chips & Badges

- **Status Verification Badge**: 24px height, full pill radius, composed of soft emerald tint (`#ecfdf5`), hairline border (`#a7f3d0`), and `#047857` semibold text with an optional 6px circular pulse dot.
- **Filter Chip**: 32px height, slate tint (`#f1f5f9`), border (`#e2e8f0`), text (`#334155`). When active, transitions to primary blue border (`#0284c7`), background (`#f0f9ff`), and text (`#0284c7`).

### Data Tables & Lists

- Table headers utilize `#f8fafc` background, uppercase `label-sm` slate text (`#64748b`), and bottom stroke `#e2e8f0`.
- Row height fixed at 48px to 56px, containing tabular numerical values, subtle `#f8fafc` hover fill, and border-bottom hairline separation. Zero vertical cell dividing lines.

### Verification Status Strip (Domain Specific)

- An inline verification strip component featuring a soft emerald left border (3px solid `#059669`), white surface, light border `#e2e8f0`, housing identity stamps, cryptographic signatures, and status timestamps.
