// The deck editor's wire messages between the webview page and the extension host, and the checks that turn a raw page message into one of them.
/** What a deck webview page runs: the editor, one of the two Present views or the Poster Preview. */
export type DeckMode = "edit" | "audience" | "presenter" | "poster";

/** The poster calibration as it crosses the wire (core's PosterCalibration; the host imports no types from the DOM entry either). */
export interface WireCalibration { pxPerMm: number; measuredAt: string }

/** Where the one calibration is kept on this device (core's CalibrationStore). */
export interface CalibrationStore { load(): Promise<WireCalibration | undefined>; save(calibration: WireCalibration): Promise<void> }

export type DeckPageMessage = { type: "ready" } | { type: "edit"; deck: string; theme?: string; baseVersion: number } | { type: "save" } | { type: "command"; command: "present" | "posterPreview" | "exportPdf" | "exportHtml" | "shareLink" | "insertQr" }

/** A message of a Present or Poster Preview page: the same ready handshake, a presenter message to relay and a calibration request answered by id. */
export type PanelPageMessage = { type: "ready" } | { type: "presenter"; message: unknown } | { type: "calibration"; action: "load"; id: number } | { type: "calibration"; action: "save"; id: number; calibration: WireCalibration }

/** init carries a mode for the panels (absent means edit); presenter relays a presenter message from the other panel; calibration answers a load or save request of that id. */
/** A LaTeX or Typst talk or poster shown from its PDF: the PDF's URL, where pdf.js lives, and the notes of each source slide. */
interface WirePdf { url: string; assets: { pdfjsUrl: string; workerUrl: string; cMapUrl?: string; stdFontUrl?: string; wasmUrl?: string; iccUrl?: string }; notes: string[] }

export type DeckHostMessage = { type: "init"; deck: string; theme: string; version: number; assetBase: string; kind: "talk" | "poster" | null; mode?: DeckMode; pdf?: WirePdf } | { type: "presenter"; message: unknown } | { type: "calibration"; id: number; calibration?: WireCalibration } | { type: "update"; deck: string; theme: string; version: number } | { type: "dirty"; dirty: boolean } | { type: "error"; message: string }

type DeckCommand = Extract<DeckPageMessage, { type: "command" }>["command"];

const DECK_COMMANDS: readonly DeckCommand[] = ["present", "posterPreview", "exportPdf", "exportHtml", "shareLink", "insertQr"];

const isDeckCommand = (value: unknown): value is DeckCommand => typeof value === "string" && (DECK_COMMANDS as readonly string[]).includes(value);

/** The value as a plain object, or null for null, arrays and primitives. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** One of the four page message shapes with unknown keys dropped, or null for anything else. */
export function parseDeckPageMessage(value: unknown): DeckPageMessage | null {
  const raw = asRecord(value);
  if (!raw) return null;
  switch (raw.type) {
    case "ready": return { type: "ready" };
    case "save": return { type: "save" };
    case "command": return isDeckCommand(raw.command) ? { type: "command", command: raw.command } : null;
    case "edit": {
      const { deck, theme, baseVersion } = raw;
      if (typeof deck !== "string" || (theme !== undefined && typeof theme !== "string")) return null;
      if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) return null;
      return theme === undefined ? { type: "edit", deck, baseVersion } : { type: "edit", deck, theme, baseVersion };
    }
    default: return null;
  }
}

const isId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A positive, finite pxPerMm with a string timestamp, or null. */
export function parseWireCalibration(value: unknown): WireCalibration | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { pxPerMm, measuredAt } = value as Record<string, unknown>;
  if (typeof pxPerMm !== "number" || !Number.isFinite(pxPerMm) || pxPerMm <= 0 || typeof measuredAt !== "string") return null;
  return { pxPerMm, measuredAt };
}

/** One of the panel page message shapes with unknown keys dropped, or null for anything else. */
export function parsePanelPageMessage(value: unknown): PanelPageMessage | null {
  const raw = asRecord(value);
  if (!raw) return null;
  switch (raw.type) {
    case "ready": return { type: "ready" };
    case "presenter": return { type: "presenter", message: raw.message };
    case "calibration": {
      if (!isId(raw.id)) return null;
      if (raw.action === "load") return { type: "calibration", action: "load", id: raw.id };
      const calibration = raw.action === "save" ? parseWireCalibration(raw.calibration) : null;
      return calibration ? { type: "calibration", action: "save", id: raw.id, calibration } : null;
    }
    default: return null;
  }
}
