# Frontend Design System

**Status:** In progress
**Owner:** Product/Engineering
**Dashboard reference inspected:** `afrinov-platform/apps/frontend/src/pages/Dashboard.tsx` and `Dashboard.css`
**Source of truth:** `afrinov-platform/apps/frontend/src/index.css`, `tailwind.config.ts`, and shared components

This document records the dashboard and shared frontend conventions found in the implementation. It distinguishes the shared application rules from dashboard-specific presentation. Values below describe the current code; unresolved defects and proposed corrections are called out separately.

## Dashboard reference and inspection

The dashboard is the protected `/` route in `src/App.tsx`. It renders inside `AppShell`, which supplies the fixed-height application frame, navigation, sticky header, scrollable main column, page container, and footer. The dashboard is the only route that requests the full page-container width; its content is capped at 1600px. It defines its own title, summary cards, chart panels, exception list, and catalogue table in `Dashboard.tsx` and `Dashboard.css`, while reusing `Button`, `DataTable`, `Badge`, `EmptyState`, and `StockStatusBadge`.

The rendered page was inspected in Chromium using the frontend-only mock mode at 1440px desktop and 390px mobile widths, in light and dark themes. The dashboard populated with mock stock data. These renders verify layout and theme appearance with the mock dataset; they do not verify a live backend or production data. The charts and catalogue content are data-dependent, so their empty and error states were not all visually rendered. Source code provides those states, noted below.

## A. Typography and content

### Shared type scale

The configured sans stack is `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`; the mono stack is `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. No font file or external font import is present in the frontend entry page, so Inter is used only when already available to the client; otherwise the stack falls back to the system font.

| Token | Size | Line height | Intended use |
|---|---:|---:|---|
| `display` | 26px | 1.25 | Large page title |
| `h1` | 22px | 1.3 | Standard h1 |
| `h2` | 18px | 1.35 | Section heading |
| `h3` | 15px | 1.4 | Card/form subheading |
| `body` | 14px | 1.5 | Body copy |
| `small` | 13px | 1.45 | Supporting text |
| `xs` | 12px | 1.4 | Labels and metadata |

The base body is 14px/1.5. Labels and table text default to 13px. Numeric values use tabular figures where practical; identifiers use the mono stack. Shared page titles use `PageHeader` and sentence/title case supplied by the page. The dashboard has a deliberate local exception: a responsive 26–34px uppercase title, uppercase eyebrow and compact all-caps chart kickers. Dashboard explanatory copy is 13px, KPI labels 12px, and chart/table metadata ranges from 10px to 12px. Do not copy these dashboard-only micro-label sizes into operational forms or full-page tables.

Visible interface wording uses concise sentence case, action labels such as “Refresh” and “View all,” and business terms such as “Items in stock,” “Urgent,” and “Out of stock.” Format counts with `formatNumber`, dates with `formatDateTime`, and monetary values with `formatCurrency`; the inspected mock uses ZAR and South African number formatting. Do not change stored/API vocabulary as part of UI copy consistency.

## B. Color and theme

Colors are RGB-channel CSS variables so Tailwind utilities can apply opacity. The primary brand red is `#E3001B` (`--color-brand-500`). Use it for primary actions, links, selected navigation, and restrained dashboard accents. It is distinct from danger: danger is a semantic red (`#C0392B` in light mode and `#EF4444` in dark mode), with separate semantic backgrounds and text tones.

| Role | Light mapping | Dark mapping |
|---|---|---|
| Surface 0 (raised surface) | `255 255 255` | `26 29 35` |
| Surface 50 (page ground) | `247 248 250` | `15 17 21` |
| Surface 100 / 200 (muted fill / border) | `238 240 244` / `221 225 232` | `37 41 50` / `45 50 59` |
| Surface 500 (muted text) | `107 116 132` | `154 163 178` |
| Surface 800 / 900 (strong / strongest text) | `33 38 46` / `17 21 27` | `232 234 237` / `247 248 250` |
| Success 500 | `30 132 73` | `34 197 94` |
| Warning 500 | `214 137 16` | `245 158 11` |
| Danger 500 | `192 57 43` | `239 68 68` |
| Info 500 | `30 111 217` | `59 130 246` |

Theme selection is class-based (`.dark`) and supports `system`, `light`, and `dark`; the preference is loaded from `appearance.theme`. Semantic badge fills/text use paired light and dark tokens. Surfaces, borders, charts, controls, and text should use these semantic variables or Tailwind colors, not a page-specific hex value. Check contrast for text and controls on their actual theme surface; the CSS token definitions alone do not certify contrast.

## C. Layout, spacing, and responsive rules

- The shell uses a 56px header, a 220px expanded desktop sidebar, a 68px collapsed sidebar, and a 288px mobile drawer. The shell stays within the viewport; the content column scrolls.
- Shared `PageContainer` uses vertical padding 24px and horizontal padding 16px, 24px from the `sm` breakpoint, and 32px from `lg`. Standard pages use `max-w-6xl`; the dashboard uses full width and an inner 1600px maximum.
- Tailwind breakpoints are the standard 640px, 768px, 1024px, and 1280px set. Dashboard-specific refinements also use 560px: KPI cards are 2 columns on narrow screens, 3 columns from 640px until the desktop layout, then 6 columns (7 for approvers); analytical panels move from 3 columns to 2 below 1024px and 1 below 768px. At 560px, the dashboard table keeps its readable minimum width and scrolls horizontally.
- Shared surfaces use 6px default rounding, 8px `md`, 10px `lg`, and card/popover shadows. Dashboard panels use approximately 10px rounding, 14–16px padding, subtle borders, and low-contrast surface gradients.
- Keep page content fluid and prevent flex/grid children from forcing horizontal page overflow. For genuinely wide tables, use a local horizontal scroll container rather than shrinking numeric columns until values collide.

## D. Components and states

- **Buttons:** use the shared `Button` variants `primary`, `secondary`, `ghost`, and `danger`, with medium and small sizes. They are inline-flex controls with a 6px radius, 14px body text, and consistent icon gaps. Loading disables the control and displays a spinner; disabled controls are dimmed and use a disabled cursor. Small-screen and coarse-pointer rules raise minimum control sizes (32px small on narrow screens; 44px on coarse pointers, 36px for small buttons).
- **Cards and metrics:** shared cards use `surface-card` / `surface-panel`. Dashboard KPIs are links only when a destination exists; otherwise they are non-interactive `div`s. KPI hover lifts the link slightly, and keyboard focus is visible. Do not make an entire panel appear clickable when it has no action.
- **Headers:** standard pages use `PageHeader` with optional breadcrumb, description, meta, and actions; section headings use `SectionHeader`. Dashboard intentionally composes a custom overview header and section hierarchy.
- **Tables:** shared `DataTable` wraps `table` in a bordered surface and horizontal scroller; column headers are 12px uppercase semibold with 12px vertical padding, body cells are 14px with 8px padding, and compact density reduces vertical padding. Sorting/filtering/pagination are page-level controls, not built into `DataTable`. Interactive rows must retain clear keyboard semantics; row click support in the current primitive itself is pointer-only and should not be used as the sole way to reach an action.
- **Forms:** use `Field` to bind a visible label to a control and place help or error copy underneath. Shared inputs/selects use 14px text, 10px horizontal/6px vertical padding, theme-aware surface/border/placeholder colors, and a brand focus ring. Errors use the danger token and `role="alert"`. Required state is marked with a red asterisk; the label must still communicate the requirement accessibly.
- **Badges and feedback:** use `Badge` semantic tones (`neutral`, `success`, `warning`, `danger`, `info`, `brand`) and optional decorative dot. `Alert`, `Toast`, `ConfirmDialog`, and `EmptyState` are the shared feedback patterns. Destructive or ledger-changing work should use a confirmation flow; success/failure should identify the result and next action.
- **Menus and dialogs:** Radix-based tooltip, dropdown, popover, and scroll-area wrappers inherit theme tokens. Preserve focus management, Escape behavior, accessible names, and focus return when using these primitives.
- **Loading/error/empty:** routes have a shared page-level loading skeleton. Dashboard has metric/chart/table skeletons, a data error banner with retry, section-level errors, and explicit no-data messages. Keep loading feedback distinct from empty data and from failed requests.
- **Icons:** use the inline SVG set in `components/Icon.tsx` or the established local chart colors. Icon-only actions require an accessible name; decorative icons are hidden from assistive technology.

## E. Interaction and accessibility

Use semantic links for navigation and buttons for actions. Hover is supplementary; all actionable controls need a keyboard-visible focus treatment. The shared base focus rule is a 3px brand-tinted ring. Dashboard links have a 2px brand outline with 3px offset. Maintain visible selected-route styling in the sidebar, `aria-current` via `NavLink`, and names/expanded state for collapsed or hierarchical navigation.

The dashboard communicates freshness with an update timestamp and `aria-live="polite"`, failures with `role="alert"`, and loading with labelled skeleton regions. The charts expose text alternatives through SVG `role="img"` and `aria-label`; the donut's nested SVG is hidden from the accessibility tree. Do not rely on chart color alone to communicate category/status; retain labels and counts. Global and dashboard styles honor `prefers-reduced-motion`; keep transitions short and remove nonessential animation for reduced-motion users.

## F. Dashboard-specific composition

The dashboard groups current stock KPIs, stock-health threshold coverage, category and location valuation, prioritized stock exceptions, and the live catalogue. Its panels use restrained brand/semantic accents rather than filling large areas with red. Current-price totals explicitly exclude VAT, while unpriced stock is called out. The “View all” action and linked metrics carry users to operational pages. Preserve this information architecture and data links when changing shared styles.

The custom chart palette is currently hard-coded in `DashboardCharts.tsx`; use semantic tokens for status meanings and a theme-aware palette for neutral categories if this chart is modified. Currency and date display must continue through the existing formatting helpers.

## Observed defects and validation

1. **Resolved - dashboard chart label contrast:** before correction, category-axis SVG text rendered black in both themes. The handwritten declarations used Tailwind's alpha-value placeholder, which browsers reject in plain CSS. The same invalid placeholder occurred in index.css. Replacing it with full-opacity CSS alpha values made the dashboard labels and shared theme overrides resolve correctly.
2. **Resolved - dashboard page heading:** the route originally had an eyebrow and description but no h1. Its custom .dashboard-heading h1 rule already existed. The page now renders an h1 labelled Dashboard within the existing header.
3. **Resolved - skip to content:** the protected shell now starts its keyboard order with a visible-on-focus link targeting the page main landmark; the landmark can receive focus.
4. **Resolved - Settings main landmark:** the Settings grid column now uses a neutral wrapper instead of nesting a second main landmark inside the shell main landmark.
5. **Intentional dashboard type scale:** chart and list metadata are denser than ordinary pages. Keep those dashboard-only sizes local; do not propagate them into forms or primary content.
6. **Unverified:** no exhaustive contrast calculation or full keyboard-only browser pass has been completed. Visual inspection covered mock data at 1440px and 390px, light/dark dashboard, and dark table, form, and settings surfaces. Live API errors, every empty state, and touch hardware are not represented by those renders.

## Route audit and inconsistency register

The router and page modules were checked on 2026-10-21. page-inventory.md records route groups and conditional redirects. Routes are lazy-loaded; all routes except /login are inside the protected shell. A frontend-only Chromium pass reached every registered route family with an administrator session and recorded no page-level JavaScript errors. Source review covered page headers, shared controls, layout utilities, loading/empty/error branches, route gating, and the only page stylesheet beyond index.css (Dashboard.css). Screenshots were reviewed for the dashboard and representative stock, issue, materials, settings, and stock-status surfaces. Some early samples captured API-backed pages while they were loading; their data, empty, and error branches were source-audited and are not all claimed as visually verified.

| Page or component | Observed inconsistency | Reference standard | Root cause | Severity | Proposed correction and outcome | Regression risk |
|---|---|---|---|---|---|---|
| src/index.css, src/pages/Dashboard.css | Before correction, ordinary CSS declarations used the literal alpha-value placeholder. Browsers discarded those declarations; dashboard labels fell back to black and handwritten dark overrides were unreliable. | Theme variables resolve to valid colors; chart labels use readable surface tokens in both themes. | Tailwind opacity syntax was copied from tailwind.config.ts into plain CSS declarations. | High | Implemented: replaced 68 occurrences in index.css and 94 in Dashboard.css with valid full-opacity alpha (1). Chromium computed chart fills as rgb(107, 116, 132) in light mode and rgb(154, 163, 178) in dark mode. | Medium: theme overrides became active; dashboard and representative controls/surfaces were inspected in both themes. |
| / dashboard | Initial route inspection found no h1 although other page routes use PageHeader with an h1; the custom stylesheet already defines an h1 treatment. | One descriptive page-level h1, with section headings below it. | Custom dashboard markup omitted the h1 element. | High | Implemented: added Dashboard as h1 within the existing header and reviewed desktop/mobile renders. | Low: small vertical shift in dashboard header only. |
| Protected AppShell | No skip-to-content link preceded repeated navigation and header landmarks. | Keyboard users can jump directly to the page main landmark. | Shared shell had no skip link and main had no target id. | Medium | Implemented: added the first-focusable skip link and stable main-content focus target. Chromium confirmed keyboard activation focuses main. | Low: keyboard navigation only; target focus verified. |
| Settings route | A second main landmark was nested inside the app shell's main landmark. | One main landmark per document; nested layout regions use a neutral wrapper or labelled section. | Settings used a main element for a grid column even though PageContainer already supplies the page main landmark. | Medium | Implemented: changed the grid-column wrapper to a neutral div; browser inspection reports one main landmark on Settings. | Low: same classes and layout; semantics only. |
| Standard page headers and controls | No systemic mismatch was found in sampled operational screens. Pages use shared PageHeader, field, button, badge, surface, and table styles. The dashboard's denser chart labels are a deliberate local exception. | Shared page hierarchy and semantic component variants documented above. | Existing shared primitives and Tailwind tokens are already used broadly; no competing page stylesheet was found. | Low (accepted) | Retain page-specific layout where the workflow requires it; use shared primitives for repeated patterns. | Low. |

### Audit coverage

Inspected route families: sign-in; dashboard; stock balances and issue/return/receive/count workflows; material and supplier lists/details; movements; conditional purchase-order list/create/detail/edit; stock-status, consumption, and stock reports; racks, locations, projects, recipients, and tools; Settings overview and general, notifications, inventory, purchase-orders, appearance, users, security, system, data, and history sections; and not-found. Retired report paths and goods-receipt paths were checked as redirects rather than active page designs. Role gates and feature-flag conditions remain owned by App.tsx and the permission hooks.

### Implementation plan

1. [x] Correct the invalid alpha syntax in shared and dashboard CSS and add the missing dashboard page heading.
2. [x] Add a skip-to-content target in the shared app shell and remove the nested Settings main landmark.
3. [x] Render and inspect both themes, including dashboard, form, table, settings, and mobile surfaces.
4. [x] Run the frontend typecheck, lint, build, and test scripts; results are recorded in the completion report.

## Implementation rule

Prefer existing CSS variables, Tailwind semantic color utilities, and shared components. Keep dashboard-only composition local where the pattern is genuinely unique. When a repeated mismatch is found, correct its shared source (token, component, or primitive) and record page-specific exceptions instead of adding unrelated local overrides.

## Evidence inspected

- `afrinov-platform/apps/frontend/src/App.tsx` and `components/AppShell.tsx` (route and shell)
- `pages/Dashboard.tsx`, `pages/Dashboard.css`, and `pages/DashboardCharts.tsx` (dashboard, chart, responsive and state handling)
- `components/PageContainer.tsx`, `PageHeader.tsx`, `Button.tsx`, `Field.tsx`, `Badge.tsx`, `DataTable.tsx`, `EmptyState.tsx`, `Sidebar.tsx` (shared conventions)
- `src/index.css` and `tailwind.config.ts` (tokens, themes, base rules, components, breakpoints, typography scale)
- `hooks/useAppearance.ts` and `components/GlobalPreferencesApplier.tsx` (appearance preference application)
- Frontend-only Chromium render at 1440px and 390px, light and dark themes (visual inspection only; mock data)
