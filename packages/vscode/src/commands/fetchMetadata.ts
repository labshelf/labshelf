// Resolves a paper's record from a DOI, arXiv id, PMID, URL or title the user types.
// Serves PDFs the automatic pipeline cannot recognise (poor scans, unindexed papers).
import * as vscode from "vscode";

import {
  identifiersFromInput,
  resolveFirstIdentifier,
  searchOnlineCandidates,
} from "@labshelf/core";
import type { PaperRecord, ResolvedMetadata } from "@labshelf/core";
import type { PaperService } from "../core/index.js";
import { enterMetadataManually, truncate } from "./manualMetadataEntry.js";

/**
 * Asks the user how to identify the paper, resolves it online, and writes the
 * result back to the library.
 * @returns The updated paper, or undefined when the user cancelled or nothing matched.
 */
export async function fetchMetadataForPaper(
  paperService: PaperService,
  paper: PaperRecord,
): Promise<PaperRecord | undefined> {
  const query = await askForQuery(paper);
  if (!query) {
    return undefined;
  }

  const found = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "LabShelf: looking up metadata…" },
    () => lookupUserQuery(query),
  );

  if (found.length === 0) {
    // Nothing online knows this paper — unpublished work, internal reports and
    // obscure venues all land here, so typing it in must stay possible.
    const choice = await vscode.window.showWarningMessage(
      `LabShelf: no record matched "${truncate(query, 60)}".`,
      "Enter manually",
      "Try again",
      "Cancel",
    );
    if (choice === "Try again") {
      return fetchMetadataForPaper(paperService, paper);
    }
    if (choice === "Enter manually") {
      return enterMetadataManually(paperService, paper, query);
    }
    return undefined;
  }

  // A confirmed identifier is unambiguous; a title search is not, so let the
  // user pick between works that match the words they typed equally well.
  const metadata = found.length === 1 ? found[0]! : await pickCandidate(found);
  if (!metadata) {
    return undefined;
  }

  const updated = await paperService.applyResolvedMetadata(paper.id, metadata);
  if (updated) {
    await vscode.window.showInformationMessage(`LabShelf: updated "${truncate(updated.title, 70)}".`);
  }
  return updated;
}

async function askForQuery(paper: PaperRecord): Promise<string | undefined> {
  const query = await vscode.window.showInputBox({
    title: `Fetch metadata — ${paper.title}`,
    prompt: "Paste a DOI, arXiv id, PMID, publisher link, or type the paper's title",
    placeHolder: "10.7554/eLife.28383",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length < 4 ? "Enter a DOI, identifier, link, or title" : undefined),
  });
  return query?.trim() || undefined;
}

/**
 * Turns free-form user input into candidate records, preferring an identifier
 * it can confirm over a title it can only search for.
 * @returns One confirmed record, several candidates, or an empty list.
 */
export async function lookupUserQuery(query: string): Promise<ResolvedMetadata[]> {
  const identifiers = identifiersFromInput(query);
  if (identifiers.length > 0) {
    const confirmed = await resolveFirstIdentifier(identifiers).catch(() => undefined);
    if (confirmed) {
      return [confirmed.metadata];
    }
  }

  return searchOnlineCandidates(query).catch(() => []);
}

// Shows the matches so the user can confirm which work this PDF actually is.
async function pickCandidate(candidates: ResolvedMetadata[]): Promise<ResolvedMetadata | undefined> {
  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.title ?? "Untitled",
      description: [candidate.year, candidate.journal].filter(Boolean).join(" · "),
      detail: [candidate.authors?.slice(0, 4).join(", "), candidate.doi].filter(Boolean).join("  —  "),
      candidate,
    })),
    { title: "Which paper is this?", placeHolder: "Select the matching record", matchOnDetail: true },
  );
  return picked?.candidate;
}

/**
 * Re-runs extraction over every paper no registry ever confirmed, then offers
 * a manual lookup for whatever is still unidentified. This is the recovery
 * path after importing offline or before the pipeline could resolve a source.
 */
export async function resolveMissingMetadata(paperService: PaperService): Promise<void> {
  const pending = await paperService.listUnresolvedPapers();
  if (pending.length === 0) {
    await vscode.window.showInformationMessage("LabShelf: every paper already has a confirmed record.");
    return;
  }

  const recovered: PaperRecord[] = [];
  const stillUnknown: PaperRecord[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "LabShelf: resolving metadata",
      cancellable: true,
    },
    async (progress, token) => {
      for (const [index, paper] of pending.entries()) {
        if (token.isCancellationRequested) {
          return;
        }
        progress.report({
          message: `${index + 1}/${pending.length} — ${truncate(paper.title, 40)}`,
          increment: 100 / pending.length,
        });

        const updated = await paperService.refreshMetadataFromPdf(paper.id).catch(() => undefined);
        (updated ? recovered : stillUnknown).push(updated ?? paper);
      }
    },
  );

  if (recovered.length > 0) {
    await vscode.window.showInformationMessage(
      `LabShelf: recovered metadata for ${recovered.length} of ${pending.length} paper${pending.length === 1 ? "" : "s"}.`,
    );
  }
  await offerMetadataFetch(paperService, stillUnknown);
}

/**
 * Offers to look metadata up for papers the importer could not identify.
 */
export async function offerMetadataFetch(
  paperService: PaperService,
  papers: PaperRecord[],
): Promise<void> {
  if (papers.length === 0) {
    return;
  }

  const subject =
    papers.length === 1
      ? `"${truncate(papers[0]!.title, 50)}"`
      : `${papers.length} papers`;
  const choice = await vscode.window.showWarningMessage(
    `LabShelf could not identify ${subject}. Fill in the details now?`,
    "Look up",
    "Enter manually",
    "Later",
  );
  if (choice !== "Look up" && choice !== "Enter manually") {
    return;
  }

  for (const paper of papers) {
    await (choice === "Look up"
      ? fetchMetadataForPaper(paperService, paper)
      : enterMetadataManually(paperService, paper));
  }
}
