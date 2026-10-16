/** Lists the files of a paper folder and stores their descriptions in the paper's metadata.yaml. */
import { describePaperFileOnDisk, errorMessage, listPaperFiles } from "@labshelf/core";
import type { ILogger, LibraryFileSystem, MutationContext, PaperFilesState, PaperRecord } from "@labshelf/core";
import type { ReindexSummary } from "../storage/data/index.js";

const LOG_MODULE = "core/paperFiles";

export class PaperFileService {
  constructor(
    private readonly fs: Pick<LibraryFileSystem, "listDir" | "stat">,
    private readonly findPaper: (id: string) => Promise<PaperRecord | undefined>,
    private readonly ctx: MutationContext,
    private readonly logger: ILogger,
    private readonly reindex: () => Promise<ReindexSummary>,
  ) {}

  /** @returns the paper folder's entries with their descriptions, or a failed state when the paper or folder is unreadable */
  async list(paperId: string): Promise<PaperFilesState> {
    const paper = await this.findPaper(paperId);
    if (!paper) {
      await this.logger.log("WARN", LOG_MODULE, "Files asked for a paper not in the library", { id: paperId });
      return { status: "failed", message: "The paper is not in the library" };
    }
    return listPaperFiles(this.fs, paper.path, paper.files, this.logger);
  }

  /**
   * Sets (trimmed) or clears one file's description; an empty description removes it.
   * @returns the fresh listing, or undefined when the paper is unknown or `name` is not one of its files
   */
  async describe(paperId: string, name: string, description: string): Promise<PaperFilesState | undefined> {
    const paper = await this.findPaper(paperId);
    try {
      if (!paper || !(await describePaperFileOnDisk(this.ctx, paper.path, name, description))) { throw new Error("The paper is not in the library"); }
    } catch (error) {
      await this.logger.log("WARN", LOG_MODULE, "File description refused", { id: paperId, name, path: paper?.path, message: errorMessage(error) });
      return undefined;
    }
    await this.reindex();
    return this.list(paperId);
  }
}
