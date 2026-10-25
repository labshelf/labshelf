// Connects browser sidebar Space actions to the page store.
import { formatError, deriveSidebarRows, type ILogger, type SpaceStore } from "@labshelf/core";
import { askInputBox, showToast, type LibrarySidebar, type SidebarSpaceActions } from "@labshelf/core/dom";
import type { PageSpaces } from "../../spaces";

export interface SidebarSpaces {
  actions: SidebarSpaceActions;
  attach(sidebar: LibrarySidebar): () => void;
}

async function dropPapers(store: SpaceStore, id: string, folder: string | undefined, ids: string[]): Promise<void> {
  const result = await store.read(id);
  if (result.state !== "ready") throw new Error(`Cannot add papers to unreadable Space: ${id}`);
  const present = new Set(result.space.papers.map((paper) => paper.id));
  await store.addPapers(id, ids.filter((paper) => !present.has(paper)), folder);
  for (const paper of ids.filter((paper) => present.has(paper))) await store.moveReference(id, paper, folder);
}

export function createSidebarSpaces({ store, port }: PageSpaces, log: ILogger): SidebarSpaces {
  const run = (work: () => Promise<unknown>): void => {
    void work().catch((error: unknown) => {
      void log.error("spaces-sidebar", error);
      showToast(formatError(error), "error");
    });
  };
  const name = (title: string, value = "") => askInputBox({ title, value, validate: (text) => text.trim() ? null : "Enter a name" });
  const rename = async (id: string): Promise<void> => {
    const result = await store.read(id);
    if (result.state !== "ready") throw new Error(`Cannot rename unreadable Space: ${id}`);
    const next = await name("Rename Space", result.space.name);
    if (next !== undefined) await store.renameSpace(id, next);
  };
  const renameFolder = async (id: string, folder: string): Promise<void> => {
    const result = await store.read(id);
    if (result.state !== "ready") throw new Error(`Cannot rename folder in unreadable Space: ${id}`);
    const next = await name("Rename folder", result.space.folders.find((item) => item.id === folder)?.name);
    if (next !== undefined) await store.renameFolder(id, folder, next);
  };
  return {
    actions: {
      openCatalog: () => run(() => port.openCatalog()),
      openSpace: (id, folder) => run(() => port.openSpace(id, folder === undefined ? "overview" : "papers")),
      openPaper: (id) => run(() => port.openPaper(id)),
      newSpace: () => run(async () => { const next = await name("New Space"); if (next !== undefined) await port.openSpace(await store.createSpace(next)); }),
      renameSpace: (id) => run(() => rename(id)),
      deleteSpace: (id) => run(() => store.deleteSpace(id)),
      newFolder: (id, parent) => run(async () => { const next = await name("New folder"); if (next !== undefined) await store.createFolder(id, next, parent); }),
      renameFolder: (id, folder) => run(() => renameFolder(id, folder)),
      deleteFolder: (id, folder) => run(() => store.deleteFolder(id, folder)),
      dropPapers: (id, folder, ids) => run(() => dropPapers(store, id, folder, ids)),
      removeReference: (id, paper) => run(() => store.removePaper(id, paper)),
    },
    attach(sidebar) {
      const update = (): void => sidebar.setSpaces(deriveSidebarRows(store.list(), port.library()));
      const offStore = store.onChange(update);
      const offLibrary = port.onLibraryChange(update);
      update();
      return () => { offStore(); offLibrary(); };
    },
  };
}
