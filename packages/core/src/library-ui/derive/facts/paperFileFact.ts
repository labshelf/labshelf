// Derives the one-line fact beside a file or subfolder in a paper's tray.
import type { PaperRecord } from "../../../model/index.js";
import type { PaperFile, PaperStats } from "../../protocol/index.js";
import { firstSentence } from "./firstSentence.js";

const PAPER_PDF = "paper.pdf";

export function paperFileFact(record: PaperRecord, stats: PaperStats | undefined, file: PaperFile): string {
  if (file.name !== PAPER_PDF || file.kind !== "file") return file.description ?? "";
  if (stats?.lastHighlight) return `p. ${stats.lastHighlight.page} · ${stats.lastHighlight.text}`;
  return firstSentence(record.summary ?? "");
}
