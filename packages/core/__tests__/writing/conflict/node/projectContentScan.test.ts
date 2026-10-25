// Pins canonical selection across repeated scans of content-matched copies.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { scanLibraryConflicts, scanSharedProjectConflicts } from '../../../../src/writing/conflict/node/index';
import { FileProjectVersionStore } from '../../../../src/writing/conflict/index';
import { resolveProjectConflictCopy } from '../../../../src/library/conflicts/node/index';
import { NodeLibraryFileSystem } from '../../../../src/library/node/index';
import { nodeProjectCatalogContext } from '../../../../src/writing/project/node/index';
import { createProjectFromTemplate } from '../../../../src/writing/project/index';
import { createBlankTemplate } from '../../../../src/templates/index';
import { fakeLogger } from '../../../support/fakeLogger';
import { cleanupTempDirs, makeTempDir } from '../../../support/tempDirs';
afterEach(cleanupTempDirs);
it('offers only the copy repeatedly without merging or seeding a copy as the original', async () => {
  const root = await makeTempDir();
  const logger = fakeLogger();
  const project = await createProjectFromTemplate(nodeProjectCatalogContext(logger), root, { title: 'Study', ...createBlankTemplate('latex', 'Study') });
  if (project.kind !== 'ready') throw new Error('Project unavailable');
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(root, 'bases'));
  const original = path.join(project.folder, 'main.tex');
  const base = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
  await fs.writeFile(original, base);
  await scanLibraryConflicts(root, store, logger);
  const copy = path.join(project.folder, 'main (1).tex');
  await fs.writeFile(copy, base.replace('Line 8', 'Remote line'));
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await scanLibraryConflicts(root, store, logger)).toEqual([expect.objectContaining({ original, copy, match: 'similar' })]);
    expect(await fs.readFile(original, 'utf8')).toBe(base);
    expect(await store.latest(project.settings.id, 'main (1).tex')).toBeUndefined();
  }
  expect(await scanSharedProjectConflicts(root, store, logger)).toEqual([]);
});
it('includes shared project copies in the library scan without merging them', async () => {
  const root = await makeTempDir();
  const logger = fakeLogger();
  const project = await createProjectFromTemplate(nodeProjectCatalogContext(logger), root, { title: 'Shared Study', ...createBlankTemplate('latex', 'Shared Study') });
  if (project.kind !== 'ready') throw new Error('Project unavailable');
  await fs.appendFile(path.join(project.folder, 'labshelf.yaml'), 'shared: shared-copy-discovery\n');
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(root, 'bases'));
  const base = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
  const original = path.join(project.folder, 'main.tex');
  const copy = path.join(project.folder, 'main (1).tex');
  await fs.writeFile(original, base);
  await store.remember(project.settings.id, 'main.tex', base);
  const other = base.replace('Line 8', 'Remote line');
  await fs.writeFile(copy, other);
  expect(await scanLibraryConflicts(root, store, logger)).toEqual([expect.objectContaining({ original, copy, match: 'similar' })]);
  expect(await fs.readFile(original, 'utf8')).toBe(base);
  expect(await fs.readFile(copy, 'utf8')).toBe(other);
  expect(await store.read(project.settings.id, 'main.tex')).toBeUndefined();
});
it('leaves two established similar files out of the conflict prompt', async () => {
  const root = await makeTempDir();
  const logger = fakeLogger();
  const project = await createProjectFromTemplate(nodeProjectCatalogContext(logger), root, { title: 'Study', ...createBlankTemplate('latex', 'Study') });
  if (project.kind !== 'ready') throw new Error('Project unavailable');
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(root, 'bases'));
  const base = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
  const chapter = base.replace('Line 8', 'Chapter line');
  await fs.writeFile(path.join(project.folder, 'main.tex'), base);
  await fs.writeFile(path.join(project.folder, 'chapter.tex'), chapter);
  await store.remember(project.settings.id, 'main.tex', base);
  await store.remember(project.settings.id, 'chapter.tex', chapter);
  expect(await scanLibraryConflicts(root, store, logger)).toEqual([]);
  expect(await fs.readFile(path.join(project.folder, 'chapter.tex'), 'utf8')).toBe(chapter);
});

it('offers a dismissed copy again after its content changes despite a seeded version', async () => {
  const root = await makeTempDir();
  const logger = fakeLogger();
  const project = await createProjectFromTemplate(nodeProjectCatalogContext(logger), root, { title: 'Study', ...createBlankTemplate('latex', 'Study') });
  if (project.kind !== 'ready') throw new Error('Project unavailable');
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(root, 'bases'));
  const base = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
  const original = path.join(project.folder, 'main.tex');
  const copy = path.join(project.folder, 'main (1).tex');
  await fs.writeFile(original, base);
  await scanLibraryConflicts(root, store, logger);
  await fs.writeFile(copy, base.replace('Line 8', 'Remote line'));
  const [conflict] = await scanLibraryConflicts(root, store, logger);
  expect(conflict).toMatchObject({ original, copy, match: 'similar' });
  await resolveProjectConflictCopy(conflict!, 'notAVersion', { root, store, logger });
  expect(await scanLibraryConflicts(root, store, logger)).toEqual([]);
  expect(await store.latest(project.settings.id, 'main (1).tex')).toBeDefined();
  await fs.appendFile(copy, '\nAdditional line');
  expect(await scanLibraryConflicts(root, store, logger)).toEqual([expect.objectContaining({ original, copy, match: 'similar' })]);
});
