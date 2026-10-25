// Declares what the All projects detail pane shows for one project, independent of where the host stores it.
import type { BuildMark } from "./projectRow.js";

export interface ProjectBuildSummary extends BuildMark {
  warnings: number;
  errors: number;
  /** The first problem the last build reported. */
  first?: { message: string; file?: string; line?: number };
}

/** A count against its limit; `limit` is absent when the project sets none. */
export interface CountedLimit {
  counted: number;
  limit?: number;
}

export interface ProjectCitation {
  key: string;
  /** Where the key resolves: a library paper, an entry of the project's bibliography, or nowhere. */
  source: "library" | "bib" | "none";
  paperId?: string;
  title?: string;
  authors?: string;
  year?: string;
}

export interface ProjectDetail {
  id: string;
  /** Absolute project folder. */
  location: string;
  /** The LaTeX engine, or "Typst <version>". */
  engine?: string;
  /** Pages of the last PDF. */
  pages?: number;
  limits: { countUpTo: "references" | "end"; pages?: CountedLimit; words?: CountedLimit };
  build: ProjectBuildSummary;
  /** Name of the last LaTeX log file when it exists, such as "main.log". */
  log?: string;
  bibliography?: { file: string; entries: number; generated: boolean; written?: number };
  /** In key order. */
  citations: ProjectCitation[];
  /** Newest first. */
  versions: { name: string; created: string }[];
  /** Project-relative includes, main first. */
  sources: string[];
}
