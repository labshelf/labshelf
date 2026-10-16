// Turns a paper's record, reading stats and file listing into the ordered rows of its file tray.
import type { PaperRecord } from "../../../../model/index.js";
import type { PaperFile, PaperStats } from "../../../protocol/index.js";

type TrayKind = "pdf" | "note" | "file" | "folder";
type TypeTone = "pdf" | "md" | "dir" | "other";

export interface TrayEntry {
  kind: TrayKind;
  name: string;
  /** Text of the type cell; empty for a folder, which shows a chevron. */
  type: string;
  tone: TypeTone;
  /** The label is empty when the type and name already say what the fact is, as for the Note. */
  fact: { label: string; text: string } | null;
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

function pdfFact(record: PaperRecord, stats: PaperStats | undefined): TrayEntry["fact"] {
  const last = stats?.lastHighlight;
  if (last) return { label: `Last highlight · p. ${last.page}`, text: `“${last.text}”` };
  const first = record.summary?.trim().split(/(?<=[.!?])\s/)[0];
  return first ? { label: "Abstract", text: first } : null;
}

function fileFact(f: PaperFile): TrayEntry["fact"] {
  return f.description ? { label: f.kind === "folder" ? "Source" : "Contents", text: f.description } : null;
}

function noteEntry(record: PaperRecord): TrayEntry {
  const first = record.note?.split("\n").map((l) => l.trim()).find(Boolean);
  return { kind: "note", name: "Note", type: "MD", tone: "md", fact: { label: "", text: first ?? "Empty" }, title: "" };
}

/** The tray rows in display order: paper.pdf, the Note, other files, then subfolders. */
export function trayEntries(record: PaperRecord, stats: PaperStats | undefined, listed: readonly PaperFile[]): TrayEntry[] {
  const shown = listed.filter((f) => f.name !== "metadata.yaml");
  const toEntry = (f: PaperFile): TrayEntry => {
    const isPdf = f.kind === "file" && f.name === PDF_NAME;
    return { kind: isPdf ? "pdf" : f.kind, name: f.name, ...typeOf(f), fact: isPdf ? pdfFact(record, stats) : fileFact(f), title: tooltip(f) };
  };
  const pdf = shown.filter((f) => f.kind === "file" && f.name === PDF_NAME).map(toEntry);
  const rest = shown.filter((f) => !(f.kind === "file" && f.name === PDF_NAME)).map(toEntry);
  return [...pdf, noteEntry(record), ...rest];
}
