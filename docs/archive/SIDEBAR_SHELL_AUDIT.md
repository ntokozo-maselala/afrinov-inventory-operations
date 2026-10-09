# Afrinov IMS — Sidebar & Application Shell Audit

## A. Current Architecture

### Application Shell Components
- **AppShell.tsx** — Root layout component managing sidebar, header, main content, footer
- **Sidebar.tsx** — Navigation component with collapsible behavior (220px expanded, 68px collapsed)
- **useNavGroups.tsx** — Navigation structure hook with 6 groups (Overview, Operations, Procurement, Catalogue, Insights, Account)
- **Icon.tsx** — Consistent SVG icon set (16x16, 1.6 stroke weight, currentColor)
- **PageHeader.tsx** — Page-level header with breadcrumb, title, description, actions

### State Management
- `collapsed` — Persisted in localStorage (`afrinov.sidebarCollapsed`)
- `mobileOpen` — Ephemeral React state for mobile drawer
- Responsive behavior via CSS media queries (`lg: 1024px`)

### Design Tokens
- CSS custom properties for colors (brand, surface, semantic)
- 8px spacing rhythm via Tailwind
- Inter typography, 4px border radius base
- Brand red `#E3001B` as primary accent

---

## B. Current Problems

| ID | Problem | Severity |
|---|---|---|
| P1 | No tablet breakpoint — jumps from mobile (<1024px) to desktop (≥1024px) | High |
| P2 | Header collapse button only visible on desktop; mobile header lacks sidebar state awareness | High |
| P3 | Main content `max-w-[1400px]` doesn't account for sidebar state | High |
| P4 | Mobile drawer fixed `w-72` (288px) — no safe-area inset handling | High |
| P5 | Collapsed sidebar uses `title` attribute only — no proper tooltip component | Medium |
| P6 | Z-index conflicts: mobile drawer (z-50), Modal (z-50), Drawer (z-50) | Medium |
| P7 | No visual indicator for active parent group in nested routes | Medium |
| P8 | Page containers have inconsistent padding/alignment | Medium |
| P9 | ToastProvider nested inside Protected route — should be at app level | Low |
| P10 | Sidebar transition uses `transition-all` — too broad | Low |

---

## C. Root Causes

| Problem | Implementation Cause | Architectural Cause |
|---|---|---|
| P1 | Single `lg` breakpoint used for sidebar visibility | No deliberate tablet strategy defined |
| P2 | Header built independently of sidebar state | No shared layout context/model |
| P3 | Content width hardcoded in AppShell | No central application-shell layout model |
| P4 | Mobile drawer width hardcoded, no `safe-area-inset` | Mobile treated as afterthought |
| P5 | Tooltip not integrated; Radix Tooltip available but unused | Component library available but not applied |
| P6 | All overlays use same z-50 | No z-index scale/tokens defined |
| P7 | Active state only on leaf NavLink | No group-level active tracking |
| P8 | Each page manages own container spacing | No shared PageContainer component |
| P9 | ToastProvider inside Protected wrapper | Provider placement not considered holistically |
| P10 | `transition-all duration-150` on sidebar | No transition tokens/guidelines |

---

## D. Proposed Solution

### 1. Responsive Breakpoint Model
- **Mobile**: < 768px — drawer navigation
- **Tablet**: 768px–1023px — collapsed sidebar (68px) + header adapts
- **Desktop**: ≥ 1024px — expanded sidebar (220px) with collapse toggle

### 2. Central Layout Context
Create `useAppShell` hook/context providing:
- `sidebarState`: 'expanded' | 'collapsed' | 'mobile-open' | 'mobile-closed'
- `sidebarWidth`: computed pixel value
- `headerOffset`: computed for header alignment

### 3. Component Changes
- **AppShell**: Use layout context, add tablet breakpoint, fix content alignment
- **Sidebar**: Add Radix Tooltip for collapsed items, group active state
- **Header**: Consume layout context, show/hide controls appropriately
- **PageContainer**: New shared component for consistent content alignment
- **Z-index**: Define scale in CSS custom properties

### 4. Mobile Drawer Improvements
- Use `max-w-[calc(100vw-16px)]` with safe-area insets
- Proper focus trap and restoration
- Backdrop click handling

### 5. Dark Mode Audit
Verify all new states work in both themes using semantic tokens