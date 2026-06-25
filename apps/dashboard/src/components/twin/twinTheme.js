'use client';

// Material palette for the 3D digital twin.
//
// three.js cannot parse the oklch() CSS variables in app/globals.css, so the
// scene uses this hex palette tuned to mirror the calm `--twin-*` token intent
// (low-chroma, control-room, no neon). Dark is the control-room default; the
// light variant keeps parity. Status colours are reserved for state/meaning only.

export const TWIN_DARK = {
  bg:            "#161b22",
  shaft:         "#2b323d",
  shaftEdge:     "#3a4555",
  grid:          "#3f4855",
  floor:         "#262d38",
  rail:          "#5e6776",
  cabin:         "#5f86b3",
  cabinEdge:     "#7aa0c9",
  cabinEstop:    "#c0564e",
  door:          "#3c4757",
  motor:         "#868d99",
  motorHot:      "#c98a52",
  sheave:        "#9aa1ad",
  rope:          "#7b8290",
  ropeWarn:      "#c9a24e",
  counterweight: "#585f6e",
  accent:        "#5f86b3",
  ok:            "#5fb389",
  warn:          "#c9a24e",
  crit:          "#d06b62",
  idle:          "#7b8290",
  label:         "#cdd5e0",
};

export const TWIN_LIGHT = {
  bg:            "#e9eef4",
  shaft:         "#d4dde7",
  shaftEdge:     "#bccada",
  grid:          "#c2cdda",
  floor:         "#dde4ec",
  rail:          "#9aa6b6",
  cabin:         "#5a82ad",
  cabinEdge:     "#3f648c",
  cabinEstop:    "#b3463d",
  door:          "#b7c3d2",
  motor:         "#7d8794",
  motorHot:      "#bd7b40",
  sheave:        "#8c95a3",
  rope:          "#8b93a1",
  ropeWarn:      "#b88f3c",
  counterweight: "#7a8290",
  accent:        "#3f648c",
  ok:            "#3f8f6b",
  warn:          "#9a7322",
  crit:          "#b3463d",
  idle:          "#8b93a1",
  label:         "#2a3340",
};

// Pick palette from the active next-themes class on <html>. Defaults to dark
// (the control-room default) on the server / before mount.
export function readTwinPalette() {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("light")) {
    return TWIN_LIGHT;
  }
  return TWIN_DARK;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
