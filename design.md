web application/stitch/projects/2964773870553650410/screens/96777e984fbc4f36a7cd3df96970deaa
# Design System & UI/UX Architecture Specification: Verity Slate
**Document Name:** `design.md`  
**System:** Enterprise Knowledge Base with Hybrid Text-to-SQL & Document Retrieval (Clean & Accessible Edition)  
**Target Environment:** Desktop Web (1440px+ optimized, 1280px minimum responsive break)  
**Tech Stack:** React 19, TypeScript, Next.js App Router, Tailwind CSS v3.4+, shadcn/ui, Lucide Icons  

---

## 1. Design Philosophy & Visual Principles

### 1.1 Aesthetic Tone & Clarity
- **Clean, Calm & Human-Centric:** Deprecates dense terminal aesthetic, claustrophobic IDE panes, and complex raw telemetry in favor of an airy, accessible executive workspace.
- **Cognitive Ease:** High signal-to-noise ratio. Complex technical artifacts (e.g. abstract syntax trees, raw SSE logs, SQL execution plans) are gracefully tucked into progressive disclosure components (accordions, drawers, clean modals).
- **Subtle Elevation & Whitespace:** Generous 16px–24px internal card paddings, soft neutral background tinting (`#FAF8FF` / `#F8FAFC`), rounded corners (`rounded-lg` 8px to `rounded-xl` 12px), and featherweight border strokes (`border-slate-200/80`).

---

## 2. Design Tokens & Color Palette

### 2.1 Core Palette

```css
:root {
  /* Surface Hierarchy (Light Mode / Airy Workspace) */
  --background: #FAF8FF;              /* Soft ambient canvas */
  --surface: #FFFFFF;                 /* Primary card & workspace surface */
  --surface-subtle: #F8FAFC;          /* Inset blocks, table headers, dropzones */
  --surface-muted: #F1F5F9;           /* Secondary badges, hover states */
  --surface-accent: #E0F2FE;          /* Sky 100 - active nav items & pill highlights */
  
  /* Borders & Dividers */
  --border-subtle: #E2E8F0;          /* Default structural 1px divider (slate-200) */
  --border-light: #F1F5F9;           /* Internal card dividers (slate-100) */
  --border-focus: #0284C7;           /* Active primary focus ring */

  /* Typography */
  --text-primary: #0F172A;           /* Slate 900 - Headings & primary numbers */
  --text-secondary: #334155;         /* Slate 700 - Body copy & answer narrative */
  --text-muted: #64748B;             /* Slate 500 - Meta labels, timestamps */
  --text-tertiary: #94A3B8;          /* Slate 400 - Placeholders, disabled states */

  /* Primary Brand & Accents */
  --brand-primary: #0284C7;          /* Sky 600 - Main interactive CTA & brand */
  --brand-hover: #0369A1;            /* Sky 700 - Hover button states */
  --brand-tint: #F0F9FF;             /* Sky 50 - Card highlights & search tags */

  /* Verification & Route Semantics */
  --status-verified: #10B981;        /* Emerald 500 - Validated matches & live badges */
  --status-verified-bg: #ECFDF5;     /* Emerald 50 - Soft badge background */
  --status-warning: #F59E0B;         /* Amber 500 - Pending or warning states */
  --status-restricted: #EF4444;       /* Rose 500 - High security access level */
  --status-restricted-bg: #FEF2F2;   /* Rose 50 - Restricted badge background */
}
```

---

### 2.2 Typography Specifications

- **Primary Font Family:** `Manrope`, `Inter`, or `Geist Sans`
  - **Page / Section Headings:** `22px / 28px` to `28px / 36px`, bold / semi-bold (`font-bold`, `#0F172A`).
  - **Card Headers:** `15px / 20px`, semi-bold (`font-semibold`, `#0F172A`).
  - **Body & Synthesized Copy:** `14px / 22px`, normal weight (`font-normal`, `#334155`), optimized for continuous executive reading.
  - **Meta Labels & Secondary Badges:** `11px / 14px`, medium weight (`font-medium`, `#64748B`), uppercase tracking `+0.04em`.
- **Monospace Font Family:** `JetBrains Mono` or `Geist Mono`
  - Used sparingly for cryptographic hashes, SQL queries, row IDs, and numeric metrics (`font-variant-numeric: tabular-nums`).

---

## 3. Screen Architecture & Core Layouts

### 3.1 Global Navigation Shell (Top Bar + Footer)
A clean, uncluttered persistent frame without overwhelming vertical multi-layer toolbars:
- **Top Navigation Bar:**
  - Left: Clean brand mark (`Verity` with minimal teal/sky dot).
  - Center: Segmented top navigation tabs (`Ask & Analytics`, `Knowledge Base`, `Data Schemas`, `Audit Trail`) with subtle active pill state (`bg-sky-100 text-sky-800`).
  - Center-Right: Environment & Live Replica indicator (`Production Replica (Live)`).
  - Right: Quick schema/search input bar (`Search schemas, logs, queries...`) and user profile avatar (`Sarah P. • Analyst`).
- **Footer:**
  - Standardized legal and operational trust strip: Copyright, `Security Attestation`, `Replica Latency: 14ms`, and `System Status`.

---

### 3.2 Analytics Workspace Screen

**Layout Structure:** Two-column split layout with central query workspace and contextual evidence drawer:

```
+--------------------------------------------------------------------------------------------------------------------+
|  TOP NAV: [Verity]  |  [Ask & Analytics]  [Knowledge Base]  [Data Schemas]  [Audit Trail]  |  [Search...]  [Profile]|
+--------------------------------------------------------------------------------------------------------------------+
|  BREADCRUMB & METRIC HEADER: Financial Audit & Data Pipeline Analysis (Session #VR-8492)  [Zero-Knowledge Hash]    |
+-----------------------------------------------------------------------+--------------------------------------------+
| MAIN WORKSPACE (Flex-1)                                               | SOURCE EVIDENCE & CONTEXT DRAWER (380px)   |
|                                                                       |                                            |
| 1. Active Query Card                                                  | 1. Cryptographic Document Attestation Card |
|    - User identity & query timestamp                                  |    - Source file: SEC-10K-2024.pdf         |
|    - Natural language query heading                                   |    - Checksum: SHA-256 Valid               |
|    - Badges: [Hybrid: SQL + Doc Match] [Replica US-East-1] [312ms]    |    - Highlighted excerpt viewer with       |
|                                                                       |      accentuated quotation                 |
| 2. Synthesized Response Narrative                                     |    - Actions: [Open Full Doc] [Copy Link]  |
|    - Attested by Verity Engine tag                                    |                                            |
|    - Plain-language insight with highlighted metrics ($4.21M, +18.4%) | 2. Data Warehouse Ledger Trace Card        |
|    - Verified citation chips: [SEC 10-K, p. 28] [Snowflake Ledger]    |    - Telemetry Table: Usage History        |
|                                                                       |    - Scanned rows: 1,842,910 rows          |
| 3. Clean Cohort Metrics Table                                         |    - Query ID & sync latency               |
|    - 4-column structured breakdown: Tier, Accounts, Revenue, Credits  +--------------------------------------------+
|    - Efficiency comparison progress bar (Tier 3 vs Tier 2 vs Tier 1)                                               |
|                                                                                                                    |
| 4. Progressive Disclosure Accordion:                                                                               |
|    > "View Generated SQL & Execution Plan" (Expands on demand)                                                     |
|                                                                                                                    |
| 5. Docked Query Submission Bar:                                                                                    |
|    [Ask any question across documents or data warehouses...]                                                      |
|    [Auto (Smart Route) v]  [+ Add Grounding Doc]                              [Submit Query >]                     |
+--------------------------------------------------------------------------------------------------------------------+
```

---

### 3.3 Knowledge Base & Data Sources Screen

**Layout Structure:** Balanced multi-tier dashboard organized into 3 operational quadrants:

1. **Top Metric Cards (3-Column Grid):**
   - **Total Documents:** `1,482` (+18 this week, 480k indexed paragraphs).
   - **Connected Databases:** `4 Active` (PostgreSQL, Snowflake, BigQuery, ClickHouse).
   - **Index Status:** `Healthy & Synced` (Embedding HNSW: 1,536 dim, Last cycle 4m ago).
2. **Left Panel: Ingestion & Uploads:**
   - **Dropzone Container:** Rounded soft container (`bg-slate-50 border-dashed`) with cloud upload glyph and clear drag & drop instructions (Max 150MB per file).
   - **Recent Uploads Table:** File name, human-readable size, access level badge (`Public`, `Analyst`, `Restricted`), and live processing status (`Ready`).
3. **Right Panel: Data Warehouses & Integrity:**
   - **Warehouse Grid (2x2):** Clean individual connection cards for PostgreSQL Prod, Snowflake EDW, BigQuery Finance, and ClickHouse Analytics with latency pings and `Sync Schema` actions.
   - **Cryptographic Replica Integrity Banner:** Soft green alert container validating zero plain-text schema leakage with proof root hash.

---

## 4. UI Components & Interaction Specifications

### 4.1 Citation Chips & Context Highlighting
- **Inline Citation Chip:**
  - Token Style: `bg-sky-50 text-sky-700 border border-sky-200/80 rounded px-2 py-0.5 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-sky-100 hover:text-sky-800 transition-colors`
  - Click behavior: Shifts focus to the Context Drawer, scrolling to and illuminating the referenced excerpt with a soft sky accent ring.

### 4.2 Progressive Disclosure: SQL & Technical Details
- Technical SQL statements are withheld from the default reading flow to keep the screen digestible for non-technical leadership.
- Toggled via `<details>` / `<Accordion>`:
  - Header: `View Generated SQL & Execution Plan` with chevron indicator.
  - Content: Clean monospaced code block with copy action, execution timing, and zero AST mutator verification.

---

## 5. Tailwind CSS & shadcn/ui Implementation Strategy

### 5.1 shadcn/ui Primitives
- `Card`, `CardHeader`, `CardTitle`, `CardContent`: Baseline structural containers with `bg-white border-slate-200/80 shadow-xs`.
- `Badge`: Extended variants:
  - `variant="live"`: `bg-emerald-50 text-emerald-700 border-emerald-200/60 font-medium`
  - `variant="analyst"`: `bg-sky-50 text-sky-700 border-sky-200/60 font-medium`
  - `variant="restricted"`: `bg-rose-50 text-rose-700 border-rose-200/60 font-medium`
- `Table`, `TableHeader`, `TableRow`, `TableCell`: Generous cell padding (`py-3 px-4`), light borders, and subtle zebra or hover accents.
- `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent`: For collapsible technical plans.
- `Input`, `Button`: Clean rounded-lg elements with high-contrast text and accessible focus rings (`focus-visible:ring-sky-500`).

---

### 5.2 Signature Tailwind Utility Class Recipes

#### Clean Cohort Metrics Table
```tsx
<div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
  <table className="w-full text-left text-sm">
    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
      <tr>
        <th className="py-3 px-4">Account Tier</th>
        <th className="py-3 px-4 text-center">Accounts</th>
        <th className="py-3 px-4 text-right">Q3 Revenue</th>
        <th className="py-3 px-4 text-right">Snowflake Credits</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-100 text-slate-700">
      <tr className="hover:bg-slate-50/80 transition-colors">
        <td className="py-3 px-4 font-medium text-slate-900 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-500" />
          Tier-3 Enterprise
        </td>
        <td className="py-3 px-4 text-center text-slate-600">42</td>
        <td className="py-3 px-4 text-right font-medium text-slate-900">$4,210,800</td>
        <td className="py-3 px-4 text-right text-slate-600">14,280</td>
      </tr>
    </tbody>
  </table>
</div>
```

#### Clean Source Verification Excerpt Card
```tsx
<div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 shadow-xs">
  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
    <div className="flex items-center gap-2">
      <FileText className="w-4 h-4 text-sky-600" />
      <span className="text-xs font-semibold text-slate-800">SEC-10K-2024.pdf</span>
      <span className="text-xs text-slate-400">• Page 28</span>
    </div>
    <span className="text-[11px] font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
      SHA-256 Valid
    </span>
  </div>
  <div className="p-3 bg-slate-50 rounded-md border border-slate-200/60 text-xs text-slate-600 leading-relaxed italic">
    “For the quarterly period ended September 30, 2024, our Tier-3 Enterprise segment delivered $4.21M in recognized gross cloud revenues...”
  </div>
</div>
```
