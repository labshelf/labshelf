// Verifies project save ancestry is recorded before writes without advancing unsuccessful versions.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createProjectSaveTracking, recordProjectSave, scanLibraryConflicts } from '../../../../src/writing/conflict/node/index';
import { FileProjectVersionStore } from '../../../../src/writing/conflict/index';
import { createProjectFromTemplate } from '../../../../src/writing/project/index';
import { createNodeProjectCatalogCompositionRoot } from '../../../../src/writing/project/node/index';
import { createBlankTemplate } from '../../../../src/templates/index';
import { createDeviceLocalLayout, NodeLibraryFileSystem } from '../../../../src/library/node/index';
import { readWriteRecords } from '../../../../src/library/writeRecords/index';
import { cleanupTempDirs, makeTempDir } from '../../../support/tempDirs';
import type { ILogger } from '../../../../src/ports/index';

const logger: ILogger = { log: async () => {}, error: async () => {} };
const stateHome = process.env.XDG_STATE_HOME;
afterEach(async () => { if (stateHome === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = stateHome; await cleanupTempDirs(); });

async function fixture() {
  process.env.XDG_STATE_HOME = await makeTempDir();
  const root = await makeTempDir();
  const project = await createProjectFromTemplate(createNodeProjectCatalogCompositionRoot(logger), root, { title: 'Study', ...createBlankTemplate('latex', 'Study') });
  if (project.kind !== 'ready') throw new Error('Project missing');
  const disk = new NodeLibraryFileSystem();
  const file = path.join(project.folder, 'main.tex');
  await disk.writeText(file, 'base');
  const store = new FileProjectVersionStore(disk, path, createDeviceLocalLayout(root).mergeBasesDir);
  await scanLibraryConflicts(root, store, logger);
  return { root, project, disk, file, store, tracking: createProjectSaveTracking(disk, () => root, logger) };
}

it('records the on-disk parent before an app write reaches the filesystem', async () => {
  const { disk, tracking, file, project } = await fixture();
  const original = disk.writeText.bind(disk);
  const write = jest.spyOn(disk, 'writeText').mockImplementation(async (target, text) => {
    if (target === file) {
      const records = await readWriteRecords(disk, project.folder, logger);
      expect(records.get('main.tex')?.at(-1)?.parent).toMatch(/^[a-f0-9]{64}$/);
      expect(await disk.readText(file)).toBe('base');
    }
    await original(target, text);
  });
  await tracking.fs.writeText(file, 'saved');
  expect(write).toHaveBeenCalled();
});

it('keeps the last successful version after an editor save fails', async () => {
  const { tracking, store, project, file, root } = await fixture();
  await tracking.beforeSave(file, 'unsaved');
  expect(await store.latest(project.settings.id, 'main.tex')).toBe('base');
  await scanLibraryConflicts(root, store, logger);
  expect(await store.latest(project.settings.id, 'main.tex')).toBe('base');
});

it('records final save-participant text with the captured parent', async () => {
  const { tracking, store, project, file, disk } = await fixture();
  await tracking.beforeSave(file, 'draft');
  await disk.writeText(file, 'formatted');
  await tracking.afterSave(file, 'formatted');
  expect(await store.latest(project.settings.id, 'main.tex')).toBe('formatted');
  const records = (await readWriteRecords(disk, project.folder, logger)).get('main.tex')!;
  expect(records.at(-1)?.parent).toBe(records.at(-2)?.parent);
  expect(records.at(-1)?.hash).not.toBe(records.at(-2)?.hash);
});

it('keeps concurrent saves of different files in the same device record', async () => {
  const { store, project, disk } = await fixture();
  const identity = { id: async () => '11111111-1111-4111-8111-111111111111' };
  await Promise.all(Array.from({ length: 8 }, (_, i) => recordProjectSave({
    folder: project.folder, projectId: project.settings.id, relativePath: `chapter${i}.tex`,
    text: `chapter ${i}`, parentText: '', store, identity, logger,
  })));
  const records = await readWriteRecords(disk, project.folder, logger);
  expect([...records.keys()].sort()).toEqual(Array.from({ length: 8 }, (_, i) => `chapter${i}.tex`));
});
