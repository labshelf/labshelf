// Pins shared index reads without rewriting collaboration state.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as Y from 'yjs';
import { readShareIndexDocFiles, INDEX_DOC_KEY } from "../../../../../src/collab/doc/index";
import { createNodeCollabStorage } from '../../../../../src/collab/node/deviceState/index';
import { readSharedProjectFiles } from '../../../../../src/writing/conflict/node/sharedProjectState';
import { createDeviceLocalLayout } from '../../../../../src/library/node/index';
import { cleanupTempDirs, makeTempDir } from '../../../../support/tempDirs';
import { fakeLogger } from '../../../../support/fakeLogger';
import { scanLibraryConflicts } from '../../../../../src/writing/conflict/node/index';
import { FileProjectVersionStore } from '../../../../../src/writing/conflict/index';
import { NodeLibraryFileSystem } from '../../../../../src/library/node/index';
import { createNodeProjectCatalogCompositionRoot } from '../../../../../src/writing/project/node/index';
import { createProjectFromTemplate } from '../../../../../src/writing/project/index';
import { createBlankTemplate } from '../../../../../src/templates/index';

afterEach(cleanupTempDirs);

it('reads tracked files from the snapshot and appended updates without compacting them', async () => {
  const root = await makeTempDir();
  const dir = path.join(createDeviceLocalLayout(root).collabDir, 'shared-copy-test');
  const storage = createNodeCollabStorage({ dir, shareId: 'shared-copy-test' });
  const doc = new Y.Doc();
  try {
    readShareIndexDocFiles(doc).set('main.tex', { kind: 'text' });
    const id = storage.docId(INDEX_DOC_KEY);
    await storage.compactDoc(id, Y.encodeStateAsUpdate(doc));
    const vector = Y.encodeStateVector(doc);
    readShareIndexDocFiles(doc).set('chapter.tex', { kind: 'text' });
    await storage.appendUpdate(id, Y.encodeStateAsUpdate(doc, vector));
    const before = await storage.loadDocs();
    expect(await readSharedProjectFiles(root, 'shared-copy-test', fakeLogger())).toEqual(new Set(['main.tex', 'chapter.tex']));
    expect(await storage.loadDocs()).toEqual(before);
  } finally {
    doc.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it('rejects a share id that escapes device-local collaboration state', async () => {
  await expect(readSharedProjectFiles('/tmp/library', '../outside', fakeLogger())).rejects.toThrow('Invalid share id');
});

it('offers only untracked shared files even when their names sort before the tracked original', async () => {
  const root = await makeTempDir();
  const logger = fakeLogger();
  const project = await createProjectFromTemplate(createNodeProjectCatalogCompositionRoot(logger), root, { title: 'Study', ...createBlankTemplate('latex', 'Study') });
  if (project.kind !== 'ready') throw new Error('Project unavailable');
  const shareId = 'shared-index-test';
  const dir = path.join(createDeviceLocalLayout(root).collabDir, shareId);
  const storage = createNodeCollabStorage({ dir, shareId });
  const doc = new Y.Doc();
  try {
    await fs.appendFile(path.join(project.folder, 'labshelf.yaml'), `shared: ${shareId}\n`);
    const base = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
    await fs.writeFile(path.join(project.folder, 'main.tex'), base);
    await fs.writeFile(path.join(project.folder, 'chapter.tex'), base.replace('Line 8', 'Chapter line'));
    readShareIndexDocFiles(doc).set('main.tex', { kind: 'text' });
    readShareIndexDocFiles(doc).set('chapter.tex', { kind: 'text' });
    await storage.compactDoc(storage.docId(INDEX_DOC_KEY), Y.encodeStateAsUpdate(doc));
    const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, path.join(root, 'bases'));
    expect(await scanLibraryConflicts(root, store, logger)).toEqual([]);
    await fs.writeFile(path.join(project.folder, 'a.tex'), base.replace('Line 9', 'Remote line'));
    expect(await scanLibraryConflicts(root, store, logger)).toEqual([
      expect.objectContaining({ copy: path.join(project.folder, 'a.tex'), original: path.join(project.folder, 'main.tex') }),
    ]);
  } finally {
    doc.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
