// Resolves stable Space project ids against the browser's live project folders.
import {
  buildSpaceProjectInfos, type ILogger, type LibraryFileSystem, type LibraryPapers,
  type ProjectEntry, type ProjectLibraryPort, type ProjectRow,
} from '@labshelf/core';
import { onLocalFileChanges } from '../editor/collab';
import { createBrowserProjectData } from '../projects-data';
import { projectChecklist } from './projectChecklist';

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

export function createSpaceProjects(options: SpaceProjectsOptions) {
  const { fs, logger } = options;
  const data = createBrowserProjectData({ fs, logger });
  const entries = async (): Promise<ReadyProject[]> => (await data.listProjects('')).filter((entry): entry is ReadyProject => entry.kind === 'ready');
  return {
    async projects() {
      if (!options.projects()) return [];
      const ready = await entries();
      const byFolder = new Map(ready.map(entry => [entry.folder, entry]));
      const infos = await buildSpaceProjectInfos(ready.map(rowOf), row => projectChecklist(fs, logger, byFolder.get(row.id)!, options.library()), logger);
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
