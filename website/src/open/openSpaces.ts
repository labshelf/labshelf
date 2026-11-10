// Serves Spaces and Home read-only on /open/: core's stores over the Mirror's preloaded rows, a port into the page, and the tab mounts.
import {
  answerNoteFileRequest, createLibraryLayout, createLoopbackTransport, formatLocalDay, HomeStore, posixPathOps, serveSpaces, SpaceStore,
  type HostToSpaces, type ILogger, type LibraryFileSystem, type LibraryPapers, type NoteFileReply, type NoteFileRequest, type PaperRecord, type SpaceProjectEntry, type SpacesHostPort, type SpacesToHost, type SpaceTab,
} from "@labshelf/core";
import type { EditorTabBody } from "@labshelf/core/dom";

import { saveFile } from "../share/shareDownloads.js";
import { READ_ONLY_NOTICE } from "./mirrorFileSystem.js";
import type { MirrorProject } from "./mirrorProjects.js";

type SpacesUi = ReturnType<typeof createLoopbackTransport<SpacesToHost, HostToSpaces>>["ui"];

/** What the Spaces pages ask of the page. */
export interface OpenSpacesHooks {
  openPaper(paperId: string): void;
  openProject(projectId: string): void;
  openSpace(id: string, tab?: SpaceTab): void;
  openCatalog(): void;
}

export interface OpenSpaces {
  store: SpaceStore;
  library: LibraryPapers;
  /** Serves a view for one tab; disposing stops the view, then the serving. */
  mountTab(el: HTMLElement, mount: (el: HTMLElement, ui: SpacesUi) => () => void): EditorTabBody;
}

const consoleLogger: ILogger = {
  log: async (level, module, message, context) => { if (level === "WARN" || level === "ERROR") { console.warn(`[${module}] ${message}`, context ?? ""); } },
  error: async (module, error, context) => { console.error(`[${module}]`, error, context ?? ""); },
};

export async function createOpenSpaces(options: {
  fs: LibraryFileSystem; papers: readonly PaperRecord[]; projects: readonly MirrorProject[]; hooks: OpenSpacesHooks;
}): Promise<OpenSpaces> {
  const { fs, hooks } = options;
  const store = new SpaceStore({ root: "", fs, paths: posixPathOps, logger: consoleLogger });
  const home = new HomeStore({ root: "", fs, paths: posixPathOps, logger: consoleLogger });
  const library: LibraryPapers = new Map(options.papers.map((record) => [record.id, { record }]));
  const entries: SpaceProjectEntry[] = options.projects.filter((p) => !p.hidden).map((p) => ({
    projectId: p.id, title: p.name, available: true,
    ...(p.format === undefined ? {} : { format: p.format }), ...(p.main === undefined ? {} : { mainFile: p.main }),
  }));
  const port: SpacesHostPort = {
    library: () => library,
    onLibraryChange: () => () => undefined,
    projects: async () => entries,
    onProjectsChange: () => () => undefined,
    openPaper: async (id) => { hooks.openPaper(id); },
    selectPaper: async () => undefined,
    openProject: async (id) => { hooks.openProject(id); },
    openSpace: async (id, tab) => { hooks.openSpace(id, tab); },
    openCatalog: async () => { hooks.openCatalog(); },
    saveFile: async (name, text) => { saveFile(name, text, "text/calendar;charset=utf-8"); },
  };
  // A Space note reads its chart tables beside it (notes/assets/); writes fail on the read-only file system.
  const layout = createLibraryLayout("", posixPathOps.join);
  const io = { fs, join: posixPathOps.join, pick: async () => null };
  const noteFiles = (spaceId: string, notePath: string, request: NoteFileRequest): Promise<NoteFileReply> =>
    answerNoteFileRequest(io, posixPathOps.join(layout.spaceDir(spaceId), posixPathOps.dirname(notePath)), request);
  await store.reload();
  return {
    store,
    library,
    mountTab(el, mount) {
      const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
      const stop = serveSpaces(host, {
        store, home, port, logger: consoleLogger, today: () => formatLocalDay(Date.now()), author: "Me", noteFiles, readOnlyReason: READ_ONLY_NOTICE,
      });
      const unmount = mount(el, ui);
      return { dispose: () => { unmount(); stop(); } };
    },
  };
}
