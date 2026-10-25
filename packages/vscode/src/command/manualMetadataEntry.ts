// Collects a paper's record from the user field by field, for work no registry indexes.
// Unpublished manuscripts, internal reports, theses and lecture notes end up here.
import * as vscode from "vscode";

import { extractDoi } from "@labshelf/core";
import type { PaperRecord, ResolvedMetadata } from "@labshelf/core";
import type { PaperService } from "../library/index.js";

interface ManualFields {
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
  keywords: string;
}

/**
 * Collects the record by hand. The genuine last resort, for work no registry
 * indexes: unpublished manuscripts, internal reports, theses, lecture notes.
 * @returns The updated paper, or undefined when the user cancelled.
 */
export async function askMetadataManually(
  paperService: PaperService,
  paper: PaperRecord,
  titleHint?: string,
): Promise<PaperRecord | undefined> {
  const fields = await askManualFields(paper, titleHint);
  if (!fields) {
    return undefined;
  }

  const updated = await paperService.applyResolvedMetadata(paper.id, manualMetadata(fields));
  if (updated) {
    await vscode.window.showInformationMessage(`LabShelf: saved "${formatTruncated(updated.title, 70)}".`);
  }
  return updated;
}

export function formatTruncated(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

async function askManualFields(paper: PaperRecord, titleHint: string | undefined): Promise<ManualFields | undefined> {
  const ask = async (
    field: string,
    prompt: string,
    value: string | undefined,
    step: number,
  ): Promise<string | undefined> =>
    vscode.window.showInputBox({
      title: `Paper details (${step}/6) — ${field}`,
      prompt,
      value: value ?? "",
      ignoreFocusOut: true,
    });

  // The title is the only field worth refusing to continue without.
  const title = await ask("Title", "Title of the paper", titleHint ?? paper.title, 1);
  if (title === undefined || !title.trim()) {
    return undefined;
  }

  const authors = await ask("Authors", "Authors, separated by ';'", paper.authors?.join("; "), 2);
  if (authors === undefined) {
    return undefined;
  }
  const year = await ask("Year", "Publication year", paper.year ? String(paper.year) : undefined, 3);
  if (year === undefined) {
    return undefined;
  }
  const journal = await ask("Journal", "Journal, conference, or publisher", paper.journal, 4);
  if (journal === undefined) {
    return undefined;
  }
  const doi = await ask("DOI", "DOI or URL (optional)", paper.doi, 5);
  if (doi === undefined) {
    return undefined;
  }
  const keywords = await ask("Keywords", "Keywords, separated by ',' (optional)", paper.keywords?.join(", "), 6);
  if (keywords === undefined) {
    return undefined;
  }
  return { title, authors, year, journal, doi, keywords };
}

function manualMetadata(fields: ManualFields): ResolvedMetadata {
  const { title, authors, year, journal, doi, keywords } = fields;
  const parsedYear = Number.parseInt(year.trim(), 10);
  return {
    title: title.trim(),
    ...(authors.trim() ? { authors: splitList(authors, ";") } : {}),
    ...(Number.isFinite(parsedYear) ? { year: parsedYear } : {}),
    ...(journal.trim() ? { journal: journal.trim() } : {}),
    ...(doi.trim() ? doiOrUrl(doi.trim()) : {}),
    ...(keywords.trim() ? { keywords: splitList(keywords, ",") } : {}),
  };
}

function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Accepts either form in the DOI box, since users paste whichever they have.
function doiOrUrl(value: string): ResolvedMetadata {
  const doi = extractDoi(value);
  if (doi) {
    return { doi, url: `https://doi.org/${doi}` };
  }
  return /^https?:\/\//i.test(value) ? { url: value } : {};
}
