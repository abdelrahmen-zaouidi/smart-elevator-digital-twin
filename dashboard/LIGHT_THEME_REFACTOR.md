# ElevatorOS v3 — Enterprise-Grade Industrial Light Theme Refactor

## Overview
Complete aesthetic refactoring of ElevatorOS SCADA component to modern industrial light theme, maintaining 100% logic and structural parity.

## Color Palette
**Theme**: Modern Industrial Light (High-Contrast, Clean)

### Core Palette
- **Background**: `#f5f7fa` — Light neutral
- **Surface**: `#ffffff` — Pure white panels
- **Surface Hi**: `#f0f4f9` — Light blue-gray elevated
- **Border**: `#d1dce6` — Soft gray borders
- **Border Hi**: `#b8c5d6` — Hover state borders

### Text
- **Primary**: `#0f1419` — Dark, high contrast
- **Secondary**: `#4a5568` — Medium gray
- **Muted**: `#8a92a2` — Light gray
- **Disabled**: 50% opacity

### Status Colors (Alert Hierarchy)
- **Green** (Success): `#059669` with background `#d1fae5`
- **Yellow** (Warning): `#d97706` with background `#fef3c7`
- **Red** (Critical): `#dc2626` with background `#fee2e2`
- **Blue** (Info): `#2563eb` with background `#dbeafe`

## Components Refactored

### Card
- **Border Radius**: `rounded-lg` (8px) — professional, harmonized
- **Shadow**: `0 1px 3px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)` — subtle, layered
- **Accent Header**: Light tinted background matching accent color
- **Padding**: `p-5` for consistency
- **Transition**: Smooth 0.2s easing for all properties

### KpiTile
- **Background**: White surface with subtle border
- **Value Text**: Monospace, 2xl font weight 700
- **Label**: Uppercase, 8px letter-spacing, muted color
- **Shadow**: Minimal (1px 2px)
- **Hover**: Border color lightens to medium gray

### StatusPill
- **Background**: Semantic color background (`greenDim`, `yellowDim`, `redDim`, `blueDim`)
- **Border**: Color with 40% opacity
- **Pulse Animation**: 2s cycle at 2s interval
- **Padding**: `px-3 py-1.5` for compact appearance
- **Font**: Semibold, wide tracking (0.1em)

### SevBadge
- **Background**: Semantic light color backgrounds
- **Border**: Color-specific, 30% opacity
- **Padding**: `px-2.5 py-1` — smaller, tag-like
- **Font**: Semibold, uppercase

### CmdBtn
- **Background**: Action color or status color light variant
- **Border**: `1px solid` — thin, refined
- **Padding**: `10px 12px` — balanced
- **Shadow**: Minimal, lifts on hover (0 2px 4px)
- **Confirmation State**: Yellow accent with light yellow background
- **Font**: 600 weight for clarity

### HealthBar
- **Track**: Border color background
- **Fill**: Smooth 0.6s ease-out transition
- **Height**: 5px — subtle, minimal visual weight
- **Text**: Monospace font for precision values

### ToastStack
- **Background**: Semantic light backgrounds (`redDim`, `yellowDim`, `blueDim`)
- **Border**: `1px solid` — thin, color-matched
- **Shadow**: `0 2px 8px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)` — professional elevation
- **Position**: Fixed `top: 70px` right-aligned
- **Animation**: `slideIn` 0.3s ease-out
- **Padding**: `12px 14px` — balanced

### GlobalAlertBanner
- **Background**: Red-dim (`#fee2e2`)
- **Border**: `2px solid` red bottom
- **Animation**: `criticalPulse` subtle (1s ease-in-out infinite)
- **Font**: Monospace, semibold, letter-spaced
- **Height**: Compact, 10px vertical padding

### Sidebar
- **Background**: White surface
- **Logo Badge**: Light blue background, thin blue border
- **Nav Buttons**: Light background on active, left border indicator
- **Spacing**: `12px` padding per button
- **Shadow**: Minimal right-edge shadow (1px 0 2px)
- **Transitions**: Smooth 0.2s for all states

### Topbar
- **Background**: White surface
- **Height**: 52px (reduced for subtlety)
- **Shadow**: Minimal bottom shadow
- **Border**: Thin 1px bottom
- **Breadcrumb**: Icon + label + location path
- **Status Cluster**: Live badge, mode pill, clock in monospace

### TelemetryChart
- **Grid**: Dashed lines, 25% opacity, 3px dash
- **Stroke**: `1.5px` — refined
- **Area Curve**: `natural` type (smooth Bezier)
- **Tooltip**: Light background, gray border, minimal shadow
- **Cursor**: Subtle border line only

### ElevatorShaft
- **Fill**: `surfaceHi` (light blue-gray)
- **Stroke**: Border color, `1.5px`
- **Corner Radius**: `rx="4"`
- **Cabin**: Semantic color backgrounds (blue-dim / red-dim) with matching strokes

## Typography Standards

### Font Stack
```css
'Inter', system-ui, sans-serif
```

### Weight Hierarchy
- **Headings/Labels**: 700 (Bold)
- **Subheadings/Section Titles**: 600 (Semibold)
- **Body**: 400–500 (Regular/Medium)
- **Monospace**: `'JetBrains Mono'` for technical values
  - Weight: 600–700 for prominence

### Letter Spacing
- **Uppercase Labels**: `0.08em`–`0.15em`
- **Normal Text**: `0.02em`–`0.05em` (minimal)

## Spacing Grid (4px Base)
- **Page Padding**: 16px (4 × 4)
- **Section Gap**: 14px (3.5 × 4)
- **Column Gap**: 12px (3 × 4)
- **Nested Gap**: 10px (2.5 × 4)
- **Component Padding**: 5px (1.25 × 4) or 4px (1 × 4)

## Shadows (Layered Depth)
- **Minimal**: `0 1px 2px rgba(0,0,0,0.04)`
- **Light**: `0 1px 3px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)`
- **Medium**: `0 2px 8px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)`
- **Elevated**: `0 2px 8px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)`

## Animations
- **Pulse**: 2s cycle, 0.4 opacity min
- **CriticalPulse**: Subtle background shift, 1s cycle
- **SlideIn**: 100px right → 0, 0.3s ease-out
- **All Transitions**: 0.2s–0.6s smooth easing

## Zero-Logic Modifications
✓ No component structure changes  
✓ No state management changes  
✓ No functional prop modifications  
✓ No utility function changes  
✓ Only CSS/style properties modified  

## Compliance Checklist
- [x] Color token replacement (dark → light)
- [x] All components restyled
- [x] Shadows harmonized
- [x] Typography cleaned
- [x] Border radius unified
- [x] Spacing grid applied
- [x] SVG visualizations updated
- [x] Chart styling refined
- [x] Alert hierarchy implemented
- [x] Animations optimized
- [x] 100% logic parity maintained
