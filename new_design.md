# DESIGN.md - Verity "Tactile Enterprise Dimensionality"

## 1. Vision & Visual Philosophy
**Verity** is an enterprise intelligence and grounded RAG/Text-to-SQL platform built to inspire confidence, precision, and operational clarity.

The visual direction marries **technical rigor** with an inviting, **tactile 3D physical aesthetic**:
- **Tangible Affordance & Physicality**: Rather than flat or sterile enterprise tables, surfaces appear elevated with multi-stop ambient light shadows, clean perimeter highlights, and physical button presses.
- **Clarity & Effortless Cognition**: Complex AI telemetry, vector similarity metrics, and database queries are translated into human-readable cards, plain-English status badges, and clear visual hierarchy.
- **Zero Gimmicks**: Tactile depth is functional and restrained—no neon bloom, no oversaturated purple/pink AI tropes, and no distracting decorative glassmorphism.

---

## 2. Color Palette & Tokens

### Canvas & Surfaces
| Token | Hex | Role |
| :--- | :--- | :--- |
| `surface-canvas` | `#F8F9FF` | Primary ambient page background with a subtle cool undertone |
| `surface-canvas-subtle` | `#EFF4FF` | Recessed zones, table header rows, input group backgrounds |
| `surface-card` | `#FFFFFF` | Primary elevated cards, modals, and container surfaces |
| `surface-card-hover` | `#F8FAFC` | Interactive surface hover states |
| `border-subtle` | `#E2E8F0` | Default border for cards, inputs, and dividers |
| `border-divider` | `#CBD5E1` | Stronger division lines, table borders, active states |

### Primary Accent & Action Colors
| Token | Hex | Role |
| :--- | :--- | :--- |
| `primary` | `#0284C7` | Main call-to-action buttons, active navigation markers, key highlights |
| `primary-hover` | `#0369A1` | Button hover and active press states |
| `primary-light` | `#E0F2FE` | Badge backgrounds, citation pill highlight tints |
| `primary-border` | `#BAE6FD` | Borders for selected chips and active input rings |

### Semantic & Feedback Colors
| Token | Hex | Background Tint | Role |
| :--- | :--- | :--- | :--- |
| `success` | `#10B981` | `#ECFDF5` (`border: #A7F3D0`) | Grounded sources, 99.4%+ metrics, live/healthy micro-services |
| `warning` | `#F59E0B` | `#FFFBEB` (`border: #FDE68A`) | High p99 spike latency, slow SQL queries, schema warnings |
| `error / alert` | `#EF4444` | `#FEF2F2` (`border: #FECACA`) | Failed OCR jobs, parse timeouts, restricted table violations |
| `info / neutral` | `#64748B` | `#F1F5F9` (`border: #E2E8F0`) | Monospace metadata, row indexes, inactive file badges |

### Typography & Ink
| Token | Hex | Role |
| :--- | :--- | :--- |
| `text-primary` | `#0F172A` | Primary titles, KPI values, high-contrast headings |
| `text-secondary` | `#475569` | Body copy, descriptions, secondary action labels |
| `text-muted` | `#94A3B8` | Field placeholders, timestamp sub-labels, table column headers |
| `text-code` | `#0F172A` | Monospace code blocks, SQL syntax, file names, cosine metrics |

---

## 3. Elevation & 3D Tactile Affordances

### Elevation System
Tactile depth is constructed through layered multi-stop shadows paired with a 1px perimeter border:

- **Level 0 (Flat / Recessed)**:
  - `box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.05);`
  - `border: 1px solid #E2E8F0;`
  - *Usage*: Search fields, input boxes, disabled containers, code consoles.

- **Level 1 (Card Baseline)**:
  - `box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.04), 0 2px 6px -1px rgba(15, 23, 42, 0.03);`
  - `border: 1px solid #E2E8F0;`
  - *Usage*: Standard metric KPI cards, document table containers, health status tiles.

- **Level 2 (Elevated & Interactive)**:
  - `box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.07), 0 4px 10px -2px rgba(15, 23, 42, 0.04);`
  - `border: 1px solid #E2E8F0;`
  - *Usage*: Source citation cards on hover, active conversation bubble, bottom floating prompt bar.

- **Level 3 (Floating Hero & Modal Auth)**:
  - `box-shadow: 0 20px 35px -10px rgba(15, 23, 42, 0.08), 0 8px 16px -4px rgba(15, 23, 42, 0.04);`
  - `border: 1px solid #E2E8F0;`
  - *Usage*: Main login authorization card, drop-down popovers, primary telemetry charts.

### Tactile Physical Button States
- **Normal**: Solid `#0284C7` with `box-shadow: 0 2px 4px rgba(2, 132, 199, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2);`
- **Hover**: Shift upward `transform: translateY(-1px);` with `box-shadow: 0 4px 8px rgba(2, 132, 199, 0.32);`
- **Active / Press**: `transform: translateY(1px);` with `box-shadow: 0 1px 2px rgba(2, 132, 199, 0.2);`

---

## 4. Typography Rules

- **Primary Font**: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`
  - **Screen / Hero Titles**: SemiBold 24px–28px, tracking -0.02em (`#0F172A`)
  - **Card Headers & Subheadings**: SemiBold 16px–18px (`#0F172A`)
  - **Body Copy**: Regular 14px, line-height 1.55 (`#334155`)
  - **Labels & Micro-copy**: Medium 11px–12px, tracking +0.01em (`#64748B`)

- **Technical & Monospace Font**: `JetBrains Mono` or `Fira Code`
  - **Top KPI Big Metrics**: Bold 32px (`#0F172A`)
  - **Generated SQL & Queries**: Regular 13px (`#0F172A` on `#0A0F1D` dark console or `#F8FAFC` light block)
  - **Chunk IDs, Cosine Distance, Latency Timers**: Medium 12px

---

## 5. Component Patterns

### A. Conversation & Grounded Citations
- **Question Tile**: White elevated card, user avatar badge (`#0F172A`), timestamp in UTC.
- **Answer Body**: High readability line height with inline numbered citation chips (`[1]`, `[2]`) in `#0284C7` over `#E0F2FE`.
- **Right Citation Drawer**:
  - Distinct numbered source cards (`[1] Q3_Enterprise_Audit.pdf`).
  - Cosine relevance match pill (`94% Match` in emerald green).
  - Verbatim excerpt block in italicized high-contrast slate.
  - Quick action link to jump directly to page chunk in viewer.

### B. Ingestion & Document Repository
- **Dropzone Area**: Tactile cloud upload container with subtle dashed border, dual primary ("Upload Documents") and enterprise cloud connector ("Connect Cloud Drive") buttons.
- **Status Pills**:
  - `Indexed`: Soft green fill `#ECFDF5` with `#10B981` dot.
  - `Processing`: Animated or percentage bar `#0284C7` with blue pill.
  - `Failed (OCR)`: Soft rose fill `#FEF2F2` with `#EF4444` badge.

### C. Admin & Telemetry Dashboards
- **Smooth 2D/3D Metric Charts**: Light sky-blue gradient fill (`rgba(2, 132, 199, 0.12)` down to `transparent`) with a 2px `#0284C7` line and physical hover tooltip pin.
- **Micro-service Health Grid**: 4-quadrant layout with operational status indicators, active connection pool counts, and millisecond latency timers.
- **Incident Stream**: Soft warning cards with direct "Retry Job" and "View Stack Trace" secondary buttons.

---

## 6. Do's and Don'ts

### ✅ Do
- Maintain generous whitespace and an **8px grid rhythm** (8px, 16px, 24px, 32px).
- Use tactile multi-stop shadows to give buttons and interactive cards physical affordance.
- Always display document source provenance, page numbers, and cosine match scores alongside every AI-generated response.
- Pair numerical KPI metrics with conversational labels so non-technical users immediately understand what is measured.

### ❌ Don't
- Do not use fluorescent neon glow or blurry bloom effects.
- Do not use generic AI clichés like sparkle magic wands, purple gradients, or cartoon brain icons.
- Do not place dark-mode elements arbitrarily in the light layout; preserve the clean `#F8F9FF` canvas.
- Do not hide confidence ratings or database tables touched by a query—auditability is paramount.