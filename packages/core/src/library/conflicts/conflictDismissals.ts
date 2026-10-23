// Persists device-local dismissals for an exact path and content hash.
import type { LibraryFileSystem } from '../../ports/index.js';

export interface ConflictDismissal { path: string; hash: string }
type DismissalReads = Pick<LibraryFileSystem, 'readText'>;
type DismissalWrites = DismissalReads & Pick<LibraryFileSystem, 'writeText'>;
const queues = new Map<string, Promise<void>>();

export async function readConflictDismissals(fs: DismissalReads, file: string): Promise<ConflictDismissal[]> {
  let text: string;
  try { text = await fs.readText(file); }
  catch (error) { if ((error as { code?: string }).code === 'ENOENT') return []; throw error; }
  const entries: unknown = JSON.parse(text);
  if (!Array.isArray(entries) || !entries.every(entry => entry && typeof entry.path === 'string' && typeof entry.hash === 'string' && /^[a-f0-9]{64}$/.test(entry.hash))) {
    throw new Error(`Invalid conflict dismissals: ${file}`);
  }
  return entries;
}

export async function dismissProjectConflict(fs: DismissalWrites, file: string, path: string, hash: string): Promise<void> {
  if (!path || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid project conflict dismissal: ${path}`);
  const operation = (queues.get(file) ?? Promise.resolve()).then(async () => {
    const entries = (await readConflictDismissals(fs, file)).filter(entry => entry.path !== path);
    await fs.writeText(file, JSON.stringify([...entries, { path, hash }]));
  });
  const settled = operation.then(() => {}, () => {});
  queues.set(file, settled);
  try { await operation; }
  finally { if (queues.get(file) === settled) queues.delete(file); }
}
