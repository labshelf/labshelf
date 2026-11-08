// The generic deck shell (D8): header, insert bar, status bar, zoom bar, key map, layout and Style panel, shared by every deck format.
export { createShellHeader } from "./header.js";
export { createInsertBar, shellButton } from "./insertBar.js";
export { createShellStatus } from "./statusBar.js";
export { createZoomBar } from "./zoomBar.js";
export { bindShellKeys } from "./keys.js";
export { createMinimap, fitRectZoom, type MinimapPort } from "./minimap.js";
export { mountDeckShell } from "./layout.js";
export { DECK_STYLE_PRESETS, mountStylePanel, styleCandidates, type DeckStylePort, type DeckStylePreset, type DeckStylePreview } from "./style/index.js";
export type {
  DeckShell, DeckShellMode, DeckShellParts, InsertItem, ShellHeader, ShellHeaderSpec, ShellKeyActions, ShellStatus, ShellStatusParts,
  ShellRect, ShellTool, ShellZoomBar, ShellZoomSurface, ShellZoomTarget,
} from "./types.js";
