// Recognises project text copies from provider names, write history or shared lines.
import { isMergeableTextFile, textHash } from '../../writing/conflict/index.js';
import { lineSimilarity } from '../../writing/text/index.js';
import type { WriteRecords } from '../writeRecords/index.js';
import type { ConflictCopy } from './conflictCopy.js';
import { parseConflictName } from './conflictNames.js';
import type { ConflictDismissal } from './conflictDismissals.js';

export const VERSION_SIMILARITY = 0.6;
export interface ProjectConflictText { path: string; text: string }
export interface ProjectConflictInput extends ProjectConflictText {
  projectId: string;
  siblings: readonly ProjectConflictText[];
  records: WriteRecords;
  dismissed?: readonly ConflictDismissal[];
}

export function isEligibleProjectConflictPath(file: string): boolean {
  return !file.split('/').some(part => part.startsWith('.') || ['node_modules', 'build', 'dist', 'out', 'target'].includes(part))
    && !/ \(copy \d+\)(?:\.[^./]+)?$/.test(file);
}
const nameOf = (file: string) => file.split('/').at(-1) ?? file;
const directoryOf = (file: string) => file.slice(0, file.length - nameOf(file).length);
const extensionOf = (file: string) => /\.[^.]+$/.exec(nameOf(file))?.[0].toLowerCase();
const textFile = ({ path, text }: ProjectConflictText) => isEligibleProjectConflictPath(path)
  && isMergeableTextFile(nameOf(path), new TextEncoder().encode(text));

export async function detectProjectConflict(input: ProjectConflictInput): Promise<ConflictCopy | undefined> {
  if (!isEligibleProjectConflictPath(input.path)) return undefined;
  const hash = await textHash(input.text);
  if (input.dismissed?.some(entry => entry.path === input.path && entry.hash === hash)) return undefined;
  const parsed = parseConflictName(nameOf(input.path));
  const conflict = (original: string, match: 'name' | 'record' | 'similar'): ConflictCopy => ({
    owner: { kind: 'project', id: input.projectId }, original, copy: input.path, match,
    tool: match === 'name' && parsed ? parsed.tool : 'unknown',
  });
  if (parsed) return conflict(`${directoryOf(input.path)}${parsed.original}`, 'name');
  if (!textFile(input)) return undefined;
  const siblings = input.siblings.filter(file => file.path !== input.path && directoryOf(file.path) === directoryOf(input.path)
    && !parseConflictName(nameOf(file.path)) && textFile(file));
  const recorded = siblings.find(file => input.records.get(file.path)?.some(entry => entry.hash === hash));
  if (recorded) return conflict(recorded.path, 'record');
  const similar = siblings.filter(file => extensionOf(file.path) === extensionOf(input.path))
    .map(file => ({ ...file, score: lineSimilarity(input.text, file.text) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))[0];
  return similar && similar.score >= VERSION_SIMILARITY ? conflict(similar.path, 'similar') : undefined;
}
