// Verifies two devices preserve divergent project saves in one synced folder.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FileProjectVersionStore } from '../../../../src/writing/conflict/index';
import { addProjectWrite, scanLibraryConflicts } from '../../../../src/writing/conflict/node/index';
import { createProjectFromTemplate } from '../../../../src/writing/project/index';
import { createNodeProjectCatalogCompositionRoot } from '../../../../src/writing/project/node/index';
import { createBlankTemplate } from '../../../../src/templates/index';
import { NodeLibraryFileSystem } from '../../../../src/library/node/index';
import { cleanupTempDirs, makeTempDir } from '../../../support/tempDirs';
import type { ILogger } from '../../../../src/ports/index';

const logger: ILogger = { log: async () => {}, error: async () => {} };
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
afterEach(cleanupTempDirs);

async function fixture() {
  const root = await makeTempDir();
  const entry = await createProjectFromTemplate(createNodeProjectCatalogCompositionRoot(logger), root, { title: 'Study', ...createBlankTemplate('latex', 'Study') });
  if (entry.kind !== 'ready') throw new Error('Project missing');
  const state = await Promise.all(ids.map(() => makeTempDir()));
  const stores = state.map(dir => new FileProjectVersionStore(new NodeLibraryFileSystem(), path, dir));
  const base = 'first\n\nsecond\n\nthird\n';
  const file = path.join(entry.folder, 'main.tex');
  await fs.writeFile(file, base);
  for (const store of stores) await scanLibraryConflicts(root, store, logger);
  const save = async (device: number, text: string) => {
    await fs.writeFile(file, text);
    await addProjectWrite({ folder: entry.folder, projectId: entry.settings.id, relativePath: 'main.tex', text, parentText: base,
      store: stores[device]!, identity: { id: async () => ids[device]! }, logger });
  };
  return { root, entry, stores, state, file, base, save };
}

it('merges a silent overwrite from a second device and records the merged text', async () => {
  const { root, stores, file, save, entry } = await fixture();
  await save(0, 'mine\n\nsecond\n\nthird\n');
  await save(1, 'first\n\nsecond\n\ntheirs\n');
  expect(await scanLibraryConflicts(root, stores[0]!, logger)).toEqual([]);
  expect(await fs.readFile(file, 'utf8')).toBe('mine\n\nsecond\n\ntheirs\n');
  expect(await stores[0]!.latest(entry.settings.id, 'main.tex')).toBe('mine\n\nsecond\n\ntheirs\n');
});

it('preserves overlapping versions for the existing prompt across repeated scans', async () => {
  const { root, stores, state, file, save } = await fixture();
  await save(0, 'mine\n\nsecond\n\nthird\n');
  await save(1, 'theirs\n\nsecond\n\nthird\n');
  const conflicts = await scanLibraryConflicts(root, stores[0]!, logger);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]!.tool).toBe('app');
  expect(await fs.readFile(file, 'utf8')).toBe('mine\n\nsecond\n\nthird\n');
  expect(await fs.readFile(conflicts[0]!.copy, 'utf8')).toBe('theirs\n\nsecond\n\nthird\n');
  expect(await scanLibraryConflicts(root, stores[0]!, logger)).toEqual(conflicts);
  const restarted = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, state[0]!);
  expect(await scanLibraryConflicts(root, restarted, logger)).toEqual(conflicts);
});

it('keeps an app divergence copy available when another device has no pending journal', async () => {
  const { root, stores, file, save } = await fixture();
  await save(0, 'mine\n\nsecond\n\nthird\n');
  await save(1, 'theirs\n\nsecond\n\nthird\n');
  const conflicts = await scanLibraryConflicts(root, stores[0]!, logger);
  expect(conflicts).toHaveLength(1);
  expect(await scanLibraryConflicts(root, stores[1]!, logger)).toEqual(conflicts);
  expect(await fs.readFile(conflicts[0]!.copy, 'utf8')).toBe('theirs\n\nsecond\n\nthird\n');
  expect(await fs.readFile(file, 'utf8')).toBe('mine\n\nsecond\n\nthird\n');
});
