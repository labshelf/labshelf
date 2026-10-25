// Runs "Use template" for one gallery entry: asks the project title, reads the template's files and creates the project.
import type { ILogger } from "../../ports/index.js";
import type { TemplateManifest } from "../templateManifest/index.js";
import type { HostToGallery, TemplateAddress } from "../protocol/index.js";
import type { TemplateFile, TemplateSource } from "../sources/index.js";
import type { TemplateEntry } from "../templateEntry.js";

export const TEMPLATES_LOG_MODULE = "writing/templates";

export interface UseTemplatePorts {
  logger: ILogger;
  post: (message: HostToGallery) => void;
  /** Asks for the project's title; undefined when the user cancels. */
  askTitle: (defaultTitle: string) => Promise<string | undefined>;
  createProject: (title: string, template: TemplateManifest, files: TemplateFile[]) => Promise<void>;
}

/** Always ends with `use.settled`, so the page's button never stays busy; a failure also reaches the user as an error notice. */
export async function createTemplateProject(ports: UseTemplatePorts, source: TemplateSource, entry: TemplateEntry, signal: AbortSignal): Promise<void> {
  const template: TemplateAddress = { source: entry.source, id: entry.id };
  try {
    const title = await ports.askTitle(entry.name);
    if (title === undefined) { return; }
    const files = await source.files(entry, signal);
    await ports.createProject(title, entry, files);
  } catch (error) {
    await ports.logger.error(TEMPLATES_LOG_MODULE, error, { ...template, action: "use" });
    const cause = error instanceof Error ? error.message : String(error);
    ports.post({ type: "notice", kind: "error", text: `Could not create a project from "${entry.name}": ${cause}` });
  } finally {
    ports.post({ type: "use.settled", template });
  }
}
