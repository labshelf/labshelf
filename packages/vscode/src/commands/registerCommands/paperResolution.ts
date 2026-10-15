// Shared "find or guard a paper" helpers every command-registration group calls.
import * as vscode from "vscode";

import { type PaperRecord, type PaperStatus, isSafeExternalUrl, paperLink } from "@labshelf/core";
import type { PaperService } from "../../core/index.js";
import type { ActiveServices } from "./types.js";

const LOG_MODULE = "commands/registerCommands";

/**
 * Guards every "open the PDF" entry point. When the paper has no paper.pdf it
 * reconciles the possibly stale flag, warns the user immediately (the VS Code
 * form of the "instant popup" asked for), offers the article page when a DOI or
 * URL is known, and returns false so the caller opens nothing.
 * @returns true when the PDF is present and the reader may open
 */
export async function ensurePaperPdf(services: ActiveServices, paper: PaperRecord): Promise<boolean> {
  const reconciled = await services.paperService.reconcilePdf(paper.id);
  const current = reconciled?.paper ?? paper;
  const hasPdf = reconciled ? reconciled.hasPdf : paper.hasPdf !== false;
  if (hasPdf) {
    return true;
  }
  await services.logger.log("INFO", LOG_MODULE, "Paper has no PDF; reader not opened", { paperId: current.id });
  const link = articleLink(current);
  const choice = await vscode.window.showWarningMessage(
    `LabShelf: "${current.title}" has no PDF yet.`,
    ...(link ? ["Open Link"] : []),
  );
  if (choice === "Open Link" && link) {
    await vscode.env.openExternal(vscode.Uri.parse(link));
  }
  return false;
}

// The article's own page: its DOI resolver first, else a stored http(s) URL.
// Only safe web schemes are offered, so a hand-edited record cannot smuggle a
// file: or command: link into an openExternal call.
function articleLink(paper: PaperRecord): string | undefined {
  const candidate = paperLink(paper);
  return candidate && isSafeExternalUrl(candidate) ? candidate : undefined;
}

/** Returns the paper matching paperId if given, or presents a quick-pick for the user to choose from */
export async function resolvePaper(
  paperService: PaperService,
  paperId: string | undefined,
  placeholder: string,
): Promise<PaperRecord | undefined> {
  const papers = await paperService.listPapers();
  if (papers.length === 0) {
    await vscode.window.showInformationMessage("LabShelf library is empty.");
    return undefined;
  }

  if (paperId) {
    const direct = papers.find((paper) => paper.id === paperId);
    if (direct) {
      return direct;
    }
  }

  return pickFrom(papers, placeholder);
}

// Lists all papers and presents a quick-pick with the given placeholder label.
export async function pickPaper(paperService: PaperService, placeholder: string): Promise<PaperRecord | undefined> {
  const papers = await paperService.listPapers();
  if (papers.length === 0) {
    await vscode.window.showInformationMessage("LabShelf library is empty.");
    return undefined;
  }
  return pickFrom(papers, placeholder);
}

// Shows a VS Code quick-pick populated with all papers and returns the selected one.
async function pickFrom(papers: PaperRecord[], placeholder: string): Promise<PaperRecord | undefined> {
  const items = papers.map((paper) => ({
    label: paper.title,
    description: `@${paper.citeKey}`,
    detail: `${formatStatus(paper.status)}${paper.year ? ` · ${paper.year}` : ""}`,
    paper,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: placeholder, matchOnDescription: true });
  return picked?.paper;
}

// Capitalizes the first letter of a paper status string for display.
function formatStatus(status: PaperStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
