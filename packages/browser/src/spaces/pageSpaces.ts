// Composes Spaces over the browser's library folder and workspace navigation.
import {
  SpaceStore,
  posixPathOps,
  type ProjectEntry,
  type ILogger,
  type LibraryFileSystem,
  type LibraryPapers,
  type LibraryTransport,
  type ProjectLibraryPort,
  type SelectionHub,
  type SpacesHostPort,
  createSpaceProjectList,
  type ProjectRow,
  deriveSpaceChecklistProgress,
  papersByCiteKey,
  readChecklistSignals,
  type Progress,
} from '@labshelf/core';
import { downloadTextFile } from '../platform';
import type { Workspace } from '../libraryUi/editorArea';
import { watchSpaces } from './watchSpaces';
import { onLocalFileChanges } from '../collab';
import { createBrowserProjectData } from '../writing/project';

async function projectChecklist(fs: LibraryFileSystem, logger: ILogger, entry: Extract<ProjectEntry, { kind: 'ready' }>, library: LibraryPapers): Promise<Progress | undefined> {
  const signals = await readChecklistSignals({ fs, logger, paths: posixPathOps }, entry);
  const papers = papersByCiteKey([...library.values()].map(value => value.record));
  const reading = (entry.settings.papers ?? []).flatMap(({ key }) => {
    const paper = papers.get(key);
    return paper ? [{ key, title: paper.title, status: paper.status }] : [];
  });
  return deriveSpaceChecklistProgress(signals, reading);
}

type ReadyProject = Extract<ProjectEntry, { kind: 'ready' }>;
interface SpaceProjectsOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
  projects(): ProjectLibraryPort | null;
  openProject(entry: ReadyProject): Promise<void>;
  library(): LibraryPapers;
}

function rowOf(entry: ReadyProject): ProjectRow {
  return {
    id: entry.folder, title: entry.settings.title ?? entry.settings.id, format: entry.settings.format,
    place: entry.settings.trashed ? 'trash' : entry.settings.archived ? 'archived' : 'projects',
    ...(entry.main === undefined ? {} : { main: entry.main }),
    ...(entry.settings.target === undefined ? {} : { target: entry.settings.target }),
  };
}

function createSpaceProjects(options: SpaceProjectsOptions) {
  const { fs, logger } = options;
  const data = createBrowserProjectData({ fs, logger });
  const entries = async (): Promise<ReadyProject[]> => (await data.listProjects('')).filter((entry): entry is ReadyProject => entry.kind === 'ready');
  return {
    async projects() {
      if (!options.projects()) return [];
      const ready = await entries();
      const byFolder = new Map(ready.map(entry => [entry.folder, entry]));
      const infos = await createSpaceProjectList(ready.map(rowOf), row => projectChecklist(fs, logger, byFolder.get(row.id)!, options.library()), logger);
      return infos.map(info => ({ ...info, projectId: byFolder.get(info.projectId)!.settings.id }));
    },
    async openProject(id: string): Promise<void> {
      const host = options.projects();
      const entry = host ? (await entries()).find(project => project.settings.id === id && !project.settings.trashed) : undefined;
      if (!entry || !host) throw new Error(`Project ${id} is not on this device`);
      await options.openProject(entry);
    },
    onChange(listener: () => void): () => void {
      const stopLocal = onLocalFileChanges(paths => {
        if (paths.some(path => path === '' || path === 'projects' || path.startsWith('projects/'))) listener();
      });
      const stopHost = options.projects()?.onDidChange(listener);
      return () => { stopLocal(); stopHost?.(); };
    },
  };
}

export interface PageSpaces {
  store: SpaceStore;
  port: SpacesHostPort;
  reload(): Promise<void>;
  dispose(): void;
}

export interface PageSpacesOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
  transport: LibraryTransport;
  workspace(): Workspace;
  selection: SelectionHub;
  projects(): ProjectLibraryPort | null;
  openProject(entry: Extract<ProjectEntry, { kind: 'ready' }>): Promise<void>;
}

export function createPageSpaces(options: PageSpacesOptions): PageSpaces {
  const { fs, logger, transport } = options;
  const store = new SpaceStore({ root: '', fs, paths: posixPathOps, logger });
  let library: LibraryPapers = new Map();
  const listeners = new Set<() => void>();
  const stopSnapshots = transport.subscribe(message => {
    if (message.type !== 'snapshot') return;
    library = new Map(message.snapshot.papers.map(record => [record.id, { record }]));
    listeners.forEach(listener => listener());
  });
  const port = createPort(options, () => library, listeners);
  const reload = async (): Promise<void> => { await store.reload(); };
  const stopWatch = watchSpaces(reload, logger);
  return { store, port, reload, dispose: () => { stopWatch(); stopSnapshots(); listeners.clear(); } };
}

function createPort(options: PageSpacesOptions, library: () => LibraryPapers, listeners: Set<() => void>): SpacesHostPort {
  const { transport, selection } = options;
  const projects = createSpaceProjects({ ...options, library });
  return {
    library,
    onLibraryChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    projects: projects.projects,
    onProjectsChange: projects.onChange,
    openPaper: async paperId => { transport.post({ type: 'paper.open', id: paperId }); },
    selectPaper: async paperId => { selection.publish('spaces', { kind: 'paper', ids: [paperId] }); selection.activate('spaces'); },
    openProject: projects.openProject,
    openSpace: async (id, tab = 'overview') => { options.workspace().openTab('space', { id, tab }); },
    openCatalog: async () => { options.workspace().openTab('spaces'); },
    saveFile: (name, text) => downloadTextFile(name, text, 'text/calendar;charset=utf-8'),
  };
}
