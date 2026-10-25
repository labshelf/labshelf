/** Imports picked PDFs and folders, and papers named by an identifier or link, through the core imports, putting each added paper in the index as it lands. */
import { createDoiFinder, importNetworkInput, importPaths } from "@labshelf/core";
import type { IdentifierImportOptions, ImportDeps, ImportOutcome, ImportProgress, LibraryStore, MutationContext, NetworkImportEnv, PaperRecord, PdfParse } from "@labshelf/core";
import type { RefreshLibraryResult } from "../storage/index.js";

/** How the extension reaches the network for an import, and where a download waits while it is read. */
interface NetworkTransport {
  tmpDir: string;
  download: NetworkImportEnv["download"];
}

export class PaperImporter {
  constructor(
    private readonly ctx: MutationContext,
    private readonly store: LibraryStore,
    private readonly reindex: () => Promise<RefreshLibraryResult>,
    private readonly parse: PdfParse,
    private readonly network: NetworkTransport,
  ) {}

  /**
   * Imports files and folders into targetDir (papers/ when absent); a PDF whose DOI is already in the library is not
   * imported again.
   * @returns one outcome per PDF found, then one per input that is neither file nor folder
   */
  async importPaths(
    inputs: string[],
    targetDir: string = this.ctx.papersRoot,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportOutcome[]> {
    const deps = this.importDeps(this.records());
    return importPaths(this.ctx, deps, inputs, targetDir, {
      ...(onProgress ? { onProgress } : {}),
      onOutcome: (outcome) => this.indexAdded(outcome),
    });
  }

  /**
   * Imports the paper an identifier, a link to an article or a link to a PDF names, into targetDir (papers/ when
   * absent); a DOI already in the library is not imported again. `options.citeKey` names an identifier's paper.
   * @returns what happened
   */
  async importFromNetwork(
    input: string,
    targetDir: string = this.ctx.papersRoot,
    options: IdentifierImportOptions = {},
  ): Promise<ImportOutcome> {
    const papers = this.records();
    const deps = this.importDeps(papers);
    const outcome = await importNetworkInput(
      { ctx: this.ctx, tmpDir: this.network.tmpDir, download: this.network.download, importDeps: () => deps, records: () => papers },
      input,
      targetDir,
      options,
    );
    await this.indexAdded(outcome);
    return outcome;
  }

  private records(): PaperRecord[] {
    return [...this.store.snapshot.papers.values()].map((entry) => entry.record);
  }

  private importDeps(papers: PaperRecord[]): ImportDeps {
    return { parse: this.parse, findByDoi: createDoiFinder(papers), takenIds: () => papers.map((paper) => paper.id) };
  }

  private async indexAdded(outcome: ImportOutcome): Promise<void> {
    if (outcome.status !== "added") { return; }
    await this.reindex();
  }
}
