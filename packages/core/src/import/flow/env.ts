/** Declares what a network import needs from its app: the mutation ports, the app's index and the network it downloads through. */
import type { DetectedIdentifier } from "../identifiers/index.js";
import type { ImportDeps, MutationContext } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { RegistryEnv, ResolvedMetadata } from "../registries/index.js";
import type { PdfFetchOptions } from "../pdfFinder/index.js";

export interface NetworkImportEnv {
  ctx: MutationContext;
  /** Where a downloaded PDF waits while the PDF import reads it. */
  tmpDir: string;
  /** Read at each import, so it reflects the papers the earlier imports added. */
  importDeps(): ImportDeps;
  /** Read at each import, so it reflects the papers the earlier imports added. */
  records(): PaperRecord[];
  /** The app's network: its `fetch` and the headers that identify it. Downloads log through `ctx.logger`. */
  download: { fetch: typeof fetch; headers?: Record<string, string> };
  /** Network metadata lookups; injectable for tests. */
  resolveIdentifier?: (identifier: DetectedIdentifier) => Promise<ResolvedMetadata | undefined>;
  searchByTitle?: (title: string) => Promise<ResolvedMetadata | undefined>;
}

export const NETWORK_IMPORT_MODULE = "import/networkImport";

export function createPdfFinderOptions(env: NetworkImportEnv): PdfFetchOptions {
  return { ...env.download, logger: env.ctx.logger };
}

/** Registry lookups go out on the app's fetch and log their failures through the app's logger. */
export function createRegistryEnv(env: NetworkImportEnv): RegistryEnv {
  return { fetch: env.download.fetch, logger: env.ctx.logger };
}
