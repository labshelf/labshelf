/** Imports picked PDFs and folders, and papers named by an identifier or link, through the core imports, putting each added paper in the index as it lands. */
import { doiLookup, importNetworkInput, importPaths } from "@labshelf/core";
import type { IResearchDatabase, ImportDeps, ImportOutcome, ImportProgress, MutationContext, NetworkImportEnv, PaperRecord, PdfParse } from "@labshelf/core";
import { EVENTS, EventBus } from "../events/index.js";

/** How the extension reaches the network for an import, and where a download waits while it is read. */
interface NetworkTransport {
  tmpDir: string;
  download: NetworkImportEnv["download"];
}

export class PaperImporter {
  constructor(
    private readonly ctx: MutationContext,
    private readonly database: IResearchDatabase,
    private readonly eventBus: EventBus,
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
    const deps = this.importDeps(await this.database.listPapers());
    return importPaths(this.ctx, deps, inputs, targetDir, {
      ...(onProgress ? { onProgress } : {}),
      onOutcome: (outcome) => this.indexAdded(outcome),
    });
  }

  /**
   * Imports the paper an identifier, a link to an article or a link to a PDF names, into targetDir (papers/ when
   * absent); a DOI already in the library is not imported again.
   * @returns what happened
   */
  async importFromNetwork(input: string, targetDir: string = this.ctx.papersRoot): Promise<ImportOutcome> {
    const papers = await this.database.listPapers();
    const deps = this.importDeps(papers);
    const outcome = await importNetworkInput(
      { ctx: this.ctx, tmpDir: this.network.tmpDir, download: this.network.download, importDeps: () => deps, records: () => papers },
      input,
      targetDir,
    );
    await this.indexAdded(outcome);
    return outcome;
  }

  private importDeps(papers: PaperRecord[]): ImportDeps {
    return { parse: this.parse, findByDoi: doiLookup(papers), takenIds: () => papers.map((paper) => paper.id) };
  }

  private async indexAdded(outcome: ImportOutcome): Promise<void> {
    if (outcome.status !== "added") { return; }
    await this.database.upsertPaper(outcome.record);
    this.eventBus.emit(EVENTS.PAPER_ADDED, outcome.record);
  }
}
