// Design tokens for the ElevatorOS SCADA shell.
//
// `T` is a single mutable object shared across the app; `applyThemeTokens` swaps
// its contents at render time (legacy runtime-theming approach). This is being
// migrated onto the CSS-variable tokens in app/globals.css; until that migration
// completes, components read colours from this live object.
//
// The live token object. Populated entirely by the dark Object.assign below
// (the runtime default); applyThemeTokens swaps it to LIGHT_TOKENS when needed.
export const T = {};

// Dark theme (runtime default) — the calm control-room palette.
// Calm "control-room" palette: low-chroma neutrals, one muted steel-teal accent
// (cyan), desaturated semantic colours. No neon. (stage e recolor)
Object.assign(T, {
  bg: "#13181f",
  bg2: "#0f141a",
  surface: "#1b212a",
  surfaceHi: "#222934",
  surfaceLo: "#161b22",
  border: "#2d3641",
  borderHi: "#3c4754",
  text: "#e3e7ee",
  textSub: "#a3acb9",
  textMute: "#6f7886",
  green: "#5bb592",
  greenDim: "rgba(91, 181, 146, 0.13)",
  yellow: "#c7a258",
  yellowDim: "rgba(199, 162, 88, 0.14)",
  red: "#d4756c",
  redDim: "rgba(212, 117, 108, 0.15)",
  blue: "#6c9bce",
  blueDim: "rgba(108, 155, 206, 0.14)",
  cyan: "#5e9cc0",
  cyanDim: "rgba(94, 156, 192, 0.14)",
  purple: "#9b8ecb",
  purpleDim: "rgba(155, 142, 203, 0.14)",
  orange: "#cb8f5e",
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
  green: "#2f8366",
  greenDim: "rgba(47, 131, 102, 0.10)",
  yellow: "#946a26",
  yellowDim: "rgba(148, 106, 38, 0.12)",
  red: "#b04a44",
  redDim: "rgba(176, 74, 68, 0.10)",
  blue: "#3a6aa8",
  blueDim: "rgba(58, 106, 168, 0.10)",
  cyan: "#2c7d99",
  cyanDim: "rgba(44, 125, 153, 0.10)",
  purple: "#6a57a6",
  purpleDim: "rgba(106, 87, 166, 0.10)",
  orange: "#a8603a",
};

export function applyThemeTokens(theme) {
  Object.assign(T, theme === "light" ? LIGHT_TOKENS : DARK_TOKENS);
}
