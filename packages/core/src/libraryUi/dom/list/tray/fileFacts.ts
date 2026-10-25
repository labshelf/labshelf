// Turns a paper's record and file listing into the ordered rows of its file tray.
import type { PaperRecord } from "../../../../model/index.js";
import type { PaperFile } from "../../../protocol/index.js";

type TrayKind = "pdf" | "note" | "file" | "folder";
type TypeTone = "pdf" | "md" | "dir" | "other";

export interface TrayEntry {
  kind: TrayKind;
  name: string;
  /** Text of the type cell; empty for a folder, which shows a chevron. */
  type: string;
  tone: TypeTone;
  /** The label is empty when the type and name already say what the fact is, as for the Note. `placeholder` marks the hint shown for an empty short note. */
  fact: { label: string; text: string; placeholder?: true } | null;
  title: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PDF_NAME = "paper.pdf";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Fixed month names and UTC keep the text identical across locales and time zones.
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function tooltip(f: PaperFile): string {
  const date = formatDate(f.modified);
  const parts = [f.kind === "file" && f.size !== undefined ? formatSize(f.size) : "", date ? `modified ${date}` : ""];
  return parts.filter(Boolean).join(" · ");
}

function typeOf(f: PaperFile): Pick<TrayEntry, "type" | "tone"> {
  if (f.kind === "folder") return { type: "", tone: "dir" };
  const ext = f.name.includes(".") ? f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ext === "pdf") return { type: "PDF", tone: "pdf" };
  if (ext === "md") return { type: "MD", tone: "md" };
  return { type: ext ? ext.toUpperCase() : "FILE", tone: "other" };
}

export const SHORT_NOTE_PLACEHOLDER = "Add a short note";

// The paper.pdf row carries the user's short description of the paper, which identifies it in the list.
function pdfFact(f: PaperFile): TrayEntry["fact"] {
  return f.description ? { label: "", text: f.description } : { label: "", text: SHORT_NOTE_PLACEHOLDER, placeholder: true };
}

function fileFact(f: PaperFile): TrayEntry["fact"] {
  return f.description ? { label: f.kind === "folder" ? "Source" : "Contents", text: f.description } : null;
}

function noteEntry(record: PaperRecord): TrayEntry {
  const first = record.note?.split("\n").map((l) => l.trim()).find(Boolean);
  return { kind: "note", name: "Note", type: "MD", tone: "md", fact: { label: "", text: first ?? "Empty" }, title: "" };
}

/** The tray rows in display order: paper.pdf, the Note, other files, then subfolders. */
export function trayEntries(record: PaperRecord, listed: readonly PaperFile[]): TrayEntry[] {
  const shown = listed.filter((f) => f.name !== "metadata.yaml");
  const toEntry = (f: PaperFile): TrayEntry => {
    const isPdf = f.kind === "file" && f.name === PDF_NAME;
    return { kind: isPdf ? "pdf" : f.kind, name: f.name, ...typeOf(f), fact: isPdf ? pdfFact(f) : fileFact(f), title: tooltip(f) };
  };
  const pdf = shown.filter((f) => f.kind === "file" && f.name === PDF_NAME).map(toEntry);
  const rest = shown.filter((f) => !(f.kind === "file" && f.name === PDF_NAME)).map(toEntry);
  return [...pdf, noteEntry(record), ...rest];
}
