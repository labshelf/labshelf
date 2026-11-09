// The reader page's "Cite in a project…": picks a ready project and copies the citation, or adds the paper to the project's labshelf.bib.
import {
  createReaderCitation, deriveReaderCiteChoices, formatError, withListedPaper,
  type CitationInProjectRequest, type ILogger, type LibraryFileSystem, type PaperRecord, type ProjectContentPort,
  type ReaderCiteChoice,
} from "@labshelf/core";
import { showToast, type MenuEntry, type ToastKind } from "@labshelf/core/dom";
import { listCachedPaperRecords } from "../../storage";
import { createBrowserProjectContent } from "../../writing";
import { listReady, pickFromMenu, trackPointer, type ReadyProject } from "./readerProjects";

export interface CiteInProjectDeps {
  content: Pick<ProjectContentPort, "updateProjectSettings" | "updateProjectBibliography">;
  writeClipboard(text: string): Promise<void>;
  listPapers(): Promise<PaperRecord[]>;
}

type ProjectChoice = { project: ReadyProject; choice: ReaderCiteChoice };

/** Puts the paper in the project's papers list and regenerates labshelf.bib from it; writes nothing when the user already listed the paper. */
async function addToBibliography({ content, listPapers }: CiteInProjectDeps, project: ReadyProject, paper: PaperRecord): Promise<void> {
  const papers = withListedPaper(project.settings.papers ?? [], paper);
  if (!papers) return;
  await content.updateProjectSettings(project.folder, { papers });
  await content.updateProjectBibliography({ ...project, settings: { ...project.settings, papers } }, await listPapers());
}

/** Runs the picked action; returns the message to show. The citation is copied after the bibliography has the paper, so what the user pastes resolves. */
export async function applyReaderCite(
  deps: CiteInProjectDeps, { project, choice }: ProjectChoice, paper: PaperRecord, citation: { page?: number; quote?: string },
): Promise<string> {
  const id = project.settings.id;
  await addToBibliography(deps, project, paper);
  if (choice.action === "bibliography") return `Added ${paper.citeKey} to ${id}'s labshelf.bib.`;
  const text = createReaderCitation(project.settings.format, paper.citeKey, citation, choice.action === "citeQuoted");
  await deps.writeClipboard(text);
  return `Copied ${text}. ${id}'s labshelf.bib has the paper.`;
}

function menuEntries(projects: readonly ReadyProject[], paper: PaperRecord, citation: { page?: number; quote?: string }, pick: (value: ProjectChoice) => void): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const project of projects) {
    if (entries.length > 0) entries.push("separator");
    entries.push({ label: project.settings.title ?? project.settings.id, hint: project.settings.id, disabled: true, onSelect: () => undefined });
    for (const choice of deriveReaderCiteChoices({ format: project.settings.format, settings: project.settings }, paper, citation, undefined)) {
      entries.push({ label: choice.label, hint: choice.description, onSelect: () => pick({ project, choice }) });
    }
  }
  return entries;
}

/** @returns the reader's citeInProject port over the library's projects; `paper` is the paper the page opened. */
export function createReaderCiteInProject(
  fs: LibraryFileSystem, logger: ILogger, paper: PaperRecord,
): (request: CitationInProjectRequest) => Promise<void> {
  const pointer = trackPointer();
  const deps: CiteInProjectDeps = {
    content: createBrowserProjectContent({ fs, logger }),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    listPapers: listCachedPaperRecords,
  };
  const toast = (message: string, kind: ToastKind): void => { showToast(message, kind); };

  return async ({ page, quote }) => {
    const citation = { ...(page === undefined ? {} : { page }), ...(quote === undefined ? {} : { quote }) };
    try {
      const ready = await listReady(fs, logger);
      if (ready.length === 0) { toast("Open or create a LabShelf project first.", "info"); return; }
      const picked = await pickFromMenu<ProjectChoice>(pointer(), (pick) => menuEntries(ready, paper, citation, pick));
      if (picked) toast(await applyReaderCite(deps, picked, paper, citation), "ok");
    } catch (err) {
      void logger.error("reader", err, { op: "citeInProject" });
      toast(formatError(err), "error");
    }
  };
}
