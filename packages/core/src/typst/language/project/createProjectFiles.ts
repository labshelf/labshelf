// Reads the project files one language request needs, once each, and logs the ones that cannot be read.
import type { ILogger } from "../../../ports/index.js";
import { scanTypstFile } from "../syntax/index.js";
import type { TypstFileSymbols } from "../syntax/index.js";
import type { TypstSources } from "../typstLanguageSpec.js";

export interface ProjectFile { path: string; text: string; symbols: TypstFileSymbols }

export interface ProjectFiles {
  /** The file being edited, with its unsaved text. */
  current: ProjectFile;
  list(): Promise<string[]>;
  /** The file's text and, for a `.typ` file, its symbols; null when it cannot be read. */
  file(path: string): Promise<ProjectFile | null>;
}

const MODULE = "typstLanguage";
const EMPTY: TypstFileSymbols = { bindings: [], labels: [], imports: [], includes: [], bibliographies: [] };

/** A reader scoped to one request: nothing is kept between requests, so edits on disk are always seen. */
export function createProjectFiles(sources: TypstSources, logger: ILogger, path: string, text: string, action: string): ProjectFiles {
  const current: ProjectFile = { path, text, symbols: scanTypstFile(text) };
  const files = new Map<string, Promise<ProjectFile | null>>([[path, Promise.resolve(current)]]);
  let listing: Promise<string[]> | undefined;
  return {
    current,
    list() {
      listing ??= sources.list().catch((error: unknown) => {
        void logger.log("WARN", MODULE, "Could not list the project files; going on without them", { action, error: String(error) });
        return [];
      });
      return listing;
    },
    file(wanted) {
      let file = files.get(wanted);
      if (!file) {
        file = sources.read(wanted).then(
          (content) => ({ path: wanted, text: content, symbols: wanted.endsWith(".typ") ? scanTypstFile(content) : EMPTY }),
          (error: unknown) => {
            void logger.log("WARN", MODULE, "Could not read a project file; going on without it", { path: wanted, action, error: String(error) });
            return null;
          },
        );
        files.set(wanted, file);
      }
      return file;
    },
  };
}
