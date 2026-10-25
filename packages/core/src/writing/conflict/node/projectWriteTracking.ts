// Tracks app file writes and editor saves before their project bytes reach disk.
import * as path from 'node:path';
import { FileProjectVersionStore } from '../index.js';
import type { ProjectWriteTracking } from '../index.js';
import { isMergeableTextFile } from '../index.js';
import { createDeviceIdentity, createDeviceLocalLayout } from '../../../library/node/index.js';
import type { ILogger, LibraryFileSystem } from '../../../ports/index.js';
import { listLibraryProjects } from '../../project/node/index.js';
import { addProjectWriteRecord } from './projectWriteRecord.js';

export function createProjectWriteTracking(fs: LibraryFileSystem, root: () => string | undefined, logger: ILogger): ProjectWriteTracking {
  const parents = new Map<string, string | undefined>();
  const stores = new Map<string, FileProjectVersionStore>();
  const record = async (file: string, text: string, parentText: string | undefined, committed: boolean): Promise<void> => {
    const libraryRoot = root();
    if (!libraryRoot || !isMergeableTextFile(path.basename(file), new TextEncoder().encode(text))) return;
    const projects = await listLibraryProjects(libraryRoot, logger);
    const project = projects.filter(entry => entry.kind === 'ready' && file.startsWith(`${entry.folder}${path.sep}`))
      .sort((a, b) => b.folder.length - a.folder.length)[0];
    if (!project || project.kind !== 'ready' || project.settings.shared) return;
    const layout = createDeviceLocalLayout(libraryRoot);
    let store = stores.get(libraryRoot);
    if (!store) { store = new FileProjectVersionStore(fs, path, layout.mergeBasesDir); stores.set(libraryRoot, store); }
    if (committed) { await store.remember(project.settings.id, path.relative(project.folder, file).split(path.sep).join('/'), text); return; }
    await addProjectWriteRecord({ folder: project.folder, projectId: project.settings.id, relativePath: path.relative(project.folder, file).split(path.sep).join('/'),
      text, parentText, store, identity: createDeviceIdentity(layout, logger), logger });
  };
  const parent = async (file: string): Promise<string | undefined> => {
    try { return await fs.readText(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  const beforeWrite = async (file: string, bytes: Uint8Array): Promise<void> => {
    if (isMergeableTextFile(path.basename(file), bytes)) await record(file, Buffer.from(bytes).toString('utf8'), await parent(file), false);
  };
  const tracked = new Proxy(fs, { get(target, key) {
    if (key === 'writeText') return async (file: string, text: string) => { await beforeWrite(file, new TextEncoder().encode(text)); await fs.writeText(file, text); await record(file, text, undefined, true); };
    if (key === 'writeFile') return async (file: string, bytes: Uint8Array) => { await beforeWrite(file, bytes); await fs.writeFile(file, bytes); if (isMergeableTextFile(path.basename(file), bytes)) await record(file, Buffer.from(bytes).toString('utf8'), undefined, true); };
    const member = Reflect.get(target, key);
    return typeof member === 'function' ? member.bind(target) : member;
  } });
  return {
    fs: tracked,
    beforeSave: async (file, text) => { const previous = await parent(file); parents.set(file, previous); await record(file, text, previous, false); },
    afterSave: async (file, text) => {
      if (!parents.has(file)) throw new Error(`Project save has no captured parent: ${file}`);
      const previous = parents.get(file); parents.delete(file); await record(file, text, previous, false); await record(file, text, previous, true);
    },
  };
}
