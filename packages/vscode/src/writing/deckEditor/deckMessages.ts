// The deck editor's wire messages between the webview page and the extension host, and the checks that turn a raw page message into one of them.
import type { DeckTemplateChoice, DeckTemplateGalleryInit } from "@labshelf/core";
import type { WireKitImage } from "../sourceEditor/index.js";

/** What a deck webview page runs: the editor, one of the two Present views or the Poster Preview. */
export type DeckMode = "edit" | "audience" | "presenter" | "poster";

/** The poster calibration as it crosses the wire (core's PosterCalibration; the host imports no types from the DOM entry either). */
export interface WireCalibration { pxPerMm: number; measuredAt: string }

/** Where the one calibration is kept on this device (core's CalibrationStore). */
export interface CalibrationStore { load(): Promise<WireCalibration | undefined>; save(calibration: WireCalibration): Promise<void> }

/** A request of the Style panel's Kits section; the host answers with a kitsResult of the same id. */
export type DeckKitsMessage = { type: "kits"; id: number; request: "list" } | { type: "kits"; id: number; request: "save"; kit: Record<string, unknown>; logo?: WireKitImage } | { type: "kits"; id: number; request: "pickImage" }

export type DeckPageMessage = DeckKitsMessage | { type: "ready" } | { type: "pickImage"; id: number } | { type: "edit"; deck: string; theme?: string; baseVersion: number } | { type: "save" } | { type: "command"; command: "present" | "posterPreview" | "exportPdf" | "exportHtml" | "shareLink" | "insertQr" | "undo" | "redo" }

/** A message of a Present or Poster Preview page: the same ready handshake, a presenter message to relay and a calibration request answered by id. */
export type PanelPageMessage = { type: "ready" } | { type: "presenter"; message: unknown } | { type: "calibration"; action: "load"; id: number } | { type: "calibration"; action: "save"; id: number; calibration: WireCalibration }

/** A message of the New talk or poster page: the ready handshake, the chosen template, or cancel. */
export type NewDeckPageMessage = { type: "ready" } | { type: "create"; choice: DeckTemplateChoice } | { type: "cancel" }

/** The host's answer to the New talk or poster page's ready: the gallery's kind, formats and Kits. */
export type NewDeckHostMessage = { type: "init"; init: DeckTemplateGalleryInit }

/** init carries a mode for the panels (absent means edit); presenter relays a presenter message from the other panel; calibration answers a load or save request of that id. */
/**
 * A LaTeX talk or poster shown from its PDF: the PDF's URL, where pdf.js lives, the notes of each source slide and, when the build left a
 * page map, each page's slide (readTalkPages; -1 for none).
 */
interface WirePdf { url: string; assets: { pdfjsUrl: string; workerUrl: string; cMapUrl?: string; stdFontUrl?: string; wasmUrl?: string; iccUrl?: string }; notes: string[]; slideOfPage?: number[] }

export type DeckHostMessage = { type: "init"; deck: string; theme: string; version: number; assetBase: string; kind: "talk" | "poster" | null; title?: string; mode?: DeckMode; pdf?: WirePdf } | { type: "presenter"; message: unknown } | { type: "calibration"; id: number; calibration?: WireCalibration } | { type: "update"; deck: string; theme: string; version: number } | { type: "dirty"; dirty: boolean } | { type: "pickedImage"; id: number; path?: string } | { type: "kitsResult"; id: number; ok: true; value: unknown } | { type: "kitsResult"; id: number; ok: false; error: string } | { type: "error"; message: string }

type DeckCommand = Extract<DeckPageMessage, { type: "command" }>["command"];

const DECK_COMMANDS: readonly DeckCommand[] = ["present", "posterPreview", "exportPdf", "exportHtml", "shareLink", "insertQr", "undo", "redo"];

const isDeckCommand = (value: unknown): value is DeckCommand => typeof value === "string" && (DECK_COMMANDS as readonly string[]).includes(value);

/** The value as a plain object, or null for null, arrays and primitives. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A {name, base64} image with unknown keys dropped, or null. */
function parseWireKitImage(value: unknown): WireKitImage | null {
  const raw = asRecord(value);
  return raw && typeof raw.name === "string" && typeof raw.base64 === "string" ? { name: raw.name, base64: raw.base64 } : null;
}

/** A kits list, save or pickImage request; a save needs a kit object and, when it names a logo, a valid one. */
function parseKitsMessage(raw: Record<string, unknown>): DeckKitsMessage | null {
  const { id, request } = raw;
  if (!isId(id)) return null;
  if (request === "list" || request === "pickImage") return { type: "kits", id, request };
  const kit = request === "save" ? asRecord(raw.kit) : null;
  if (!kit) return null;
  if (raw.logo === undefined) return { type: "kits", id, request: "save", kit };
  const logo = parseWireKitImage(raw.logo);
  return logo && { type: "kits", id, request: "save", kit, logo };
}

/** One of the page message shapes with unknown keys dropped, or null for anything else. */
export function parseDeckPageMessage(value: unknown): DeckPageMessage | null {
  const raw = asRecord(value);
  if (!raw) return null;
  switch (raw.type) {
    case "ready": return { type: "ready" };
    case "save": return { type: "save" };
    case "pickImage": return isId(raw.id) ? { type: "pickImage", id: raw.id } : null;
    case "kits": return parseKitsMessage(raw);
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
