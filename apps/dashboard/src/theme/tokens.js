// Design tokens for the ElevatorOS SCADA shell.
//
// `T` is a single mutable object shared across the app; `applyThemeTokens` swaps
// its contents at render time (legacy runtime-theming approach). This is being
// migrated onto the CSS-variable tokens in app/globals.css; until that migration
// completes, components read colours from this live object.
//
// NOTE: the first `T = {...}` block is immediately overwritten by the Object.assign
// below. It is preserved verbatim here (move-then-refactor) and slated for removal
// in the dead-code stage.

export const T = {
  bg:        "#050a12",
  surface:   "#ffffff",   // Pure white - panel background
  surfaceHi: "#f0f4f9",   // Light blue-gray - elevated panel
  border:    "#d1dce6",   // Soft gray border
  borderHi:  "#b8c5d6",   // Darker border for hover
  text:      "#0f1419",   // Dark text - primary
  textSub:   "#4a5568",   // Medium gray - secondary
  textMute:  "#8a92a2",   // Light gray - muted
  green:     "#059669",   // Emerald for success
  greenDim:  "#d1fae5",   // Light emerald background
  yellow:    "#d97706",   // Amber for warning
  yellowDim: "#fef3c7",   // Light amber background
  red:       "#dc2626",   // Red for critical
  redDim:    "#fee2e2",   // Light red background
  blue:      "#2563eb",   // Blue for info
  blueDim:   "#dbeafe",   // Light blue background
  cyan:      "#0891b2",   // Cyan accent
  purple:    "#7c3aed",   // Purple accent
};

// Dark theme (runtime default) overrides every token above.
Object.assign(T, {
  bg: "#050a12",
  bg2: "#08111f",
  surface: "#0d1626",
  surfaceHi: "#111f33",
  surfaceLo: "#07101d",
  border: "#1f334a",
  borderHi: "#2f526f",
  text: "#e6edf7",
  textSub: "#aab7c7",
  textMute: "#65758a",
  green: "#34d399",
  greenDim: "rgba(16, 185, 129, 0.13)",
  yellow: "#f59e0b",
  yellowDim: "rgba(245, 158, 11, 0.14)",
  red: "#f87171",
  redDim: "rgba(248, 113, 113, 0.15)",
  blue: "#60a5fa",
  blueDim: "rgba(96, 165, 250, 0.14)",
  cyan: "#22d3ee",
  cyanDim: "rgba(34, 211, 238, 0.13)",
  purple: "#c084fc",
  purpleDim: "rgba(192, 132, 252, 0.14)",
  orange: "#fb923c",
});

const DARK_TOKENS = { ...T };
const LIGHT_TOKENS = {
  bg: "#f5f8fb",
  bg2: "#eaf1f8",
  surface: "#ffffff",
  surfaceHi: "#eef4fa",
  surfaceLo: "#f8fbfe",
  border: "#d6e1ec",
  borderHi: "#b9c8d8",
  text: "#0f172a",
  textSub: "#334155",
  textMute: "#64748b",
  green: "#047857",
  greenDim: "rgba(4, 120, 87, 0.10)",
  yellow: "#b45309",
  yellowDim: "rgba(180, 83, 9, 0.12)",
  red: "#b91c1c",
  redDim: "rgba(185, 28, 28, 0.10)",
  blue: "#1d4ed8",
  blueDim: "rgba(29, 78, 216, 0.10)",
  cyan: "#0e7490",
  cyanDim: "rgba(14, 116, 144, 0.10)",
  purple: "#7c3aed",
  purpleDim: "rgba(124, 58, 237, 0.10)",
  orange: "#c2410c",
};

export function applyThemeTokens(theme) {
  Object.assign(T, theme === "light" ? LIGHT_TOKENS : DARK_TOKENS);
}
