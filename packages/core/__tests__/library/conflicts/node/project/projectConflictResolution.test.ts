// Pins content-copy resolution through atomic recorded project writes.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { findProjectConflict, resolveConflictDismissalFile, resolveProjectConflictCopy } from '../../../../../src/writing/conflict/node/index';
import { readConflictDismissals } from '../../../../../src/library/conflicts/index';
import { createNodeCollabStorage } from '../../../../../src/collab/node/index';
import { FileProjectVersionStore } from '../../../../../src/writing/conflict/index';
import { deriveTextSha256Hex } from '../../../../../src/hash/index';
import { NodeLibraryFileSystem, createDeviceLocalLayout } from '../../../../../src/library/node/index';
import { fakeLogger } from '../../../../support/fakeLogger';
import { cleanupTempDirs, makeTempDir } from '../../../../support/tempDirs';

afterEach(cleanupTempDirs);
async function fixture() {
  const root = await makeTempDir();
  const folder = path.join(root, 'project');
  await fs.mkdir(folder);
  const original = path.join(folder, 'main.tex');
  const file = path.join(folder, 'main (1).tex');
  const base = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n') + '\n';
  await fs.writeFile(original, base.replace('Line 1', 'Local line'));
  await fs.writeFile(file, base.replace('Line 8', 'Remote line'));
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(root, 'state'));
  await store.write('p', 'main.tex', base);
  const input = { root, folder, projectId: 'p', file, store, logger: fakeLogger() };
  return { ...input, base, original };
}
it('merges the stored base and removes the offered copy', async () => {
  const input = await fixture();
  const conflict = await findProjectConflict(input);
  expect(conflict).toMatchObject({ match: 'similar', original: input.original });
  await resolveProjectConflictCopy(conflict!, 'mergeAutomatically', input);
  const merged = await fs.readFile(input.original, 'utf8');
  expect(merged).toContain('Local line');
  expect(merged).toContain('Remote line');
  expect(merged).not.toContain('<<<<<<<');
  await expect(fs.stat(input.file)).rejects.toThrow();
  expect(await input.store.latest('p', 'main.tex')).toBe(merged);
});
it('persists dismissal until the copy content changes', async () => {
  const input = await fixture();
  await resolveProjectConflictCopy((await findProjectConflict(input))!, 'notAVersion', input);
  expect(await findProjectConflict(input)).toBeUndefined();
  expect(await readConflictDismissals(new NodeLibraryFileSystem(), resolveConflictDismissalFile(input.root))).toHaveLength(1);
  await fs.appendFile(input.file, 'More\n');
  expect(await findProjectConflict(input)).toMatchObject({ match: 'similar' });
});
it('refuses a forged cross-folder pair without deleting either file', async () => {
  const input = await fixture();
  const conflict = (await findProjectConflict(input))!;
  await expect(resolveProjectConflictCopy({ ...conflict, original: path.join(input.root, 'outside.tex') }, 'mergeAutomatically', input)).rejects.toThrow();
  expect(await fs.readFile(input.file, 'utf8')).toContain('Remote line');
});
it('selects the most similar retained sibling version as the base', async () => {
  const input = await fixture();
  const ancestor = input.base.replace('Line 5', 'Shared revision');
  await input.store.retain('p', 'main.tex', ancestor);
  await fs.writeFile(input.original, ancestor.replace('Line 1', 'Local line'));
  await fs.writeFile(input.file, ancestor.replace('Line 8', 'Remote line'));
  await resolveProjectConflictCopy((await findProjectConflict(input))!, 'mergeAutomatically', input);
  expect(await fs.readFile(input.original, 'utf8')).toBe(ancestor.replace('Line 1', 'Local line').replace('Line 8', 'Remote line'));
});
it('preserves both overlapping edits in the merged file', async () => {
  const input = await fixture();
  await fs.writeFile(input.file, input.base.replace('Line 1', 'Remote line'));
  await resolveProjectConflictCopy((await findProjectConflict(input))!, 'mergeAutomatically', input);
  const merged = await fs.readFile(input.original, 'utf8');
  expect(merged).toContain('<<<<<<< local\nLocal line\n=======\nRemote line\n>>>>>>> unknown');
  await expect(fs.stat(input.file)).rejects.toThrow();
});
it('keeps both files when no stored base exists', async () => {
  const input = await fixture();
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(input.root, 'empty-bases'));
  await expect(resolveProjectConflictCopy((await findProjectConflict(input))!, 'mergeAutomatically', { ...input, store })).rejects.toThrow('Cannot merge project copy');
  expect(await fs.readFile(input.file, 'utf8')).toContain('Remote line');
  expect(await fs.readFile(input.original, 'utf8')).toContain('Local line');
});

it.each(['versions', 'bases'] as const)('merges with persisted shared %s when project history is empty', async name => {
  const input = await fixture();
  const shareId = 'shared-merge-test';
  const dir = path.join(createDeviceLocalLayout(input.root).collabDir, shareId);
  const storage = createNodeCollabStorage({ dir, shareId });
  await fs.writeFile(path.join(input.folder, 'labshelf.yaml'), `id: p\nformat: latex\nshared: ${shareId}\n`);
  await storage.saveMap(name, { 'main.tex': name === 'bases' ? input.base : [{ hash: await deriveTextSha256Hex(input.base), text: input.base }] });
  const before = await storage.loadMap(name);
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(input.root, 'empty-project-history'));
  try {
    await resolveProjectConflictCopy((await findProjectConflict(input))!, 'mergeAutomatically', { ...input, store });
    const merged = await fs.readFile(input.original, 'utf8');
    expect(merged).toContain('Local line');
    expect(merged).toContain('Remote line');
    expect(merged).not.toContain('<<<<<<<');
    await expect(fs.stat(input.file)).rejects.toThrow();
    expect(await storage.loadMap(name)).toEqual(before);
    expect(await store.latest('p', 'main.tex')).toBe(merged);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
it.each(['hash', 'shape'])('rejects invalid shared version %s without deleting the copy', async invalid => {
  const input = await fixture();
  const shareId = 'shared-invalid-version-test';
  const dir = path.join(createDeviceLocalLayout(input.root).collabDir, shareId);
  const storage = createNodeCollabStorage({ dir, shareId });
  await fs.writeFile(path.join(input.folder, 'labshelf.yaml'), `id: p\nformat: latex\nshared: ${shareId}\n`);
  await storage.saveMap('versions', { 'main.tex': invalid === 'hash' ? [{ hash: 'a'.repeat(64), text: input.base }] : [{ hash: 'a'.repeat(64), text: 12 }] });
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(input.root, 'empty-project-history'));
  try {
    await expect(resolveProjectConflictCopy((await findProjectConflict(input))!, 'mergeAutomatically', { ...input, store })).rejects.toThrow('Cannot merge project copy');
    expect(await fs.readFile(input.file, 'utf8')).toContain('Remote line');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
it('accepts a copy at the project folder as inside it and refuses it only as no conflict copy', async () => {
  const input = await fixture();
  const conflict = (await findProjectConflict(input))!;
  const error: unknown = await resolveProjectConflictCopy({ ...conflict, copy: input.folder }, 'mergeAutomatically', input).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).not.toMatch(/escapes project/);
});
