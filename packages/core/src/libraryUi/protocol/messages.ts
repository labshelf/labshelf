// Declares the library UI protocol: the messages the UI and its host exchange, the data shapes they carry, the guard for untrusted UI messages, and the Details surface's channel envelope with its guard.
import { type ReadingStatus, type FolderTreeNode, type PaperFilesState, PAPER_STATUSES } from "../../library/index.js";
import type { CitationEdge, MissingWork } from "../citationMap/index.js";
import type { Annotation, PaperRecord } from "../../model/index.js";
import type { Backlink } from "../../writing/index.js";
import { isCellLanguage, type CellLanguage, type CellRunState } from "../../qmd/compute/index.js";
import { isBoolean, isCount, isNonEmptyString, isNonEmptyStringList, isString, isStringArray } from "../../guards/index.js";
import { isLibraryPath, isProjectPath } from "../../path/index.js";
import { type AllProjectsToHost, type HostToAllProjects, parseAllProjectsMessage } from "../../writing/allProjects/index.js";
export type { PaperFile, PaperFilesState } from "../../library/index.js";

export type UiToHost =
  | { type: "ready" }
  | { type: "navigate"; folder: string }
  /** Asks the host to open the folder in the paper list, for a surface that does not hold the list itself. */
  | { type: "folder.open"; folder: string }
  | { type: "folder.create"; parent: string; name: string }
  | { type: "folder.rename"; path: string; name: string }
  | { type: "folder.delete"; path: string }
  /** Asks the host to share the folder's papers as a link, with its own notice, progress and result. */
  | { type: "paper.open"; id: string; page?: number }
  | { type: "paper.openExternal"; id: string }
  | { type: "paper.reveal"; id: string }
  | { type: "paper.details"; id: string }
  | { type: "paper.similar"; id: string }
  /** The selection changed; `ids` holds every selected paper and is empty when none is. */
  | { type: "paper.selected"; ids: string[] }
  | { type: "paper.files"; id: string }
  /** `name` is one entry of the paper folder; an empty `description` removes the stored one. */
  | { type: "paper.describeFile"; id: string; name: string; description: string }
  | { type: "paper.openFile"; id: string; name: string }
  | { type: "paper.revealFile"; id: string; name: string }
  | { type: "paper.copyFilePath"; id: string; name: string }
  /** `replace` looks only for a better version than the paper's preprint or accepted PDF, and replaces it when found. */
  | { type: "paper.findPdf"; id: string; replace?: boolean }
  | { type: "paper.attachPdf"; id: string }
  /** Opens the page that stood in the way of the paper's PDF, and attaches the PDF once the user gets through. */
  | { type: "paper.openForPdf"; id: string; access: PdfAccess }
  | { type: "paper.askAuthor"; id: string }
  | { type: "paper.fetchMetadata"; id: string }
  | { type: "paper.makeSearchable"; ids: string[] }
  | { type: "paper.setStatus"; ids: string[]; status: ReadingStatus }
  | { type: "paper.setTags"; ids: string[]; add: string[]; remove: string[] }
  /** Adds a note item to the paper; `body` may be empty or multi-line. */
  | { type: "paper.addNote"; id: string; body: string }
  | { type: "paper.editNote"; id: string; itemId: string; body: string }
  | { type: "paper.removeNote"; id: string; itemId: string }
  /** Asks the host to run one code cell of a note item; the view makes `requestId` and the host echoes it in `paper.cellState`. */
  | { type: "paper.runCell"; id: string; itemId: string; label: string; code: string; language: CellLanguage; requestId: string }
  /** Restarts the `language` process of paper `id`'s notes, dropping what its cells defined. */
  | { type: "paper.restartCell"; id: string; language: CellLanguage }
  | { type: "paper.cancelCell"; requestId: string }
  | { type: "paper.installPython" }
  | { type: "paper.addToSpace"; ids: string[] }
  | { type: "paper.move"; ids: string[]; target: string }
  | { type: "paper.remove"; ids: string[] }
  | { type: "paper.add"; folder: string }
  | { type: "paper.addFrom"; folder: string; sourceId: string; ifNoPdf: MissingPdfAction; retryPdf: boolean }
  | { type: "annotations.export"; id: string }
  | { type: "project.openSource"; project: string; file: string; line: number }
  | { type: "clipboard.write"; text: string; label?: string }
  | { type: "citationMap.refresh" }
  | { type: "citationMap.import"; workId: string; doi: string };

export type HostToUi =
  | { type: "snapshot"; snapshot: LibraryUiSnapshot }
  | { type: "navigate"; folder: string }
  /** Narrows the list to the papers with this tag, as a host's Tags row asks. */
  | { type: "searchTag"; tag: string }
  | { type: "select"; id: string }
  /** Shows the paper wherever it is: opens its folder, clears filters that hide it, selects it and opens its files. */
  | { type: "reveal"; id: string }
  | { type: "files"; id: string; state: PaperFilesState }
  | { type: "notice"; kind: "info" | "ok" | "error"; text: string }
  | { type: "progress"; key: string; text: string | null }
  /** `canRunCells` is true only where the host has a cell runner; absent means false. */
  | { type: "details"; id: string; details: PaperDetails; canRunCells?: boolean }
  | { type: "paper.cellState"; requestId: string; state: CellRunState }
  | { type: "similar"; id: string; items: SimilarPaper[] }
  | { type: "sidecarChanged"; id: string | null }
  | { type: "jobs"; jobs: TextLayerJobView[] }
  | { type: "pdf.busy"; id: string; busy: boolean }
  | { type: "pdf.missing"; id: string }
  | { type: "pdf.findResult"; id: string; miss: PdfMiss }
  | { type: "add.sources"; folder: string; sources: AddSource[] }
  | { type: "add.noPdf"; folder: string; sourceId: string; title: string; miss: PdfMiss }
  /** Opens the citation map view, or updates it while it is open. */
  | { type: "citationMap.show"; state: CitationMapState }
  | { type: "citationMap.imported"; workId: string }
  /** The host has already told the user why with an error `notice`; the UI only clears the row's busy state. */
  | { type: "citationMap.importFailed"; workId: string };

/** What the reader's sidecar says about a paper, for the row marks and the Last read column. */
export interface PaperStats {
  annotations: number;
  lastPage?: number;
  /** ISO timestamp of the last reading position. */
  lastRead?: string;
}

/**
 * The library as the UI renders it. Paths are "/"-separated and start at "papers". `pdfDirs` lists the record paths
 * whose folder holds the paper's PDF; `stats` is keyed by paper id and may leave papers out.
 */
export interface LibraryUiSnapshot {
  folders: FolderTreeNode[];
  papers: PaperRecord[];
  pdfDirs: string[];
  stats: Record<string, PaperStats>;
}

/** One note item of a paper: `anchor` is the text of its anchor attribute, empty when it has none. */
export interface PaperNoteView { id: string; anchor: string; body: string; created: string; author: string }

/** The heavy per-paper data the detail pane asks for when a paper is shown. */
export interface PaperDetails {
  annotations: Annotation[];
  reading: { page: number; updatedAt: string } | null;
  /** The PDF on this device: its size and its path below the library root; null when it is not here. */
  pdf: { size: number; relPath: string } | null;
  /** Where writing projects cite the paper; only hosts that answer `project.openSource` send it. */
  citedIn?: Backlink[];
  /** The paper's note items in file order; absent where the host serves no notes, and the pane is read-only then. */
  notes?: PaperNoteView[];
  /** The host can run code cells of the notes; absent means false. */
  canRunCells?: boolean;
}

/** A paper waiting for, or in the middle of, OCR. */
export interface TextLayerJobView {
  paperId: string;
  phase: "queued" | "reading";
  /** While reading: the 1-based page among `total` pages to read. */
  page?: number;
  total?: number;
}

/** A paper whose content resembles another's; `score` runs from 0 to 1. */
export interface SimilarPaper {
  paperId: string;
  score: number;
}

/** What a PDF search tried before it gave up. */
export interface PdfMiss {
  /** Candidate URLs downloaded and rejected. */
  tried: number;
  /** Resolver ids consulted, in chain order. */
  sources: string[];
  /** At least one candidate answered with a bot check. */
  blocked: boolean;
  /** At least one candidate answered with a login or paywall page. */
  needsLogin: boolean;
  /** The best-ranked page that asked for a sign-in or a bot check, for the user to open; set only by a host with a browser session. */
  access?: PdfAccess;
}

/** A page that stood between LabShelf and a PDF: a sign-in or paywall page, or a bot check the user can pass. */
export interface PdfAccess {
  kind: "login" | "bot";
  url: string;
}

/** Something the host can add a paper from, such as an open browser tab. */
export interface AddSource {
  id: string;
  label: string;
  description: string;
}

/**
 * Whether a capture without a PDF asks first, saves the reference anyway, saves it and opens the miss's access page
 * for the user to sign in or pass the check (attaching the PDF once that page yields it), or saves it and drafts an
 * email asking the authors for a copy.
 */
export type MissingPdfAction = "ask" | "save" | "open" | "author";

/** The citation map as the UI draws it; `papers` names every library paper that a link or a missing work's `citedBy` mentions. */
export interface CitationMapView {
  papers: Array<{ id: string; title: string }>;
  links: CitationEdge[];
  /** Most cited first. */
  missing: MissingWork[];
}

/** What the citation map view shows: the map being built, the map, or why building it failed. */
export type CitationMapState =
  | { status: "loading" }
  | { status: "ready"; map: CitationMapView }
  | { status: "failed"; message: string };

type Raw = Record<string, unknown>;
type FieldCheck = (value: unknown) => boolean;

const isStatus = (v: unknown): v is ReadingStatus => (PAPER_STATUSES as readonly unknown[]).includes(v);
const isPage = (v: unknown): boolean => v === undefined || (typeof v === "number" && Number.isInteger(v) && v > 0);
const isWorkId = (v: unknown): boolean => typeof v === "string" && /^W\d+$/.test(v);
// One entry of a paper folder: a single segment, never "." or "..", never a path.
const isEntryName = (v: unknown): boolean =>
  typeof v === "string" && v !== "" && v !== "." && v !== ".." && !v.includes("/") && !v.includes("\\");
const isDoi = (v: unknown): boolean => typeof v === "string" && /^10\.\d{4,9}\/\S+$/.test(v);

const isWebUrl = (v: unknown): boolean => typeof v === "string" && /^https?:\/\//i.test(v) && URL.canParse(v);
// The page a host opens in a browser tab: only a web address, never a script or extension URL.
const isAccess = (v: unknown): boolean =>
  !!v && typeof v === "object" && ((v as Raw)["kind"] === "login" || (v as Raw)["kind"] === "bot") && isWebUrl((v as Raw)["url"]);

// The fields each message must carry, and how each one is checked.
const SHAPES: Record<UiToHost["type"], Record<string, FieldCheck>> = {
  "ready": {},
  "navigate": { folder: isLibraryPath },
  "folder.open": { folder: isLibraryPath },
  "folder.create": { parent: isLibraryPath, name: isNonEmptyString },
  "folder.rename": { path: isLibraryPath, name: isNonEmptyString },
  "folder.delete": { path: isLibraryPath },
  "paper.open": { id: isNonEmptyString, page: isPage },
  "paper.openExternal": { id: isNonEmptyString },
  "paper.reveal": { id: isNonEmptyString },
  "paper.details": { id: isNonEmptyString },
  "paper.similar": { id: isNonEmptyString },
  "paper.selected": { ids: isNonEmptyStringList },
  "paper.files": { id: isNonEmptyString },
  "paper.describeFile": { id: isNonEmptyString, name: isEntryName, description: isString },
  "paper.openFile": { id: isNonEmptyString, name: isEntryName },
  "paper.revealFile": { id: isNonEmptyString, name: isEntryName },
  "paper.copyFilePath": { id: isNonEmptyString, name: isEntryName },
  "paper.findPdf": { id: isNonEmptyString, replace: (v) => v === undefined || isBoolean(v) },
  "paper.attachPdf": { id: isNonEmptyString },
  "paper.openForPdf": { id: isNonEmptyString, access: isAccess },
  "paper.askAuthor": { id: isNonEmptyString },
  "paper.fetchMetadata": { id: isNonEmptyString },
  "paper.makeSearchable": { ids: isNonEmptyStringList },
  "paper.setStatus": { ids: isNonEmptyStringList, status: isStatus },
  "paper.setTags": { ids: isNonEmptyStringList, add: isStringArray, remove: isStringArray },
  "paper.addNote": { id: isNonEmptyString, body: isString },
  "paper.editNote": { id: isNonEmptyString, itemId: isNonEmptyString, body: isString },
  "paper.removeNote": { id: isNonEmptyString, itemId: isNonEmptyString },
  "paper.runCell": { id: isNonEmptyString, itemId: isNonEmptyString, label: isNonEmptyString, code: isNonEmptyString, language: isCellLanguage, requestId: isNonEmptyString },
  "paper.restartCell": { id: isNonEmptyString, language: isCellLanguage },
  "paper.cancelCell": { requestId: isNonEmptyString },
  "paper.installPython": {},
  "paper.addToSpace": { ids: (v) => isNonEmptyStringList(v) && v.length > 0 },
  "paper.move": { ids: isNonEmptyStringList, target: isLibraryPath },
  "paper.remove": { ids: isNonEmptyStringList },
  "paper.add": { folder: isLibraryPath },
  "paper.addFrom": { folder: isLibraryPath, sourceId: isNonEmptyString, ifNoPdf: (v) => v === "ask" || v === "save" || v === "open" || v === "author", retryPdf: isBoolean },
  "annotations.export": { id: isNonEmptyString },
  "project.openSource": { project: isNonEmptyString, file: isProjectPath, line: isCount },
  "clipboard.write": { text: isString, label: (v) => v === undefined || isString(v) },
  "citationMap.refresh": {},
  "citationMap.import": { workId: isWorkId, doi: isDoi },
};

/** @returns the message when it is one the UI can send with valid fields, else null */
export function parseUiMessage(raw: unknown): UiToHost | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = (raw as Raw)["type"];
  if (typeof type !== "string" || !Object.hasOwn(SHAPES, type)) return null;
  const shape = SHAPES[type as UiToHost["type"]];
  const ok = Object.entries(shape).every(([field, check]) => check((raw as Raw)[field]));
  return ok ? (raw as UiToHost) : null;
}

/** What the Details surface shows: one or more papers, one project, or nothing. */
export type DetailsSelection = { kind: "paper"; ids: string[] } | { kind: "project"; id: string } | null;

export type DetailsToHost =
  | { channel: "library"; msg: UiToHost }
  | { channel: "projects"; msg: AllProjectsToHost };

export type HostToDetails =
  | { channel: "library"; msg: HostToUi }
  | { channel: "projects"; msg: HostToAllProjects }
  | { type: "details.show"; target: DetailsSelection };

/** @returns the message when its channel is known and the wrapped message passes that channel's guard, else null */
export function parseDetailsMessage(raw: unknown): DetailsToHost | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel, msg } = raw as Record<string, unknown>;
  if (channel === "library") {
    const inner = parseUiMessage(msg);
    return inner ? { channel, msg: inner } : null;
  }
  if (channel === "projects") {
    const inner = parseAllProjectsMessage(msg);
    return inner ? { channel, msg: inner } : null;
  }
  return null;
}
