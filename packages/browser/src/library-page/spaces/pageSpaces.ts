// Composes Spaces over the browser's library folder and workspace navigation.
import {
  SpaceStore, posixPathOps,
  type ProjectEntry, type ILogger, type LibraryFileSystem, type LibraryPapers, type LibraryTransport, type ProjectLibraryPort,
  type SelectionHub, type SpacesHostPort,
} from '@labshelf/core';
import { downloadTextFile } from '../../platform';
import type { Workspace } from '../workspace';
import { createSpaceProjects } from "./spaceProjects";
import { watchSpaces } from './watchSpaces';

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
